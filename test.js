const { GoogleGenerativeAI } = require("@google/generative-ai");

// ★ 주의: .env를 안 거치고 여기에 방금 받은 새 키를 직접 붙여넣습니다!
const genAI = new GoogleGenerativeAI("AIzaSyCV2TJAVQIIHqdrj1qJCuNrQtzEFW4rTdo"); 

async function test() {
    try {
        console.log("직통 연결 테스트 시작...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent("안녕? 넌 누구니?");
        console.log("✅ 성공:", result.response.text());
    } catch (e) {
        console.error("❌ 에러 발생:", e.message);
    }
}

test();