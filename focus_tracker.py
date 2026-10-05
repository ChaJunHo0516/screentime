import re
import win32gui


class FocusTracker:
    def __init__(self, lecture_keywords=None):
        self.lecture_keywords = lecture_keywords or []
        self.distract_seconds = 0

    def get_active_window_title(self):
        window = win32gui.GetForegroundWindow()
        if not window:
            return ""
        return win32gui.GetWindowText(window) or ""

    def is_lecture_window(self, title):
        lowered_title = (title or "").lower()
        return any(keyword.lower() in lowered_title for keyword in self.lecture_keywords)

    def update_distract_time(self, title, elapsed_seconds):
        is_lecture = self.is_lecture_window(title)
        if is_lecture:
            self.distract_seconds = 0
        else:
            self.distract_seconds += elapsed_seconds
        return is_lecture, self.distract_seconds

    def make_app_name(self, title, url=None):
        safe_title = (title or "")[:60]
        vid = ""
        if url:
            match = re.search(r'(?:v=|youtu\.be/)([\w-]{11})', url)
            if match:
                vid = match.group(1)
        return f"{safe_title} [VID:{vid}]" if vid else safe_title
