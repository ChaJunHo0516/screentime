// tests/helpers.js — DB / bcrypt 없이 서비스 로직을 검증하기 위한 가짜 의존성
'use strict';

// bcrypt 대체: 테스트 속도를 위해 단순 prefix 해시 사용 (형식만 흉내)
const fakeBcrypt = {
    calls: 0,
    async hash(pw) { this.calls++; return `fake$${pw}`; },
    async compare(pw, hash) { this.calls++; return hash === `fake$${pw}`; }
};

// authService 가 사용하는 SQL 만 흉내 내는 in-memory DB
function createFakeDb({ users = [], admins = [] } = {}) {
    const state = {
        users: users.map(u => ({ password_hash: null, ...u })),
        admins: admins.map(a => ({ password_hash: null, ...a })),
        tokens: [],
        queries: []
    };
    let nextTokenId = 1;
    const table = (sql) => (/FROM admins|UPDATE admins/.test(sql) ? state.admins : state.users);
    const idCol = (sql) => (/admins/.test(sql) ? 'admin_id' : 'user_id');

    async function query(sql, params = []) {
        state.queries.push({ sql, params });
        if (/^SELECT .* FROM (users|admins) WHERE/s.test(sql)) {
            const rows = table(sql).filter(r => r[idCol(sql)].toLowerCase() === String(params[0]).toLowerCase());
            return [rows.slice(0, 1).map(r => ({ ...r }))];
        }
        if (/^UPDATE (users|admins) SET password_hash/.test(sql)) {
            const row = table(sql).find(r => r[idCol(sql)] === params[1]);
            if (row) row.password_hash = params[0];
            return [{ affectedRows: row ? 1 : 0 }];
        }
        if (/^INSERT INTO auth_tokens/.test(sql)) {
            const [token_hash, subject_type, subject_id, client_type, device_name, expires_at] = params;
            state.tokens.push({ token_id: nextTokenId++, token_hash, subject_type, subject_id, client_type, device_name, expires_at, revoked_at: null, last_used_at: null });
            return [{ insertId: nextTokenId - 1 }];
        }
        if (/^SELECT token_id/.test(sql.trim())) {
            const [hash, now] = params;
            const rows = state.tokens.filter(t => t.token_hash === hash && !t.revoked_at && t.expires_at > now);
            return [rows.slice(0, 1).map(t => ({ ...t }))];
        }
        if (/^UPDATE auth_tokens SET last_used_at/.test(sql)) {
            const t = state.tokens.find(x => x.token_id === params[1]);
            if (t) t.last_used_at = params[0];
            return [{}];
        }
        if (/^UPDATE auth_tokens SET revoked_at/.test(sql)) {
            const t = state.tokens.find(x => x.token_hash === params[1] && !x.revoked_at);
            if (t) t.revoked_at = params[0];
            return [{}];
        }
        throw new Error(`fake db: unhandled SQL: ${sql.slice(0, 60)}`);
    }
    return { query, state };
}

module.exports = { fakeBcrypt, createFakeDb };
