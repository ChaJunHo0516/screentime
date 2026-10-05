// services/authService.js
// 비밀번호 해시(bcrypt)와 DB 기반 opaque 토큰 발급/검증/폐기를 담당한다.
//
// 토큰 설계
//   * 원문 토큰: 32바이트 난수(base64url). 클라이언트에게만 1회 전달된다.
//   * DB 저장값: SHA-256(원문) hex. DB가 유출되어도 토큰을 재사용할 수 없다.
//   * 폐기(로그아웃/계정삭제/agent 연결 해제)는 revoked_at 설정 한 번으로 끝난다.
//
// 의존성 주입(createAuthService)으로 DB/bcrypt 없이 단위 테스트할 수 있다.
const crypto = require('crypto');

const SUBJECT = Object.freeze({ USER: 'USER', ADMIN: 'ADMIN' });
const CLIENT = Object.freeze({ WEB: 'WEB', AGENT: 'AGENT' });

// 계정 테이블별 설정 (테이블/컬럼명은 상수 — 사용자 입력으로 만들지 않는다)
const ACCOUNT_TABLES = Object.freeze({
    USER: { table: 'users', idColumn: 'user_id', select: 'user_id, username' },
    ADMIN: { table: 'admins', idColumn: 'admin_id', select: 'admin_id, admin_name' }
});

const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// 길이가 달라도 시간 차이가 생기지 않도록 해시 후 비교
function timingSafeEqualStr(a, b) {
    const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
    const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
    return crypto.timingSafeEqual(ha, hb);
}

function looksLikeBcrypt(value) {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(value);
}

function createAuthService({ getDb, getBcrypt, config, now = () => new Date() }) {
    let dummyHashPromise = null;

    function bcrypt() { return getBcrypt(); }

    async function hashPassword(plain) {
        return bcrypt().hash(String(plain), config.bcryptCost);
    }

    async function verifyPassword(plain, hash) {
        if (!hash) return false;
        return bcrypt().compare(String(plain), hash);
    }

    // 존재하지 않는 계정에도 bcrypt 비교 1회를 수행해 응답시간으로 계정 존재 여부가 드러나지 않게 한다.
    async function burnTime(plain) {
        if (!dummyHashPromise) dummyHashPromise = hashPassword('focusflow-timing-dummy');
        await verifyPassword(plain, await dummyHashPromise);
    }

    /**
     * 아이디/비밀번호 검증.
     * - password_hash 가 있으면 bcrypt 비교
     * - 아직 해시가 없는 1.0 계정(hash-passwords 스크립트 미실행)은 평문과 비교 후 즉시 해시를 저장(lazy upgrade)
     *   → 평문 컬럼은 001b 수동 단계 전까지 유지(rollback 대비)
     * @returns 계정 정보(행) 또는 null
     */
    async function verifyCredentials(subjectType, id, password) {
        const t = ACCOUNT_TABLES[subjectType];
        if (!t) throw new Error(`unknown subject type: ${subjectType}`);
        const db = getDb();
        const [rows] = await db.query(
            `SELECT ${t.select}, password, password_hash FROM ${t.table} WHERE ${t.idColumn} = ? LIMIT 1`,
            [id]
        );
        const row = rows[0];
        if (!row) {
            await burnTime(password);
            return null;
        }

        let ok = false;
        if (row.password_hash) {
            ok = await verifyPassword(password, row.password_hash);
        } else if (looksLikeBcrypt(row.password)) {
            ok = await verifyPassword(password, row.password);
            if (ok) await storeHash(subjectType, row[t.idColumn], row.password);
        } else if (row.password != null) {
            ok = timingSafeEqualStr(password, row.password);
            if (ok) await storeHash(subjectType, row[t.idColumn], await hashPassword(password));
        } else {
            await burnTime(password);
        }
        if (!ok) return null;

        const { password: _p, password_hash: _h, ...safe } = row;
        return safe;
    }

    async function storeHash(subjectType, id, hash) {
        const t = ACCOUNT_TABLES[subjectType];
        await getDb().query(
            `UPDATE ${t.table} SET password_hash = ?, password_updated_at = NOW() WHERE ${t.idColumn} = ?`,
            [hash, id]
        );
    }

    function ttlMs(subjectType, clientType) {
        if (subjectType === SUBJECT.ADMIN) return config.adminTokenTtlHours * 3600 * 1000;
        if (clientType === CLIENT.AGENT) return config.agentTokenTtlDays * 24 * 3600 * 1000;
        return config.userTokenTtlHours * 3600 * 1000;
    }

    async function issueToken({ subjectType, subjectId, clientType = CLIENT.WEB, deviceName = null }) {
        if (!SUBJECT[subjectType]) throw new Error('invalid subjectType');
        if (!CLIENT[clientType]) throw new Error('invalid clientType');
        const token = crypto.randomBytes(32).toString('base64url');
        const maxAgeMs = ttlMs(subjectType, clientType);
        const expiresAt = new Date(now().getTime() + maxAgeMs);
        await getDb().query(
            `INSERT INTO auth_tokens (token_hash, subject_type, subject_id, client_type, device_name, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sha256Hex(token), subjectType, subjectId, clientType, deviceName ? String(deviceName).slice(0, 100) : null, expiresAt]
        );
        return { token, expiresAt, maxAgeMs };
    }

    /** 원문 토큰 → { tokenId, subjectType, subjectId, clientType } | null */
    async function resolveToken(token) {
        if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
        const db = getDb();
        const [rows] = await db.query(
            `SELECT token_id, subject_type, subject_id, client_type, last_used_at
               FROM auth_tokens
              WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
              LIMIT 1`,
            [sha256Hex(token), now()]
        );
        const row = rows[0];
        if (!row) return null;

        const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
        if (now().getTime() - lastUsed > LAST_USED_UPDATE_INTERVAL_MS) {
            // 실패해도 인증 자체는 성공으로 처리 (부가 정보)
            db.query('UPDATE auth_tokens SET last_used_at = ? WHERE token_id = ?', [now(), row.token_id])
                .catch(() => {});
        }
        return {
            tokenId: row.token_id,
            subjectType: row.subject_type,
            subjectId: row.subject_id,
            clientType: row.client_type
        };
    }

    async function revokeToken(token) {
        if (typeof token !== 'string' || !token) return;
        await getDb().query(
            'UPDATE auth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
            [now(), sha256Hex(token)]
        );
    }

    return {
        hashPassword,
        verifyPassword,
        verifyCredentials,
        issueToken,
        resolveToken,
        revokeToken
    };
}

// 기본 인스턴스: 실제 DB / bcrypt / .env 설정 사용 (lazy require → 단위 테스트 시 로드되지 않음)
let defaultInstance = null;
function getDefault() {
    if (!defaultInstance) {
        const env = require('../config/env');
        defaultInstance = createAuthService({
            getDb: () => require('../config/db'),
            getBcrypt: () => require('bcrypt'),
            config: env.auth
        });
    }
    return defaultInstance;
}

module.exports = {
    SUBJECT,
    CLIENT,
    sha256Hex,
    looksLikeBcrypt,
    createAuthService,
    // 기본 인스턴스 위임
    hashPassword: (...a) => getDefault().hashPassword(...a),
    verifyPassword: (...a) => getDefault().verifyPassword(...a),
    verifyCredentials: (...a) => getDefault().verifyCredentials(...a),
    issueToken: (...a) => getDefault().issueToken(...a),
    resolveToken: (...a) => getDefault().resolveToken(...a),
    revokeToken: (...a) => getDefault().revokeToken(...a)
};
