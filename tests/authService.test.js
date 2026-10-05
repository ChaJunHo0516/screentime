'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService, sha256Hex, looksLikeBcrypt } = require('../services/authService');
const { fakeBcrypt, createFakeDb } = require('./helpers');

const config = { bcryptCost: 4, userTokenTtlHours: 168, agentTokenTtlDays: 30, adminTokenTtlHours: 12 };

function setup(seed, nowRef = { t: new Date('2026-10-05T00:00:00Z') }) {
    const db = createFakeDb(seed);
    const svc = createAuthService({ getDb: () => db, getBcrypt: () => fakeBcrypt, config, now: () => nowRef.t });
    return { db, svc, nowRef };
}

test('issueToken: DB에는 원문이 아니라 SHA-256 해시만 저장된다', async () => {
    const { db, svc } = setup();
    const { token } = await svc.issueToken({ subjectType: 'USER', subjectId: 'inha' });
    assert.ok(token.length >= 40);
    assert.equal(db.state.tokens.length, 1);
    assert.equal(db.state.tokens[0].token_hash, sha256Hex(token));
    assert.ok(!JSON.stringify(db.state.tokens).includes(token));
});

test('resolveToken: 유효 토큰 → subject, 폐기/만료/위조 → null', async () => {
    const nowRef = { t: new Date('2026-10-05T00:00:00Z') };
    const { svc } = setup({}, nowRef);
    const user = await svc.issueToken({ subjectType: 'USER', subjectId: 'inha' });
    const agent = await svc.issueToken({ subjectType: 'USER', subjectId: 'inha', clientType: 'AGENT' });
    const admin = await svc.issueToken({ subjectType: 'ADMIN', subjectId: 'boss' });

    assert.deepEqual(
        { ...(await svc.resolveToken(user.token)), tokenId: 0 },
        { tokenId: 0, subjectType: 'USER', subjectId: 'inha', clientType: 'WEB' }
    );
    assert.equal((await svc.resolveToken(agent.token)).clientType, 'AGENT');
    assert.equal((await svc.resolveToken(admin.token)).subjectType, 'ADMIN');
    assert.equal(await svc.resolveToken('forged-token-forged-token-forged'), null);
    assert.equal(await svc.resolveToken(''), null);

    await svc.revokeToken(user.token);
    assert.equal(await svc.resolveToken(user.token), null, '로그아웃된 토큰은 무효');

    nowRef.t = new Date('2026-10-05T13:00:00Z');   // 관리자 TTL 12시간 경과
    assert.equal(await svc.resolveToken(admin.token), null, '만료된 관리자 토큰은 무효');
    assert.ok(await svc.resolveToken(agent.token), 'agent 토큰(30일)은 유효');
});

test('verifyCredentials: 해시 계정 로그인 성공/실패', async () => {
    const { svc } = setup({ users: [{ user_id: 'inha', username: '인하', password: null, password_hash: 'fake$correct-pw' }] });
    const ok = await svc.verifyCredentials('USER', 'inha', 'correct-pw');
    assert.deepEqual(ok, { user_id: 'inha', username: '인하' });
    assert.ok(!('password_hash' in ok) && !('password' in ok), '비밀번호 정보는 반환하지 않음');
    assert.equal(await svc.verifyCredentials('USER', 'inha', 'wrong'), null);
});

test('verifyCredentials: 1.0 평문 계정은 로그인 시 해시로 자동 업그레이드 (평문은 rollback 대비 유지)', async () => {
    const { svc, db } = setup({ users: [{ user_id: 'jy16', username: 'jy', password: '1234' }] });
    assert.equal(await svc.verifyCredentials('USER', 'jy16', '9999'), null);
    assert.equal(db.state.users[0].password_hash, null, '실패 시 업그레이드 안 함');
    assert.ok(await svc.verifyCredentials('USER', 'jy16', '1234'));
    assert.equal(db.state.users[0].password_hash, 'fake$1234');
    assert.equal(db.state.users[0].password, '1234', '평문 제거는 001b 수동 단계에서만');
    // 이후에는 해시로 검증
    assert.ok(await svc.verifyCredentials('USER', 'jy16', '1234'));
});

test('verifyCredentials: 존재하지 않는 계정도 bcrypt 비교를 수행(타이밍 노출 방지)', async () => {
    const { svc } = setup();
    const before = fakeBcrypt.calls;
    assert.equal(await svc.verifyCredentials('USER', 'ghost', 'pw'), null);
    assert.ok(fakeBcrypt.calls > before);
});

test('verifyCredentials: 관리자 테이블 분리', async () => {
    const { svc } = setup({
        users: [{ user_id: 'admin', username: 'x', password_hash: 'fake$userpw' }],
        admins: [{ admin_id: 'admin', admin_name: '관리자', password_hash: 'fake$adminpw' }]
    });
    assert.equal(await svc.verifyCredentials('ADMIN', 'admin', 'userpw'), null);
    assert.deepEqual(await svc.verifyCredentials('ADMIN', 'admin', 'adminpw'), { admin_id: 'admin', admin_name: '관리자' });
});

test('looksLikeBcrypt', () => {
    assert.ok(looksLikeBcrypt('$2b$12$' + 'a'.repeat(53)));
    assert.ok(!looksLikeBcrypt('1234'));
    assert.ok(!looksLikeBcrypt(null));
});
