// list.js
async function checkModels() {
    const apiKey = "AIzaSyCV2TJAVQIIHqdrj1qJCuNrQtzEFW4rTdo"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        console.log("구글 서버에 허락된 모델 명단을 요청하는 중...");
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            console.error("명단 조회 실패:", data.error.message);
            return;
        }

        console.log("\n [현재 API 키로 사용 가능한 모델 목록]");
        data.models.forEach(model => {
            // 우리가 필요한 텍스트 생성(generateContent) 기능이 있는 모델만 출력
            if (model.supportedGenerationMethods.includes("generateContent")) {
                console.log(model.name.replace("models/", ""));
            }
        });
        
    } catch (error) {
        console.error("❌ 네트워크 에러:", error);
    }
}

checkModels();