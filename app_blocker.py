import psutil
import win32con
import win32gui


class AppBlocker:
    def __init__(self, default_blocked_apps=None):
        self.default_blocked_apps = default_blocked_apps or []

    def normalize(self, value):
        return (value or "").strip().lower()

    def is_match(self, target, blocked_app):
        target_value = self.normalize(target)
        blocked_value = self.normalize(blocked_app)
        if not target_value or not blocked_value:
            return False
        if blocked_value in target_value:
            return True
        if blocked_value.endswith(".exe"):
            return blocked_value.replace(".exe", "") in target_value
        return f"{blocked_value}.exe" == target_value

    def close_current_window(self):
        window = win32gui.GetForegroundWindow()
        if window:
            win32gui.PostMessage(window, win32con.WM_CLOSE, 0, 0)

    def close_blocked_processes(self, blocked_apps):
        killed = []
        block_list = list(dict.fromkeys((blocked_apps or []) + self.default_blocked_apps))
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                process_name = proc.info.get("name") or ""
                matched_app = next((app for app in block_list if self.is_match(process_name, app)), None)
                if matched_app:
                    proc.kill()
                    killed.append({"process_name": process_name, "matched_app": matched_app})
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
            except Exception as e:
                print(f"⚠️ [프로세스 종료 실패] {e}")
        return killed
