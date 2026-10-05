from agent.sync.api_client import ApiError, AuthError


class AdminManager:
    # 2.0 Phase 1 | user_id 를 직접 보내지 않고, 인증된 ApiClient(Bearer 토큰)를 사용한다.
    #               서버가 토큰으로 사용자를 결정하므로 다른 사용자의 차단 정보를 조회/기록할 수 없다.
    def __init__(self, api_client):
        self.api = api_client
        self.block_check_path = "/api/admin/block/check"
        self.blocked_apps_path = "/api/admin/blocked-apps"
        self.block_event_path = "/api/admin/block-events"

    def check_blocked(self, app_name):
        try:
            res = self.api.get(self.block_check_path, params={"app_name": app_name}, timeout=2)
            if res.status_code != 200:
                return False, None
            data = res.json()
            return bool(data.get("blocked")), data.get("matched_app")
        except AuthError:
            raise
        except (ApiError, ValueError) as e:
            print(f"⚠️ [차단 확인 실패] {e}")
            return False, None

    def fetch_blocked_apps(self):
        try:
            res = self.api.get(self.blocked_apps_path, timeout=2)
            if res.status_code != 200:
                return []
            data = res.json()
            apps = data.get("blocked_apps", [])
            return [app.get("app_name") for app in apps if app.get("is_active") and app.get("app_name")]
        except AuthError:
            raise
        except (ApiError, ValueError) as e:
            print(f"⚠️ [차단 앱 목록 불러오기 실패] {e}")
            return []

    def send_block_event(self, app_name, event_type, reason):
        try:
            self.api.post(self.block_event_path, json={
                "app_name": app_name,
                "event_type": event_type,
                "reason": reason
            }, timeout=2)
        except AuthError:
            raise
        except ApiError as e:
            print(f"⚠️ [차단 로그 저장 실패] {e}")
