#!/usr/bin/env node
// database/migrate.js — 최소 migration runner (외부 의존성: mysql2, dotenv 뿐)
//
// 사용법
//   node database/migrate.js                 # 대기 중인 migration 모두 적용
//   node database/migrate.js --status        # 적용 현황 출력
//   node database/migrate.js --create-db     # DB가 없으면 생성(utf8mb4) 후 적용
//   node database/migrate.js --down 001_security_upgrade   # 해당 migration rollback (down/*.down.sql)
//
// 원칙
//   * migrations/ 의 NNN_name.sql 을 파일명 순서대로 1회씩 적용하고 schema_migrations 에 기록한다.
//   * MySQL DDL 은 트랜잭션이 아니므로, 중간 실패 후 재실행해도 안전하도록
//     "이미 존재함" 계열 오류(테이블/컬럼/인덱스 중복)는 건너뛴다.
//   * 접속 정보는 .env 에서만 읽고 출력하지 않는다.
//   * 실행 전 반드시 백업:  mysqldump -u <user> -p nudgeai > backup_YYYYMMDD.sql
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DOWN_DIR = path.join(MIGRATIONS_DIR, 'down');

// 재실행 시 무시해도 되는 MySQL 오류 코드 ("이미 적용됨")
const IDEMPOTENT_ERRORS = new Set([
    'ER_TABLE_EXISTS_ERROR',   // 1050
    'ER_DUP_FIELDNAME',        // 1060
    'ER_DUP_KEYNAME',          // 1061
    'ER_CANT_DROP_FIELD_OR_KEY', // 1091 (down 재실행)
    'ER_BAD_TABLE_ERROR'       // 1051 (down 재실행)
]);

/**
 * SQL 파일을 문장 단위로 분리한다. 문자열 리터럴 안의 ';' 와 '-- ' 주석을 올바르게 처리한다.
 * (stored procedure / DELIMITER 는 사용하지 않는다는 전제)
 */
function splitSql(sql) {
    const statements = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        const next = sql[i + 1];
        if (quote) {
            current += ch;
            if (ch === '\\') { current += next || ''; i++; continue; }
            if (ch === quote) {
                if (next === quote) { current += next; i++; continue; } // '' escape
                quote = null;
            }
            continue;
        }
        if (ch === '-' && next === '-') {           // -- 주석: 줄 끝까지 건너뜀
            while (i < sql.length && sql[i] !== '\n') i++;
            current += '\n';
            continue;
        }
        if (ch === '#') {                            // # 주석
            while (i < sql.length && sql[i] !== '\n') i++;
            current += '\n';
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue; }
        if (ch === ';') {
            if (current.trim()) statements.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) statements.push(current.trim());
    return statements;
}

function listMigrations() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => /^\d{3}_.+\.sql$/.test(f))
        .sort()
        .map(file => {
            const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            return {
                version: file.replace(/\.sql$/, ''),
                file,
                content,
                checksum: crypto.createHash('sha256').update(content).digest('hex')
            };
        });
}

async function connect({ withDatabase = true } = {}) {
    const user = process.env.DB_MIGRATION_USER || process.env.DB_USER;
    const password = process.env.DB_MIGRATION_USER ? process.env.DB_MIGRATION_PASSWORD : process.env.DB_PASSWORD;
    if (!user || !process.env.DB_NAME) {
        throw new Error('.env 에 DB_USER / DB_NAME (또는 DB_MIGRATION_USER) 가 필요합니다.');
    }
    const base = process.env.DB_SOCKET_PATH
        ? { socketPath: process.env.DB_SOCKET_PATH }
        : { host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306) };
    return mysql.createConnection({
        ...base,
        user,
        password,
        database: withDatabase ? process.env.DB_NAME : undefined,
        charset: 'utf8mb4',
        multipleStatements: false
    });
}

async function ensureMigrationTable(conn) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(100) PRIMARY KEY,
            checksum CHAR(64) NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4
    `);
}

async function runStatements(conn, statements, label) {
    for (const [idx, stmt] of statements.entries()) {
        try {
            await conn.query(stmt);
        } catch (err) {
            if (IDEMPOTENT_ERRORS.has(err.code)) {
                console.log(`   ↷ [${label} #${idx + 1}] 이미 적용된 변경 — 건너뜀 (${err.code})`);
                continue;
            }
            const preview = stmt.replace(/\s+/g, ' ').slice(0, 120);
            err.message = `[${label} #${idx + 1}] ${err.code || ''} ${err.message}\n   SQL: ${preview}...`;
            throw err;
        }
    }
}

async function up() {
    const conn = await connect();
    try {
        await ensureMigrationTable(conn);
        const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
        const applied = new Map(rows.map(r => [r.version, r.checksum]));
        let count = 0;
        for (const m of listMigrations()) {
            if (applied.has(m.version)) {
                if (applied.get(m.version) !== m.checksum) {
                    console.warn(`⚠️  ${m.file} 은 적용 이후 내용이 변경되었습니다. 적용된 migration 은 수정하지 말고 새 파일을 추가하세요.`);
                }
                continue;
            }
            console.log(`▶ applying ${m.file}`);
            await runStatements(conn, splitSql(m.content), m.version);
            await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [m.version, m.checksum]);
            console.log(`✔ applied  ${m.file}`);
            count++;
        }
        console.log(count === 0 ? '모든 migration 이 이미 적용되어 있습니다.' : `${count}개 migration 적용 완료.`);
    } finally {
        await conn.end();
    }
}

async function status() {
    const conn = await connect();
    try {
        await ensureMigrationTable(conn);
        const [rows] = await conn.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
        const applied = new Map(rows.map(r => [r.version, r.applied_at]));
        for (const m of listMigrations()) {
            const at = applied.get(m.version);
            console.log(`${at ? '✔' : '·'} ${m.version}${at ? `  (${new Date(at).toISOString()})` : '  (pending)'}`);
        }
    } finally {
        await conn.end();
    }
}

async function down(version) {
    const file = path.join(DOWN_DIR, `${version}.down.sql`);
    if (!fs.existsSync(file)) throw new Error(`rollback 파일이 없습니다: database/migrations/down/${version}.down.sql`);
    const conn = await connect();
    try {
        await ensureMigrationTable(conn);
        console.log(`◀ rolling back ${version}`);
        await runStatements(conn, splitSql(fs.readFileSync(file, 'utf8')), `${version}.down`);
        await conn.query('DELETE FROM schema_migrations WHERE version = ?', [version]);
        console.log(`✔ rolled back ${version}`);
    } finally {
        await conn.end();
    }
}

async function createDatabase() {
    const name = process.env.DB_NAME;
    if (!/^[A-Za-z0-9_]+$/.test(name || '')) throw new Error('DB_NAME 은 영문/숫자/_ 만 허용합니다.');
    const conn = await connect({ withDatabase: false });
    try {
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
        console.log(`✔ database 준비 완료: ${name}`);
    } finally {
        await conn.end();
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--status')) return status();
    const downIdx = args.indexOf('--down');
    if (downIdx !== -1) return down(args[downIdx + 1]);
    if (args.includes('--create-db')) await createDatabase();
    return up();
}

if (require.main === module) {
    main().catch(err => {
        console.error('❌ migration 실패:', err.message);
        process.exit(1);
    });
}

module.exports = { splitSql, listMigrations };
