import requests


class AdminManager:
    def __init__(self, base_url, user_id):
        self.base_url = base_url.rstrip("/")
        self.user_id = user_id
        self.block_check_url = f"{self.base_url}/api/admin/block/check"
        self.blocked_apps_url = f"{self.base_url}/api/admin/blocked-apps"
        self.block_event_url = f"{self.base_url}/api/admin/block-events"

    def check_blocked(self, app_name):
        try:
            res = requests.get(self.block_check_url, params={
                "user_id": self.user_id,
                "app_name": app_name
            }, timeout=2)
            if res.status_code != 200:
                return False, None
            data = res.json()
            return bool(data.get("blocked")), data.get("matched_app")
        except Exception as e:
            print(f"⚠️ [차단 확인 실패] {e}")
            return False, None

    def fetch_blocked_apps(self):
        try:
            res = requests.get(self.blocked_apps_url, params={"user_id": self.user_id}, timeout=2)
            if res.status_code != 200:
                return []
            data = res.json()
            apps = data.get("blocked_apps", [])
            return [app.get("app_name") for app in apps if app.get("is_active") and app.get("app_name")]
        except Exception as e:
            print(f"⚠️ [차단 앱 목록 불러오기 실패] {e}")
            return []

    def send_block_event(self, app_name, event_type, reason):
        try:
            requests.post(self.block_event_url, json={
                "user_id": self.user_id,
                "app_name": app_name,
                "event_type": event_type,
                "reason": reason
            }, timeout=2)
        except Exception as e:
            print(f"⚠️ [차단 로그 저장 실패] {e}")
