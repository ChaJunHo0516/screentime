import random
import time


class NudgeManager:
    def __init__(self, threshold_seconds=300, cooldown_seconds=60):
        self.threshold_seconds = threshold_seconds
        self.cooldown_seconds = cooldown_seconds
        self.last_popup_at = 0
        self.messages = {
            3: [
                "현재 집중 상태가 좋습니다. 계속 유지해보세요.",
                "좋아요. 지금처럼 강의 흐름을 이어가면 됩니다."
            ],
            2: [
                "잠깐 집중이 흐트러졌습니다. 강의창으로 돌아가 볼까요?",
                "딴짓 시간이 조금 쌓이고 있어요. 다시 강의 화면으로 돌아가보세요."
            ],
            1: [
                "5분 이상 강의창을 벗어났습니다. 짧게 정리하고 다시 집중해보세요.",
                "집중 단계가 낮아졌습니다. 1분만 쉬고 강의창으로 돌아가보세요.",
                "지금은 딴짓 시간이 길어졌습니다. 스트레칭 후 다시 시작해보세요."
            ]
        }

    def get_focus_level(self, distract_seconds):
        if distract_seconds < 60:
            return 3
        if distract_seconds < self.threshold_seconds:
            return 2
        return 1

    def get_message(self, focus_level):
        return random.choice(self.messages.get(focus_level, self.messages[1]))

    def should_popup(self, is_lecture_window, distract_seconds):
        if is_lecture_window:
            return False
        if distract_seconds < self.threshold_seconds:
            return False
        now = time.time()
        if now - self.last_popup_at < self.cooldown_seconds:
            return False
        self.last_popup_at = now
        return True
