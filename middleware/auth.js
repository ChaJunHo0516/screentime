// middleware/auth.js
// 인증(누구인가)과 인가(무엇을 할 수 있는가)를 담당한다.
//
// 토큰 전달 방식
//   * 브라우저: HttpOnly 쿠키  ff_session(사용자) / ff_admin(관리자)  — JS에서 읽을 수 없어 XSS로 탈취 불가
//   * Windows agent: Authorization: Bearer <token>
//
// 결과
//   req.user  = { id, tokenId, clientType }   (사용자로 인증된 경우)
//   req.admin = { id, tokenId }               (관리자로 인증된 경우)
//
// 사용자 ID는 항상 서버가 토큰으로 결정한다. URL/body 의 user_id 는 신뢰하지 않는다.
const authService = require('../services/authService');
const { unauthorized, forbidden } = require('./errorHandler');

const USER_COOKIE = 'ff_session';
const ADMIN_COOKIE = 'ff_admin';

function cookieOptions(maxAgeMs) {
    const env = require('../config/env');
    return {
        httpOnly: true,
        sameSite: 'lax',          // 다른 사이트에서의 POST 에는 쿠키가 실리지 않음 (CSRF 완화)
        secure: env.auth.cookieSecure,
        path: '/',
        ...(maxAgeMs ? { maxAge: maxAgeMs } : {})
    };
}

function setAuthCookie(res, name, token, maxAgeMs) {
    res.cookie(name, token, cookieOptions(maxAgeMs));
}

function clearAuthCookie(res, name) {
    res.clearCookie(name, cookieOptions());
}

function bearerToken(req) {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match ? match[1] : null;
}

function createAuthenticate(service = authService) {
    return async function authenticate(req, res, next) {
        try {
            req.user = null;
            req.admin = null;

            const candidates = [];
            const bearer = bearerToken(req);
            if (bearer) candidates.push(bearer);
            const cookies = req.cookies || {};
            if (cookies[USER_COOKIE]) candidates.push(cookies[USER_COOKIE]);
            if (cookies[ADMIN_COOKIE]) candidates.push(cookies[ADMIN_COOKIE]);

            for (const token of candidates) {
                const info = await service.resolveToken(token);
                if (!info) continue;
                if (info.subjectType === 'USER' && !req.user) {
                    req.user = { id: info.subjectId, tokenId: info.tokenId, clientType: info.clientType };
                } else if (info.subjectType === 'ADMIN' && !req.admin) {
                    req.admin = { id: info.subjectId, tokenId: info.tokenId };
                }
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}

function requireUser(req, res, next) {
    if (req.user) return next();
    return next(unauthorized());
}

function requireAdmin(req, res, next) {
    if (req.admin) return next();
    if (req.user) return next(forbidden('관리자 권한이 필요합니다.'));
    return next(unauthorized('관리자 로그인이 필요합니다.'));
}

function requireUserOrAdmin(req, res, next) {
    if (req.user || req.admin) return next();
    return next(unauthorized());
}

function sameId(a, b) {
    // MySQL 기본 collation 은 대소문자를 구분하지 않으므로 비교도 동일하게 한다.
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

/**
 * URL 파라미터의 사용자 ID 가 "인증된 본인" 인지 검증한다. 관리자는 통과.
 * 기존 1.0 대시보드 경로(/dashboard/:userId 등) 호환을 위해 사용한다.
 */
function ensureSelfParam(paramName = 'userId') {
    return function ensureSelf(req, res, next) {
        if (req.admin) return next();
        if (!req.user) return next(unauthorized());
        if (!sameId(req.params[paramName], req.user.id)) {
            return next(forbidden('다른 사용자의 데이터에는 접근할 수 없습니다.'));
        }
        return next();
    };
}

module.exports = {
    USER_COOKIE,
    ADMIN_COOKIE,
    authenticate: createAuthenticate(),
    createAuthenticate,
    requireUser,
    requireAdmin,
    requireUserOrAdmin,
    ensureSelfParam,
    setAuthCookie,
    clearAuthCookie,
    bearerToken,
    sameId
};
