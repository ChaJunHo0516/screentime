const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 실시간 Top 10 랭킹 가져오기
router.get('/top10', async (req, res) => {
    try {
        // 🌟 관리자는 언제든 열람 가능 (프론트에서 isAdmin=true 전송)
        const isAdmin = req.query.isAdmin === 'true';
        
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay(); // 0: 일요일 ~ 6: 토요일

        // 🌟 노출 조건: 하루의 마지막 1시간 (밤 23:00 ~ 23:59) 또는 일요일 전체
        const isEndOfDay = hour >= 15; 
        const isEndOfWeek = day === 0;

        // 관리자가 아니고 공개 시간도 아니라면 데이터를 차단 (잠금 메시지 응답)
        if (!isAdmin && !isEndOfDay && !isEndOfWeek) {
            return res.json({ 
                success: true, 
                isLocked: true, 
                message: "명예의 전당 랭킹은 하루의 마지막 시간 (23:00 ~ 23:59)\n또는 일요일에만 공개됩니다!\n끝까지 집중하세요!" 
            });
        }

        // 🌟 3개월 분기별 누적 및 초기화 로직
        const currentMonth = now.getMonth() + 1; // 1~12
        const currentQuarter = Math.ceil(currentMonth / 3);
        const currentYear = now.getFullYear();
        
        // 분기 시작 월 계산 (1분기:1월, 2분기:4월, 3분기:7월, 4분기:10월)
        const startMonth = (currentQuarter - 1) * 3 + 1; 
        const startDateStr = `${currentYear}-${String(startMonth).padStart(2, '0')}-01 00:00:00`;

        // DB 쿼리: 해당 분기의 시작일부터 지금까지의 'Lecture' 카테고리 누적 집중 시간 계산
        const query = `
            SELECT 
                user_id, 
                SUM(dwell_seconds) as total_focus_seconds
            FROM app_usage_logs
            WHERE logged_at >= ? AND category = 'Lecture'
            GROUP BY user_id
            ORDER BY total_focus_seconds DESC
            LIMIT 10
        `;
        
        const [rows] = await pool.query(query, [startDateStr]);
        
        // 랭킹 데이터를 프론트엔드가 쓰기 좋게 가공 (60초당 1점 기준)
        const rankingData = rows.map((row, index) => ({
            rank: index + 1,
            userId: row.user_id,
            rewardScore: Math.floor(row.total_focus_seconds / 60)
        }));

        // 결과 응답
        res.json({ 
            success: true, 
            isLocked: false, 
            quarter: currentQuarter, 
            ranking: rankingData 
        });

    } catch (err) {
        console.error("랭킹 시스템 에러:", err.message);
        res.status(500).json({ success: false });
    }
});

module.exports = router;