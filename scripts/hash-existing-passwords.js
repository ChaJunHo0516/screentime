#!/usr/bin/env node
// scripts/hash-existing-passwords.js  (PHASE 1, 001_security_upgrade 적용 후 1회 실행)
//
// 1.0 의 평문 비밀번호를 bcrypt 해시로 일괄 변환해 password_hash 에 저장한다.
//   * 평문(password) 컬럼은 지우지 않는다 → v1 코드로 rollback 가능
//     (평문 제거는 database/manual/001b_clear_plaintext_passwords.sql)
//   * 여러 번 실행해도 안전하다 (password_hash 가 비어 있는 계정만 처리)
//   * 계정 ID / 비밀번호는 출력하지 않는다. 처리 건수만 출력한다.
//
// 사용법:  npm run hash-passwords        (미리보기: npm run hash-passwords -- --dry-run)
process.env.NODE_ENV = process.env.NODE_ENV || 'script';
const pool = require('../config/db');
const authService = require('../services/authService');

const TABLES = [
    { table: 'users', idColumn: 'user_id' },
    { table: 'admins', idColumn: 'admin_id' }
];

async function migrateTable({ table, idColumn }, dryRun) {
    const [rows] = await pool.query(
        `SELECT ${idColumn} AS id, password FROM ${table} WHERE password_hash IS NULL AND password IS NOT NULL`
    );
    let hashed = 0;
    let reused = 0;
    for (const row of rows) {
        // 이미 bcrypt 형식으로 저장된 값이면 다시 해시하지 않고 그대로 옮긴다.
        const hash = authService.looksLikeBcrypt(row.password)
            ? (reused++, row.password)
            : (hashed++, dryRun ? null : await authService.hashPassword(row.password));
        if (!dryRun) {
            await pool.query(
                `UPDATE ${table} SET password_hash = ?, password_updated_at = NOW() WHERE ${idColumn} = ? AND password_hash IS NULL`,
                [hash, row.id]
            );
        }
    }
    const [[remain]] = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table} WHERE password_hash IS NULL`);
    console.log(`${table}: 대상 ${rows.length}건 (해시 ${hashed}, 기존 bcrypt 재사용 ${reused})` +
        `${dryRun ? ' [dry-run: 변경 없음]' : ''} / 해시 없는 계정 남은 수: ${remain.cnt}`);
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    for (const t of TABLES) await migrateTable(t, dryRun);
    console.log(dryRun
        ? '미리보기 완료.'
        : '완료. 모든 계정이 새 비밀번호 체계로 로그인 가능한지 확인한 뒤, 충분한 검증 기간 후 001b 를 수동 실행하세요.');
}

main()
    .catch(err => { console.error('❌ 실패:', err.code || '', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
