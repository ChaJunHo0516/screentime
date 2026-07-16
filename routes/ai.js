const express = require('express');
const router = express.Router();
const pool = require('../config/db');
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.7 }
}) : null;

function getFocusStage(category, focusPercent) {
    if (category !== 'Lecture' && Number(focusPercent || 0) < 50) return 4;
    if (Number(focusPercent || 0) >= 80) return 3;
    if (Number(focusPercent || 0) >= 50) return 2;
    return 1;
}

router.post('/nudge', async (req, res) => {
    // 차준호 2026-05-17 추가 | username으로 닉네임 호칭
    const { appName, category, score, focusPercent, username } = req.body;
    const displayName = username ? username + '님' : '학습자님';
    const focusStage = getFocusStage(category, focusPercent);

    try {
        const [messages] = await pool.query(
            'SELECT message_text FROM nudge_messages WHERE focus_stage = ? ORDER BY updated_at DESC LIMIT 1',
            [focusStage]
        );

        if (!model || messages.length > 0) {
            const message = messages[0]?.message_text || '집중 흐름을 다시 정리해볼까요?';
            return res.status(200).json({ success: true, message });
        }

        // 차준호 2026-05-17 추가 | 닉네임 호칭 적용
        const prompt = `
당신은 '온라인 강의 집중도'를 관리해주는 FocusFlow의 AI 코치입니다.

현재 사용자 상태:
- 사용자 호칭: ${displayName}
- 앱: ${appName}
- 상태: ${category === 'Lecture' ? '강의 수강 중' : '딴짓 중'}
- 집중률: ${focusPercent}%
- 점수: ${score}
- 집중 단계: ${focusStage}

[규칙]
1. 1~2문장 (최대 40자)
2. 딴짓이면 강하게 복귀 유도
3. 강의 중이면 짧게 칭찬
4. 자연스럽게 말하기
5. 반드시 '${displayName}'으로 호칭할 것 (다른 이름 절대 사용 금지)
`;

        const result = await model.generateContent(prompt);
        const text = result.response?.text?.();
        if (!text) throw new Error("AI 응답 없음");
        res.status(200).json({ success: true, message: text.trim() });
    } catch (error) {
        console.error("[AI NUDGE ERROR]", error.message);
        res.status(200).json({ success: true, message: "집중 흐름을 다시 정리해볼까요?" });
    }
});

module.exports = router;