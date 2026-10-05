const express = require('express');
const router = express.Router();
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { YoutubeTranscript } = require('youtube-transcript');

if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY Error");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const mainModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.2 }
});

const cache = new Map();
const inFlight = new Map();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function safeGenerate(prompt, cacheKey) {
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const requestPromise = (async () => {
        for (let i = 0; i < 2; i++) {
            try {
                const result = await mainModel.generateContent(prompt);
                const text = result.response?.text?.();
                if (!text) throw new Error("No response");
                cache.set(cacheKey, text);
                return text;
            } catch (err) {
                if (err.message.includes("503")) await sleep(800);
                else break;
            }
        }
        return null;
    })();

    inFlight.set(cacheKey, requestPromise);
    try { return await requestPromise; } finally { inFlight.delete(cacheKey); }
}

router.post('/generate-quiz', async (req, res) => {
    const { videoTitle } = req.body;
    const cacheKey = "quiz-" + videoTitle;
    
    let transcriptText = "";

    // 유튜브 아이디 추출
    const vidMatch = videoTitle.match(/\[VID:([\w-]{11})\]/);
    const videoId = vidMatch ? vidMatch[1] : null;

    if (videoId) {
        try {
            const transcript = await YoutubeTranscript.fetchTranscript(videoId);
            // 긴 영상 대비, 넉넉하게 앞부분을 가져옵니다.
            transcriptText = transcript.map(t => t.text).join(' ').substring(0, 8000); 
            console.log(`✅ [${videoId}] 자막 추출 완료!`);
        } catch (e) {
            console.log(`⚠️ [${videoId}] 자막 추출 실패 (자동 생성 자막이거나 막혀있음)`);
        }
    }

    // 🔥 도망가지 않도록 AI 프롬프트(명령)를 유연하게 완벽 보완!
    const prompt = `
당신은 똑똑한 IT 튜터입니다. 아래 정보를 보고 학습용 퀴즈 2개를 무조건 생성하세요.

[영상 제목]: ${videoTitle}
[자막 내용]: ${transcriptText ? transcriptText : "(자막 데이터 없음)"}

[출제 규칙 - 매우 중요]
1. 자막 내용에 기술적인 개념이 있다면 그것을 활용해서 문제를 내세요.
2. 만약 자막 데이터가 없거나, 자막이 단순한 인사말/오프닝뿐이어서 문제를 내기 어렵다면, **'영상 제목(예: 파이썬)'을 보고 해당 기술에 대한 기초/핵심 지식을 바탕으로 직접 문제를 창작하세요.**
3. "이 영상의 길이는?", "강사의 이름은?" 같은 무의미한 질문은 절대 금지합니다.
4. 어떤 상황에서도 거절하지 말고, 반드시 아래 JSON 포맷으로만 응답하세요.

{
  "q1": {
    "question": "질문 내용 (5지선다)",
    "options": ["보기1", "보기2", "보기3", "보기4", "보기5"],
    "answerIndex": 0
  },
  "q2": {
    "question": "질문 내용 (OX문제)",
    "answer": "O"
  }
}
`;

    try {
        const text = await safeGenerate(prompt, cacheKey);
        if (!text) throw new Error("AI Fail");
        // AI가 혹시라도 마크다운이나 헛소리를 섞었을 경우를 대비한 강력 필터링
        const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        const quizData = JSON.parse(cleaned);
        res.json({ success: true, quiz: quizData });
    } catch (error) {
        console.error("퀴즈 생성 실패:", error.message);
        res.json({ success: false });
    }
});

router.post('/verify-quiz', async (req, res) => {
    const { userAnswers, correctAnswers } = req.body;
    try {
        const q1Correct = String(userAnswers[0]) === String(correctAnswers[0]);
        const q2Correct = String(userAnswers[1]) === String(correctAnswers[1]);
        const score = (q1Correct ? 50 : 0) + (q2Correct ? 50 : 0);
        res.json({
            success: true,
            score: score,
            isFocused: score >= 100,
            feedback: score === 100 ? "완벽합니다! 20점을 획득했습니다!" : "틀린 문제가 있습니다. 다시 시도해보세요!"
        });
    } catch (error) {
        res.json({ success: false, score: 0 });
    }
});

module.exports = router;