'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createAuthenticate, requireUser, requireAdmin, requireUserOrAdmin, ensureSelfParam
} = require('../middleware/auth');

const TOKENS = {
    'user-token-aaaaaaaaaaaaaaaaaaaa': { tokenId: 1, subjectType: 'USER', subjectId: 'inha', clientType: 'WEB' },
    'agent-token-bbbbbbbbbbbbbbbbbbb': { tokenId: 2, subjectType: 'USER', subjectId: 'inha', clientType: 'AGENT' },
    'admin-token-cccccccccccccccccccc': { tokenId: 3, subjectType: 'ADMIN', subjectId: 'boss', clientType: 'WEB' }
};
const fakeService = { resolveToken: async (t) => TOKENS[t] || null };
const authenticate = createAuthenticate(fakeService);

function req({ bearer, cookies = {}, params = {} } = {}) {
    return {
        cookies,
        params,
        get: (h) => (h.toLowerCase() === 'authorization' && bearer ? `Bearer ${bearer}` : undefined)
    };
}
function run(mw, r) {
    return new Promise((resolve) => mw(r, {}, (err) => resolve(err || null)));
}

test('authenticate: 쿠키 → req.user, Bearer(agent) → req.user, 관리자 쿠키 → req.admin', async () => {
    const r1 = req({ cookies: { ff_session: 'user-token-aaaaaaaaaaaaaaaaaaaa' } });
    await run(authenticate, r1);
    assert.equal(r1.user.id, 'inha');
    assert.equal(r1.admin, null);

    const r2 = req({ bearer: 'agent-token-bbbbbbbbbbbbbbbbbbb' });
    await run(authenticate, r2);
    assert.equal(r2.user.clientType, 'AGENT');

    const r3 = req({ cookies: { ff_admin: 'admin-token-cccccccccccccccccccc' } });
    await run(authenticate, r3);
    assert.equal(r3.admin.id, 'boss');
    assert.equal(r3.user, null);

    const r4 = req({ cookies: { ff_session: 'bogus' } });
    await run(authenticate, r4);
    assert.equal(r4.user, null);
});

test('사용자 쿠키 값을 관리자 쿠키 이름으로 넣어도 관리자가 되지 않는다', async () => {
    const r = req({ cookies: { ff_admin: 'user-token-aaaaaaaaaaaaaaaaaaaa' } });
    await run(authenticate, r);
    assert.equal(r.admin, null);
    assert.equal(r.user.id, 'inha');
});

test('requireUser / requireAdmin / requireUserOrAdmin', async () => {
    assert.equal((await run(requireUser, { user: null })).status, 401);
    assert.equal(await run(requireUser, { user: { id: 'a' } }), null);
    assert.equal((await run(requireAdmin, { user: null, admin: null })).status, 401);
    assert.equal((await run(requireAdmin, { user: { id: 'a' }, admin: null })).status, 403);
    assert.equal(await run(requireAdmin, { admin: { id: 'boss' } }), null);
    assert.equal((await run(requireUserOrAdmin, {})).status, 401);
});

test('ensureSelfParam: 본인만 허용(대소문자 무시), 관리자는 허용', async () => {
    const mw = ensureSelfParam('userId');
    assert.equal(await run(mw, { user: { id: 'inha' }, params: { userId: 'inha' } }), null);
    assert.equal(await run(mw, { user: { id: 'inha' }, params: { userId: 'INHA' } }), null);
    const err = await run(mw, { user: { id: 'inha' }, params: { userId: 'jy16' } });
    assert.equal(err.status, 403);
    assert.equal(await run(mw, { admin: { id: 'boss' }, params: { userId: 'jy16' } }), null);
    assert.equal((await run(mw, { params: { userId: 'jy16' } })).status, 401);
});
