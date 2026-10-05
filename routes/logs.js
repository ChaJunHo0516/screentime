const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireUser, requireUserOrAdmin, ensureSelfParam, sameId } = require('../middleware/auth');
const { badRequest } = require('../middleware/errorHandler');

// 2.0 Phase 1 | 모든 로그 API는 인증 필요. 사용자 ID는 토큰 기준(req.user.id)으로 결정한다.
router.use(requireUserOrAdmin);

// ensureSelfParam 통과 후: 본인이면 토큰의 정규화된 ID, (관리자 조회면) URL 값
function targetUserId(req) {
    if (req.user && sameId(req.params.userId, req.user.id)) return req.user.id;
    return req.params.userId;
}

const ALLOWED_CATEGORIES = new Set(['Lecture', 'Distract']);
const ALLOWED_HOURS = new Set([1, 2, 3, 6, 12]);

// 최신 로그 1건
// 2.0 Phase 1 | 시스템 전역 최신 로그 → "인증된 사용자 본인"의 최신 로그
router.get('/latest', requireUser, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT log_id, user_id, app_name, category, dwell_seconds, ai_risk, logged_at FROM app_usage_logs WHERE user_id = ? ORDER BY logged_at DESC, log_id DESC LIMIT 1',
            [req.user.id]
        );
        if (rows.length > 0) res.status(200).json({ success: true, data: rows[0] });
        else res.status(404).json({ success: false, message: "데이터 없음" });
    } catch (err) { 
        console.error("Latest 불러오기 에러:", err.message);
        res.status(500).json({ success: false }); 
    }
});

// 로그 저장
// 2.0 Phase 1 | body 의 user_id 는 무시하고 토큰의 사용자로 저장한다 (타인 명의 로그 주입 차단).
router.post('/', requireUser, async (req, res) => {
    const { app_name, category, dwell_seconds, ai_risk_percent = 0 } = req.body || {};
    const userId = req.user.id;

    if (typeof app_name !== 'string' || !app_name.trim()) throw badRequest('app_name 이 필요합니다.');
    if (!ALLOWED_CATEGORIES.has(category)) throw badRequest('category 는 Lecture 또는 Distract 여야 합니다.');
    const dwell = Number(dwell_seconds);
    if (!Number.isInteger(dwell) || dwell < 0 || dwell > 600) throw badRequest('dwell_seconds 는 0~600 정수여야 합니다.');
    const risk = Math.min(100, Math.max(0, Number(ai_risk_percent) || 0));
    const safeAppName = app_name.slice(0, 100);   // 컬럼 길이(100) 초과 방지

    // 창 제목은 개인정보이므로 서버 로그에 출력하지 않는다.
    try {
        await pool.query('INSERT INTO app_usage_logs (user_id, app_name, category, dwell_seconds, ai_risk) VALUES (?, ?, ?, ?, ?)', [userId, safeAppName, category, dwell, risk]);
        res.status(201).json({ success: true });
    } catch (err) { 
        console.error(" DB 저장 실패 (원인):", err.code || err.message); 
        res.status(500).json({ success: false }); 
    }
});

// 대시보드 오늘 통계
router.get('/dashboard/:userId', ensureSelfParam('userId'), async (req, res) => {
    const userId = targetUserId(req);
    try {
        const [todayRows] = await pool.query('SELECT category, SUM(dwell_seconds) as total_seconds FROM app_usage_logs WHERE user_id = ? AND DATE(logged_at) = CURDATE() GROUP BY category', [userId]);

        const categoryTime = { Lecture: 0, Distraction: 0 };
        todayRows.forEach(row => {
            if (row.category === 'Lecture') categoryTime.Lecture += parseInt(row.total_seconds || 0);
            else categoryTime.Distraction += parseInt(row.total_seconds || 0);
        });

        let focusScore = Math.floor(categoryTime.Lecture / 36);
        if (focusScore > 100) focusScore = 100; 

        const [recentRows] = await pool.query(`SELECT category, dwell_seconds, TIMESTAMPDIFF(MINUTE, logged_at, NOW()) as diff_mins FROM app_usage_logs WHERE user_id = ? AND logged_at >= NOW() - INTERVAL 1 HOUR ORDER BY logged_at DESC`, [userId]);

        const barLabels = ['48~60분 전', '36~48분 전', '24~36분 전', '12~24분 전', '최근 12분'];
        const focusMin = [0, 0, 0, 0, 0];
        const distractMin = [0, 0, 0, 0, 0];
        let totalFocusSec1Hour = 0; 

        recentRows.forEach(row => {
            if (row.category === 'Lecture') totalFocusSec1Hour += row.dwell_seconds;
            const diffMinutes = row.diff_mins; 
            let intervalIndex = -1;
            if (diffMinutes <= 12) intervalIndex = 4;        
            else if (diffMinutes > 12 && diffMinutes <= 24) intervalIndex = 3;   
            else if (diffMinutes > 24 && diffMinutes <= 36) intervalIndex = 2;   
            else if (diffMinutes > 36 && diffMinutes <= 48) intervalIndex = 1;   
            else if (diffMinutes > 48 && diffMinutes <= 60) intervalIndex = 0;   
            if (intervalIndex !== -1) {
                if (row.category === 'Lecture') focusMin[intervalIndex] += (row.dwell_seconds / 60); 
                else distractMin[intervalIndex] += (row.dwell_seconds / 60); 
            }
        });

        let focusPercent = (totalFocusSec1Hour / 36.0); 
        if (focusPercent > 100) focusPercent = 100;
        let focusStage = 1; 
        if (focusPercent >= 80) focusStage = 3;
        else if (focusPercent >= 50) focusStage = 2;

        res.status(200).json({ 
            success: true, 
            score: focusScore, 
            pieData: [categoryTime.Lecture, categoryTime.Distraction], 
            barData: { labels: barLabels, focusMin, distractMin }, 
            focusPercent: focusPercent, 
            focusStage: focusStage 
        });
    } catch (err) { 
        console.error("Dashboard 통계 에러:", err.message);
        res.status(500).json({ success: false }); 
    }
});

// ── 달력용: 날짜별 점수/집중시간/이탈시간 집계 ──
// 🔥 only_full_group_by 에러 해결: DATE(logged_at)만 GROUP BY에 사용, DATE_FORMAT은 JS에서 처리
router.get('/calendar/:userId', ensureSelfParam('userId'), async (req, res) => {
    const userId = targetUserId(req);
    // 2.0 Phase 1 | 범위 제한 + SQL 파라미터화
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 365, 1), 366);

    try {
        const [rows] = await pool.query(`
            SELECT
                DATE(logged_at)  AS date_str,
                category,
                SUM(dwell_seconds) AS total_seconds
            FROM app_usage_logs
            WHERE user_id = ?
              AND logged_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(logged_at), category
            ORDER BY DATE(logged_at) ASC
        `, [userId, days]);

        // DATE 객체를 'YYYY-MM-DD' 문자열로 변환 (JS에서 처리)
        const dataMap = {};
        rows.forEach(row => {
            const raw = row.date_str;
            // MySQL DATE 타입은 JS Date 객체로 오므로 직접 포맷팅
            let d;
            if (raw instanceof Date) {
                const y = raw.getFullYear();
                const m = String(raw.getMonth() + 1).padStart(2, '0');
                const dd = String(raw.getDate()).padStart(2, '0');
                d = `${y}-${m}-${dd}`;
            } else {
                // 이미 문자열인 경우 그대로 사용
                d = String(raw).slice(0, 10);
            }

            if (!dataMap[d]) dataMap[d] = { lectureSec: 0, distractSec: 0 };
            if (row.category === 'Lecture') dataMap[d].lectureSec += parseInt(row.total_seconds || 0);
            else dataMap[d].distractSec += parseInt(row.total_seconds || 0);
        });

        // 점수 및 집중률 계산
        const result = {};
        Object.entries(dataMap).forEach(([date, val]) => {
            const total = val.lectureSec + val.distractSec;
            const focusRate = total > 0 ? Math.round((val.lectureSec / total) * 100) : 0;
            let score = Math.floor(val.lectureSec / 36);
            if (score > 100) score = 100;

            result[date] = {
                score,
                lectureSec: val.lectureSec,
                distractSec: val.distractSec,
                focusRate
            };
        });

        res.status(200).json({ success: true, data: result });
    } catch (err) {
        console.error("Calendar 통계 에러:", err.message);
        res.status(500).json({ success: false, message: '달력 데이터를 불러오지 못했습니다.' });
    }
});

// ── 시간대별 집중 흐름 (1h / 2h / 3h / 6h / 12h) ──
router.get('/hourly/:userId', ensureSelfParam('userId'), async (req, res) => {
    const userId = targetUserId(req);
    const hours = parseInt(req.query.hours, 10) || 1;
    if (!ALLOWED_HOURS.has(hours)) throw badRequest('hours 는 1, 2, 3, 6, 12 중 하나여야 합니다.');
    const totalMinutes = hours * 60;
    const intervalMin = totalMinutes / 5;

    try {
        const [rows] = await pool.query(`
            SELECT
                category,
                dwell_seconds,
                TIMESTAMPDIFF(MINUTE, logged_at, NOW()) as diff_mins
            FROM app_usage_logs
            WHERE user_id = ?
              AND logged_at >= NOW() - INTERVAL ? MINUTE
            ORDER BY logged_at DESC
        `, [userId, totalMinutes]);

        const focusMin    = [0, 0, 0, 0, 0];
        const distractMin = [0, 0, 0, 0, 0];

        rows.forEach(row => {
            const diff = row.diff_mins;
            const idx = 4 - Math.min(Math.floor(diff / intervalMin), 4);
            if (row.category === 'Lecture') focusMin[idx]    += row.dwell_seconds / 60;
            else                            distractMin[idx] += row.dwell_seconds / 60;
        });

        const labels = ['4', '3', '2', '1', '0'];
        res.status(200).json({ success: true, barData: { labels, focusMin, distractMin } });
    } catch (err) {
        console.error("Hourly 통계 에러:", err.message);
        res.status(500).json({ success: false, message: '시간대별 데이터를 불러오지 못했습니다.' });
    }
});

module.exports = router;