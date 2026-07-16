# FocusFlow 업데이트 내용

## 추가된 핵심 기능

1. 강의창 여부 감지
- `config.json`의 `lecture_keywords` 목록을 기준으로 현재 활성 창 제목을 검사합니다.
- 강의창으로 판단되면 딴짓 시간을 초기화하고 넛지를 실행하지 않습니다.

2. 딴짓 시간 누적
- 강의창이 아닌 창을 보고 있을 때만 `distract_seconds`가 누적됩니다.
- 기본 기준은 300초, 즉 5분입니다.

3. 단계별 넛지 팝업
- 딴짓 시간이 기준 시간을 넘으면 `tkinter` 팝업으로 넛지 메시지를 출력합니다.
- 집중 단계는 딴짓 시간에 따라 3, 2, 1단계로 계산됩니다.

4. 실행 중인 차단 앱 자동 종료
- 관리자 DB에 등록된 차단 앱 목록을 서버에서 가져옵니다.
- `psutil`로 실행 중인 프로세스를 확인하고, `steam.exe`, `KakaoTalk.exe`, `Discord.exe` 등 차단 앱이 실행 중이면 자동 종료합니다.

5. 모듈화
- `tracker.py`에 기능을 몰아넣지 않고 아래 파일로 나누었습니다.

```text
tracker.py
admin_manager.py
app_blocker.py
focus_tracker.py
nudge_manager.py
popup_manager.py
config.json
```

## 실행 방법

```bash
npm install
npm start
```

다른 터미널에서:

```bash
pip install -r requirements.txt
python tracker.py
```

## 설정 변경 위치

`config.json`에서 다음 값을 수정할 수 있습니다.

```json
{
  "user_id": "jy16",
  "nudge_threshold_seconds": 300,
  "lecture_keywords": ["Zoom", "Teams", "LMS", "강의", "온라인 수업", "YouTube"],
  "default_blocked_apps": ["steam.exe", "KakaoTalk.exe", "Discord.exe"]
}
```

## 발표용 설명

이번 업데이트에서는 사용자가 실제로 강의창을 보고 있는지 여부를 기준으로 집중 상태를 판단하도록 개선했습니다. 강의창이 아닌 카카오톡, 게임, SNS 등의 창을 보고 있을 때만 딴짓 시간이 누적되며, 5분 이상 지속될 경우 단계별 넛지 팝업이 출력됩니다. 또한 관리자가 등록한 차단 앱은 이미 실행 중이어도 프로세스 단위로 감지하여 자동 종료되도록 구현했습니다. 중요한 점은 강의창을 보고 있을 때는 넛지가 작동하지 않아 학습 흐름을 방해하지 않는다는 것입니다.
