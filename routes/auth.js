const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pool = require('../config/db');
const authService = require('../services/authService');
const {
    USER_COOKIE, setAuthCookie, clearAuthCookie, bearerToken, requireUser
} = require('../middleware/auth');
const { badRequest, unauthorized, HttpError } = require('../middleware/errorHandler');

// 2.0 Phase 1 | 무차별 대입 방지: IP 당 15분에 20회
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
        success: false,
        message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
        error: { code: 'TOO_MANY_REQUESTS', message: '로그인 시도가 너무 많습니다.' }
    })
});

const USER_ID_RE = /^[A-Za-z0-9_]{4,50}$/;

function str(value) {
    return typeof value === 'string' ? value : '';
}

router.post('/register', loginLimiter, async (req, res) => {
    const userId = str(req.body.user_id).trim();
    const password = str(req.body.password);
    const username = str(req.body.username).trim();

    if (!USER_ID_RE.test(userId)) {
        throw badRequest('아이디는 영문/숫자/밑줄(_) 4~50자로 입력하세요.');
    }
    if (password.length < 8 || password.length > 72) {   // bcrypt 는 72바이트까지만 사용
        throw badRequest('비밀번호는 8~72자로 입력하세요.');
    }
    if (!username || username.length > 50) {
        throw badRequest('닉네임은 1~50자로 입력하세요.');
    }

    const hash = await authService.hashPassword(password);
    try {
        // password(평문) 컬럼에는 더 이상 저장하지 않는다.
        await pool.query(
            'INSERT INTO users (user_id, password, password_hash, password_updated_at, username) VALUES (?, NULL, ?, NOW(), ?)',
            [userId, hash, username]
        );
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            throw new HttpError(409, 'DUPLICATE_USER', '이미 존재하는 아이디입니다.');
        }
        throw err;
    }
    res.status(201).json({ success: true, message: "가입 성공" });
});

// body: { user_id, password, client?: 'web' | 'agent', device_name? }
//  - web  : HttpOnly 쿠키로 토큰 전달 (응답 body 에는 토큰 없음)
//  - agent: 응답 body 의 token 을 agent 가 Windows 자격 증명 관리자에 저장
router.post('/login', loginLimiter, async (req, res) => {
    const userId = str(req.body.user_id).trim();
    const password = str(req.body.password);
    const isAgent = str(req.body.client).toLowerCase() === 'agent';

    if (!userId || !password || userId.length > 50 || password.length > 200) {
        throw badRequest('아이디와 비밀번호를 입력하세요.');
    }

    const user = await authService.verifyCredentials('USER', userId, password);
    if (!user) {
        throw unauthorized('아이디 또는 비밀번호가 일치하지 않습니다.', 'INVALID_CREDENTIALS');
    }

    const issued = await authService.issueToken({
        subjectType: 'USER',
        subjectId: user.user_id,
        clientType: isAgent ? 'AGENT' : 'WEB',
        deviceName: isAgent ? str(req.body.device_name) : null
    });

    // 기존 1.0 응답 형태(user_info.username) 유지 + 정규화된 user_id 추가
    const body = {
        success: true,
        user_info: { user_id: user.user_id, username: user.username }
    };
    if (isAgent) {
        body.token = issued.token;
        body.expires_at = issued.expiresAt.toISOString();
    } else {
        setAuthCookie(res, USER_COOKIE, issued.token, issued.maxAgeMs);
    }
    res.status(200).json(body);
});

router.post('/logout', async (req, res) => {
    const token = bearerToken(req) || (req.cookies && req.cookies[USER_COOKIE]);
    if (token) await authService.revokeToken(token);
    clearAuthCookie(res, USER_COOKIE);
    res.json({ success: true });
});

router.get('/me', requireUser, async (req, res) => {
    const [rows] = await pool.query('SELECT user_id, username FROM users WHERE user_id = ?', [req.user.id]);
    if (!rows[0]) throw unauthorized('계정을 찾을 수 없습니다.');
    res.json({ success: true, user_info: rows[0], client: req.user.clientType });
});

module.exports = router;
