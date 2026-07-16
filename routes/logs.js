const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 최신 로그 1건
router.get('/latest', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM app_usage_logs ORDER BY logged_at DESC LIMIT 1');
        if (rows.length > 0) res.status(200).json({ success: true, data: rows[0] });
        else res.status(404).json({ success: false, message: "데이터 없음" });
    } catch (err) { 
        console.error("Latest 불러오기 에러:", err.message);
        res.status(500).json({ success: false }); 
    }
});

// 로그 저장
router.post('/', async (req, res) => {
    const { user_id = 'jy16', app_name, category, dwell_seconds, ai_risk_percent = 0 } = req.body;
    console.log(`\n[데이터 도착 ] ${category === 'Lecture' ? ' 강의' : '딴짓'} - 앱: ${app_name}, 시간: ${dwell_seconds}초`);
    try {
        await pool.query('INSERT INTO app_usage_logs (user_id, app_name, category, dwell_seconds, ai_risk) VALUES (?, ?, ?, ?, ?)', [user_id, app_name, category, dwell_seconds, ai_risk_percent]);
        res.status(201).json({ success: true });
    } catch (err) { 
        console.error(" DB 저장 실패 (원인):", err.message); 
        res.status(500).json({ success: false }); 
    }
});

// 대시보드 오늘 통계
router.get('/dashboard/:userId', async (req, res) => {
    const { userId } = req.params;
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
router.get('/calendar/:userId', async (req, res) => {
    const { userId } = req.params;
    const days = parseInt(req.query.days) || 365;

    try {
        const [rows] = await pool.query(`
            SELECT
                DATE(logged_at)  AS date_str,
                category,
                SUM(dwell_seconds) AS total_seconds
            FROM app_usage_logs
            WHERE user_id = ?
              AND logged_at >= CURDATE() - INTERVAL ${days} DAY
            GROUP BY DATE(logged_at), category
            ORDER BY DATE(logged_at) ASC
        `, [userId]);

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
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── 시간대별 집중 흐름 (1h / 2h / 3h / 6h / 12h) ──
router.get('/hourly/:userId', async (req, res) => {
    const { userId } = req.params;
    const hours = parseInt(req.query.hours) || 1;
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
              AND logged_at >= NOW() - INTERVAL ${totalMinutes} MINUTE
            ORDER BY logged_at DESC
        `, [userId]);

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
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;