const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const env = require('./config/env');

// 2.0 Phase 1 | 필수 환경변수 확인 (누락 시 이름만 출력하고 종료)
env.validate();

const pool = require('./config/db');
const { authenticate, requireUser, requireUserOrAdmin } = require('./middleware/auth');
const { apiNotFound, errorHandler, badRequest } = require('./middleware/errorHandler');

const app = express();
const PORT = env.port;

// 2.0 Phase 1 | 보안 헤더. CSP 는 현재 inline onclick/script 와 CDN Chart.js 때문에 비활성화
//               (Phase 9 프론트 분리 후 활성화 예정)
app.use(helmet({ contentSecurityPolicy: false }));

// 2.0 Phase 1 | CORS 전체 허용 제거. public/ 을 같은 서버에서 서빙하므로 기본은 same-origin.
//               다른 origin 이 필요할 때만 CORS_ORIGINS 에 명시한다. (agent 는 브라우저가 아니므로 CORS 무관)
if (env.corsOrigins.length > 0) {
    app.use(cors({ origin: env.corsOrigins, credentials: true }));
}

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 2.0 Phase 1 | 모든 API 요청에서 토큰(쿠키/Bearer)을 확인해 req.user / req.admin 을 채운다.
app.use('/api', authenticate);

const authRoutes = require('./routes/auth');
const logRoutes = require('./routes/logs');
const aiRoutes = require('./routes/ai');
const rewardRoutes = require('./routes/reward');
const adminRoutes = require('./routes/admin');
const rankingRoutes = require('./routes/ranking');

app.use('/api/auth', authRoutes);
app.use('/api/logs', logRoutes);                       // 라우터 내부에서 인증/본인 검증
app.use('/api/ai', requireUser, aiRoutes);             // Gemini 비용 남용 방지: 로그인 사용자만
app.use('/api/reward', requireUser, rewardRoutes);
app.use('/api/admin', adminRoutes);                    // 라우터 내부에서 requireAdmin / requireUser
app.use('/api/ranking', requireUserOrAdmin, rankingRoutes);

// ── API v2 ──
// 2.0 Phase 2 | Focus Session
app.use('/api/v2/sessions', requireUser, require('./routes/v2/sessions'));

// ── 트래킹 시작/정지 상태 ──
// 차준호 2026-05-17 추가 | 트래킹 시작/정지 상태 관리
// 2.0 Phase 1 | 서버 전역 변수(trackingActive) 제거 → 사용자별 user_settings.tracking_paused
//   - 한 사용자의 정지가 다른 사용자에게 영향을 주지 않는다.
//   - 응답 형태 { active } 는 기존 대시보드/agent 와 호환.
//   - Phase 3 에서 agent 가 실제 상태를 보고(heartbeat)하는 구조로 확장 예정.
async function setTrackingPaused(userId, paused) {
    await pool.query(
        `INSERT INTO user_settings (user_id, tracking_paused) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE tracking_paused = VALUES(tracking_paused)`,
        [userId, paused ? 1 : 0]
    );
}

app.get('/api/tracking/status', requireUser, async (req, res) => {
    const [rows] = await pool.query('SELECT tracking_paused FROM user_settings WHERE user_id = ?', [req.user.id]);
    const active = rows.length === 0 ? true : !rows[0].tracking_paused;
    res.json({ active });
});
app.post('/api/tracking/start', requireUser, async (req, res) => {
    await setTrackingPaused(req.user.id, false);
    res.json({ success: true, active: true });
});
app.post('/api/tracking/stop', requireUser, async (req, res) => {
    await setTrackingPaused(req.user.id, true);
    res.json({ success: true, active: false });
});

// ── config.json 키워드 읽기/쓰기 API ──
// 차준호 2026-05-17 추가 | 대시보드·어드민에서 키워드 추가/삭제 시 config.json에 직접 반영
// 2.0 Phase 1 | 인증 + 입력 검증 추가.
//   ⚠️ 알려진 한계: 키워드는 아직 "모든 사용자 공통"(config.json). Phase 4 에서 사용자별 DB 규칙으로 이전한다.
const CONFIG_PATH = path.join(__dirname, 'config.json');

function readKeywordInput(req) {
    const { keyword } = req.body || {};
    if (typeof keyword !== 'string' || !keyword.trim()) throw badRequest('키워드를 입력하세요.');
    const kw = keyword.trim();
    if (kw.length > 50) throw badRequest('키워드는 50자 이하로 입력하세요.');
    if (/[\u0000-\u001f<>]/.test(kw)) throw badRequest('키워드에 사용할 수 없는 문자가 있습니다.');
    return kw;
}

app.get('/api/config/keywords', requireUserOrAdmin, (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        res.json({ success: true, keywords: config.lecture_keywords || [] });
    } catch (err) {
        console.error('config 읽기 실패:', err.message);
        res.status(500).json({ success: false, message: '키워드를 불러오지 못했습니다.' });
    }
});

app.post('/api/config/keywords', requireUserOrAdmin, (req, res) => {
    const kw = readKeywordInput(req);
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        config.lecture_keywords = config.lecture_keywords || [];
        if (config.lecture_keywords.includes(kw)) {
            return res.json({ success: false, message: '이미 등록된 키워드입니다.' });
        }
        config.lecture_keywords.push(kw);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
        res.json({ success: true, keywords: config.lecture_keywords });
    } catch (err) {
        console.error('config 쓰기 실패:', err.message);
        res.status(500).json({ success: false, message: '키워드를 저장하지 못했습니다.' });
    }
});

app.delete('/api/config/keywords', requireUserOrAdmin, (req, res) => {
    const kw = readKeywordInput(req);
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        config.lecture_keywords = (config.lecture_keywords || []).filter(k => k !== kw);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
        res.json({ success: true, keywords: config.lecture_keywords });
    } catch (err) {
        console.error('config 쓰기 실패:', err.message);
        res.status(500).json({ success: false, message: '키워드를 삭제하지 못했습니다.' });
    }
});

// 2.0 Phase 1 | 공통 에러 처리 (모든 라우트 뒤에 위치)
app.use('/api', apiNotFound);
app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
