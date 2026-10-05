'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// migrate.js 는 실행 시에만 dotenv/mysql2 를 사용하므로, 분리 함수만 직접 로드한다.
const Module = require('module');
function loadMigrate() {
    const origResolve = Module._resolveFilename;
    const stubs = { dotenv: { config() {} }, 'mysql2/promise': {} };
    Module._resolveFilename = function (request, ...rest) {
        if (request in stubs) return request;
        return origResolve.call(this, request, ...rest);
    };
    for (const [k, v] of Object.entries(stubs)) require.cache[k] = { id: k, filename: k, loaded: true, exports: v };
    try { return require('../database/migrate'); } finally { Module._resolveFilename = origResolve; }
}
const { splitSql, listMigrations } = loadMigrate();

test('splitSql: 문자열 안의 ; 와 주석을 올바르게 처리', () => {
    const sql = "-- comment; here\nINSERT INTO t VALUES ('a;b', 'it''s');\n# x;\nSELECT 1;";
    assert.deepEqual(splitSql(sql), ["INSERT INTO t VALUES ('a;b', 'it''s')", 'SELECT 1']);
});

test('migration 파일: 번호 순서, 파괴적 문장 금지', () => {
    const list = listMigrations();
    assert.deepEqual(list.map(m => m.version).slice(0, 2), ['000_baseline', '001_security_upgrade']);
    for (const m of list) {
        for (const stmt of splitSql(m.content)) {
            assert.ok(!/^\s*(DROP|TRUNCATE)\b/i.test(stmt), `${m.file}: 파괴적 문장 금지 → ${stmt.slice(0, 40)}`);
            assert.ok(!/\bDROP\s+COLUMN\b/i.test(stmt), `${m.file}: DROP COLUMN 금지`);
            assert.ok(!/^\s*DELETE\b/i.test(stmt), `${m.file}: DELETE 금지`);
        }
    }
});

test('baseline 은 CREATE TABLE IF NOT EXISTS 만 사용 (기존 DB에서 no-op)', () => {
    const base = listMigrations().find(m => m.version === '000_baseline');
    for (const stmt of splitSql(base.content)) {
        if (/^CREATE TABLE/i.test(stmt)) assert.match(stmt, /^CREATE TABLE IF NOT EXISTS/i);
        if (/^INSERT/i.test(stmt)) assert.match(stmt, /WHERE NOT EXISTS/i, '시드는 비어 있을 때만');
    }
});

test('모든 migration 에 rollback 파일이 있다 (baseline 제외)', () => {
    for (const m of listMigrations().filter(x => x.version !== '000_baseline')) {
        const down = path.join(__dirname, '..', 'database', 'migrations', 'down', `${m.version}.down.sql`);
        assert.ok(fs.existsSync(down), `${m.version} rollback 없음`);
    }
});
