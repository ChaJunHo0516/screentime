import json
import os
import time
import requests
import uiautomation as auto
import win32gui

from admin_manager import AdminManager
from app_blocker import AppBlocker
from focus_tracker import FocusTracker
from nudge_manager import NudgeManager
from popup_manager import show_popup

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
auto.SetGlobalSearchTimeout(1.0)


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_browser_url():
    window = win32gui.GetForegroundWindow()
    title = win32gui.GetWindowText(window)
    if "Chrome" in title:
        try:
            chrome = auto.WindowControl(searchDepth=1, ClassName="Chrome_WidgetWin_1")
            if chrome.Exists(0, 0):
                address_bar = chrome.EditControl(searchDepth=5, Name="주소 및 검색창")
                if not address_bar.Exists(0, 0):
                    address_bar = chrome.EditControl(searchDepth=5, Name="Address and search bar")
                if address_bar.Exists(0, 0):
                    return address_bar.GetValuePattern().Value
        except Exception:
            return None
    return None


def send_usage_log(log_url, user_id, app_name, category, dwell_seconds, focus_level):
    try:
        payload = {
            "user_id": user_id,
            "app_name": app_name,
            "category": category,
            "dwell_seconds": dwell_seconds,
            "ai_risk_percent": max(0, 4 - focus_level) * 25
        }
        res = requests.post(log_url, json=payload, timeout=3)
        if res.status_code == 201:
            print(f"✅ [전송 성공] {category} - {app_name}")
        else:
            print(f"❌ [DB 거절] 상태코드: {res.status_code}")
    except Exception as e:
        print(f"⚠️ [사용 로그 저장 실패] {e}")


# 차준호 2026-05-17 추가 | 대시보드 시작/정지 버튼 상태 확인
def is_tracking_active(base_url):
    try:
        res = requests.get(
            f"{base_url.rstrip('/')}/api/tracking/status",
            timeout=2
        )
        if res.status_code == 200:
            return res.json().get("active", True)
    except Exception:
        pass
    return True


def start_tracking():
    config = load_config()
    user_id = config.get("user_id", "jy16")
    base_url = config.get("server_base_url", "http://localhost:3000")
    poll_interval = int(config.get("poll_interval_seconds", 3))
    nudge_threshold = int(config.get("nudge_threshold_seconds", 300))
    nudge_cooldown = int(config.get("nudge_cooldown_seconds", 60))

    log_url = f"{base_url.rstrip('/')}/api/logs"
    admin_manager = AdminManager(base_url, user_id)
    app_blocker = AppBlocker(config.get("default_blocked_apps", []))
    focus_tracker = FocusTracker(config.get("lecture_keywords", []))
    nudge_manager = NudgeManager(nudge_threshold, nudge_cooldown)

    print("★★★ [FocusFlow 추적기 + 앱 종료 + 팝업 넛지 시작] ★★★")
    print(f"사용자: {user_id}, 넛지 기준: {nudge_threshold}초, 감시 주기: {poll_interval}초")

    while True:
        try:
            # 차준호 2026-05-17 추가 | 정지 상태이면 전송 건너뜀
            if not is_tracking_active(base_url):
                print("⏸️  [정지 중] 대시보드에서 정지됨 - 전송 건너뜀")
                time.sleep(poll_interval)
                continue

            # 차준호 2026-05-17 추가 | 매 루프마다 config.json 재로드 → 키워드 실시간 반영
            # 대시보드/어드민에서 추가·삭제 시 config.json이 직접 수정되므로
            # DB fetch 없이 config.json만 읽으면 항상 최신 키워드 유지됨
            try:
                fresh_config = load_config()
                fresh_keywords = fresh_config.get("lecture_keywords", [])
                if fresh_keywords != focus_tracker.lecture_keywords:
                    focus_tracker.lecture_keywords = fresh_keywords
                    print(f"🔄 [키워드 갱신] 총 {len(fresh_keywords)}개: {fresh_keywords}")
            except Exception as keyword_err:
                print(f"⚠️ [키워드 갱신 실패] {keyword_err} - 기존 키워드 유지")

            blocked_apps = admin_manager.fetch_blocked_apps()
            killed_processes = app_blocker.close_blocked_processes(blocked_apps)
            for item in killed_processes:
                print(f"🚫 [차단 앱 종료] {item['process_name']} 종료 완료")
                admin_manager.send_block_event(
                    item["matched_app"],
                    "BLOCK_PROCESS_KILLED",
                    f"실행 중인 프로세스 자동 종료: {item['process_name']}"
                )

            title = focus_tracker.get_active_window_title()
            if not title.strip():
                time.sleep(poll_interval)
                continue

            url = get_browser_url()
            app_name = focus_tracker.make_app_name(title, url)
            is_lecture, distract_seconds = focus_tracker.update_distract_time(title, poll_interval)
            focus_level = nudge_manager.get_focus_level(distract_seconds)
            category = "Lecture" if is_lecture else "Distract"

            blocked, matched_app = admin_manager.check_blocked(title)
            if blocked:
                print(f"🚫 [관리자 차단] {matched_app} 감지 → 현재 창 닫기")
                admin_manager.send_block_event(matched_app or app_name, "BLOCK_TRIGGERED", f"실행 창 제목: {title[:80]}")
                app_blocker.close_current_window()
                show_popup(f"{matched_app or app_name}은 관리자에 의해 차단된 앱입니다.", "관리자 차단 알림")
                time.sleep(poll_interval)
                continue

            if is_lecture:
                print(f"📘 [강의창 집중 중] {title[:80]}")
            else:
                # 차준호 2026-05-17 수정 | 팝업까지 남은 시간 출력
                remaining = max(0, nudge_manager.threshold_seconds - distract_seconds)
                print(f"⚠️ [딴짓 감지] {title[:80]} / 누적 {distract_seconds}초 / 팝업까지 {remaining}초 남음 / 집중 단계 {focus_level}")
                if nudge_manager.should_popup(is_lecture, distract_seconds):
                    message = nudge_manager.get_message(focus_level)
                    print(f"🔔 [팝업 실행] {message}")
                    show_popup(message)
                    focus_tracker.distract_seconds = 0

            send_usage_log(log_url, user_id, app_name, category, poll_interval, focus_level)

        except Exception as e:
            print(f"⚠️ [파이썬 에러] {e}")

        time.sleep(poll_interval)


if __name__ == "__main__":
    start_tracking()