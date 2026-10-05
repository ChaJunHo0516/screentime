import argparse
import getpass
import json
import os
import sys
import time
import uiautomation as auto
import win32gui

from admin_manager import AdminManager
from agent.auth import token_store
from agent.sync.api_client import ApiClient, ApiError, AuthError
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


# 2.0 Phase 1 | user_id 를 보내지 않는다. 서버가 Bearer 토큰으로 사용자를 결정한다.
#               (Phase 3 에서 이 함수의 역할은 agent/sync 의 ActivityBuffer + batch 업로드로 이전된다)
def send_usage_log(api, app_name, category, dwell_seconds, focus_level):
    try:
        payload = {
            "app_name": app_name,
            "category": category,
            "dwell_seconds": dwell_seconds,
            "ai_risk_percent": max(0, 4 - focus_level) * 25
        }
        res = api.post("/api/logs", json=payload, timeout=3)
        if res.status_code == 201:
            print(f"✅ [전송 성공] {category} - {app_name}")
        else:
            print(f"❌ [DB 거절] 상태코드: {res.status_code}")
    except AuthError:
        raise
    except ApiError as e:
        print(f"⚠️ [사용 로그 저장 실패] {e}")


# 차준호 2026-05-17 추가 | 대시보드 시작/정지 버튼 상태 확인
# 2.0 Phase 1 | 사용자별 상태 조회(토큰). 서버에 닿지 않으면 "마지막으로 알려진 상태"를 유지한다.
#               (기존: 실패 시 무조건 True → 정지해도 서버 장애 시 추적이 재개되던 문제)
_last_tracking_state = {"active": True}


def is_tracking_active(api):
    try:
        res = api.get("/api/tracking/status", timeout=2)
        if res.status_code == 200:
            _last_tracking_state["active"] = bool(res.json().get("active", True))
    except AuthError:
        raise
    except (ApiError, ValueError):
        pass
    return _last_tracking_state["active"]


def login_interactive(base_url):
    """python tracker.py --login : 아이디/비밀번호로 agent 토큰을 발급받아 Windows 자격 증명 관리자에 저장."""
    print(f"FocusFlow 서버: {base_url}")
    user_id = input("아이디: ").strip()
    password = getpass.getpass("비밀번호: ")
    try:
        token, user_info = ApiClient.login(base_url, user_id, password)
    except ApiError as e:
        print(f"❌ 로그인 실패: {e}")
        return 1
    try:
        token_store.save_token(base_url, token)
    except token_store.TokenStoreError as e:
        print(f"❌ 토큰 저장 실패: {e}")
        return 1
    print(f"✅ 로그인 완료: {user_info.get('username') or user_info.get('user_id')} — 이제 `python tracker.py` 로 실행하세요.")
    return 0


def logout_interactive(base_url):
    token = token_store.load_token(base_url)
    if token:
        ApiClient(base_url, token).logout()
    token_store.delete_token(base_url)
    print("✅ 로그아웃 완료 (이 PC에 저장된 토큰 삭제)")
    return 0


def start_tracking():
    config = load_config()
    base_url = config.get("server_base_url", "http://localhost:3000")
    poll_interval = int(config.get("poll_interval_seconds", 3))
    nudge_threshold = int(config.get("nudge_threshold_seconds", 300))
    nudge_cooldown = int(config.get("nudge_cooldown_seconds", 60))

    # 2.0 Phase 1 | config.json 의 user_id 대신 로그인 토큰으로 사용자를 식별한다.
    token = token_store.load_token(base_url)
    if not token:
        print("🔐 로그인이 필요합니다. 먼저 `python tracker.py --login` 을 실행하세요.")
        return 1
    api = ApiClient(base_url, token)
    try:
        user_info = api.me()
    except AuthError as e:
        print(f"🔐 {e}")
        return 1
    except ApiError as e:
        print(f"⚠️ 서버 연결 실패 ({e}). 서버를 켠 뒤 다시 실행하세요.")
        return 1
    user_label = user_info.get("username") or user_info.get("user_id")

    admin_manager = AdminManager(api)
    app_blocker = AppBlocker(config.get("default_blocked_apps", []))
    focus_tracker = FocusTracker(config.get("lecture_keywords", []))
    nudge_manager = NudgeManager(nudge_threshold, nudge_cooldown)

    print("★★★ [FocusFlow 추적기 + 앱 종료 + 팝업 넛지 시작] ★★★")
    print(f"사용자: {user_label}, 넛지 기준: {nudge_threshold}초, 감시 주기: {poll_interval}초")

    while True:
        try:
            # 차준호 2026-05-17 추가 | 정지 상태이면 전송 건너뜀
            if not is_tracking_active(api):
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

            send_usage_log(api, app_name, category, poll_interval, focus_level)

        except AuthError as e:
            # 토큰 만료/폐기 → 다른 사용자 명의로 계속 전송하지 않도록 즉시 중단
            print(f"🔐 {e}")
            return 1
        except Exception as e:
            print(f"⚠️ [파이썬 에러] {e}")

        time.sleep(poll_interval)


def main(argv=None):
    parser = argparse.ArgumentParser(description="FocusFlow Windows Agent")
    parser.add_argument("--login", action="store_true", help="로그인하고 agent 토큰을 이 PC에 저장")
    parser.add_argument("--logout", action="store_true", help="저장된 agent 토큰을 폐기/삭제")
    args = parser.parse_args(argv)
    base_url = load_config().get("server_base_url", "http://localhost:3000")
    if args.login:
        return login_interactive(base_url)
    if args.logout:
        return logout_interactive(base_url)
    return start_tracking()


if __name__ == "__main__":
    sys.exit(main())