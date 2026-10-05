// middleware/errorHandler.js
// 모든 API 에러 응답 형식을 통일한다.
//   { success: false, message: "<사용자 표시용>", error: { code: "<MACHINE_CODE>", message: "<동일>" } }
// - 기존 프론트엔드는 result.message 를 alert 로 보여주므로 top-level message 를 유지한다(호환).
// - 500 에러는 내부 정보를 노출하지 않는다. 서버 로그에도 요청 body(비밀번호 등)는 남기지 않는다.

class HttpError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const badRequest = (message, code = 'VALIDATION_ERROR', details) => new HttpError(400, code, message, details);
const unauthorized = (message = '로그인이 필요합니다.', code = 'AUTH_REQUIRED') => new HttpError(401, code, message);
const forbidden = (message = '접근 권한이 없습니다.', code = 'FORBIDDEN') => new HttpError(403, code, message);
const notFound = (message = '요청한 리소스를 찾을 수 없습니다.', code = 'NOT_FOUND') => new HttpError(404, code, message);

function sendError(res, status, code, message, details) {
    const body = { success: false, message, error: { code, message } };
    if (details) body.error.details = details;
    return res.status(status).json(body);
}

// /api/* 에서 매칭되는 라우트가 없을 때
function apiNotFound(req, res) {
    return sendError(res, 404, 'NOT_FOUND', 'API 경로를 찾을 수 없습니다.');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    // express.json() 파싱 실패
    if (err && err.type === 'entity.parse.failed') {
        return sendError(res, 400, 'INVALID_JSON', '요청 형식(JSON)이 올바르지 않습니다.');
    }
    if (err && err.type === 'entity.too.large') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE', '요청 크기가 너무 큽니다.');
    }
    if (err instanceof HttpError) {
        return sendError(res, err.status, err.code, err.message, err.details);
    }

    // 예상하지 못한 에러: 원인은 서버 로그에만, 응답에는 일반 메시지
    console.error(`[API ERROR] ${req.method} ${req.originalUrl}:`, err && (err.code || ''), err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', '서버 내부 에러가 발생했습니다.');
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, sendError, apiNotFound, errorHandler };
