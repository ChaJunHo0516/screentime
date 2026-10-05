#!/usr/bin/env node
// scripts/create-admin.js  — 관리자 계정 생성 / 비밀번호 재설정
//
// 1.0 은 schema.sql 에 평문 관리자 비밀번호를 시드했다. 2.0 부터는 이 스크립트로만 관리자를 만든다.
// 비밀번호는 화면에 표시되지 않게 입력받고, bcrypt 해시만 저장한다.
//
// 사용법:  npm run create-admin
process.env.NODE_ENV = process.env.NODE_ENV || 'script';
const readline = require('readline');
const pool = require('../config/db');
const authService = require('../services/authService');

function ask(question, { hidden = false } = {}) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            // 입력 문자를 화면에 출력하지 않음
            rl._writeToOutput = (str) => {
                if (str.includes(question)) rl.output.write(str);
            };
        }
        rl.question(question, answer => {
            rl.close();
            if (hidden) process.stdout.write('\n');
            resolve(answer);
        });
    });
}

async function main() {
    const adminId = (await ask('관리자 ID: ')).trim();
    if (!/^[A-Za-z0-9_]{3,50}$/.test(adminId)) throw new Error('관리자 ID는 영문/숫자/_ 3~50자');
    const adminName = (await ask('표시 이름: ')).trim() || '관리자';
    const pw1 = await ask('비밀번호(12자 이상): ', { hidden: true });
    const pw2 = await ask('비밀번호 확인: ', { hidden: true });
    if (pw1 !== pw2) throw new Error('비밀번호가 일치하지 않습니다.');
    if (pw1.length < 12 || pw1.length > 72) throw new Error('관리자 비밀번호는 12~72자');

    const hash = await authService.hashPassword(pw1);
    await pool.query(
        `INSERT INTO admins (admin_id, password, password_hash, password_updated_at, admin_name)
         VALUES (?, NULL, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE password = NULL, password_hash = VALUES(password_hash),
                                 password_updated_at = NOW(), admin_name = VALUES(admin_name)`,
        [adminId, hash, adminName.slice(0, 50)]
    );
    // 비밀번호가 바뀌었으므로 해당 관리자의 기존 세션은 모두 폐기
    await pool.query(
        "UPDATE auth_tokens SET revoked_at = NOW() WHERE subject_type = 'ADMIN' AND subject_id = ? AND revoked_at IS NULL",
        [adminId]
    );
    console.log(`✔ 관리자 계정 저장 완료 (${adminId})`);
}

main()
    .catch(err => { console.error('❌', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
