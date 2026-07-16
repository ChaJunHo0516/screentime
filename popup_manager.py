import tkinter as tk
from tkinter import messagebox


def show_popup(message, title="집중 넛지 알림"):
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        messagebox.showinfo(title, message)
        root.destroy()
    except Exception as e:
        print(f"⚠️ [팝업 출력 실패] {e}")
