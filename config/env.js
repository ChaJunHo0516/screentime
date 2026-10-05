// config/env.js
// 환경변수를 한 곳에서 읽고 검증한다. 다른 모듈은 process.env 대신 이 모듈을 사용한다.
// secret 값은 절대 로그로 출력하지 않는다 (누락된 "이름"만 출력).
require('dotenv').config();

const REQUIRED = ['DB_USER', 'DB_NAME'];
// DB_PASSWORD는 빈 문자열이 유효할 수 있으므로 "정의 여부"만 확인한다.
const REQUIRED_DEFINED = ['DB_PASSWORD'];

function int(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) throw new Error(`환경변수 ${name} 는 숫자여야 합니다.`);
    return n;
}

function bool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function list(name) {
    return String(process.env[name] || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function validate() {
    const missing = [
        ...REQUIRED.filter(k => !process.env[k]),
        ...REQUIRED_DEFINED.filter(k => process.env[k] === undefined)
    ];
    if (missing.length > 0) {
        const msg = `필수 환경변수가 없습니다: ${missing.join(', ')}\n` +
            `.env.example 을 .env 로 복사한 뒤 값을 채워주세요.`;
        throw new Error(msg);
    }
}

const env = {
    validate,
    port: int('PORT', 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: int('DB_PORT', 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        socketPath: process.env.DB_SOCKET_PATH || undefined
    },
    auth: {
        userTokenTtlHours: int('USER_TOKEN_TTL_HOURS', 168),
        agentTokenTtlDays: int('AGENT_TOKEN_TTL_DAYS', 30),
        adminTokenTtlHours: int('ADMIN_TOKEN_TTL_HOURS', 12),
        bcryptCost: int('BCRYPT_COST', 12),
        cookieSecure: bool('COOKIE_SECURE', false)
    },
    corsOrigins: list('CORS_ORIGINS'),
    geminiApiKey: process.env.GEMINI_API_KEY || ''
};

module.exports = env;
