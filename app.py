import streamlit as st
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import plotly.express as px
from datetime import datetime
import pymysql
import threading
import time
import ctypes
import psutil

# ==========================================
# 🗄️ MySQL 데이터베이스 접속 정보
# ==========================================
DB_HOST = "localhost"   
DB_USER = "root"        
DB_PASSWORD = "비밀번호입력" # 💡 여기에 MySQL 비밀번호를 꼭 입력하세요!
DB_NAME = "nudgeai"     

def get_connection():
    return pymysql.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor
    )

# --- [DB 함수] 회원가입, 로그인, 로그 저장 ---
def save_user(user_id, password):
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("INSERT INTO users (user_id, password, current_stage) VALUES (%s, %s, 1)", (user_id, password))
        conn.commit()
        return True
    except pymysql.err.IntegrityError:
        return False
    finally:
        if 'conn' in locals() and conn.open: conn.close()

def check_login(user_id, password):
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE user_id=%s AND password=%s", (user_id, password))
            result = cursor.fetchone()
            if result: return True, result
    except Exception: pass
    finally:
        if 'conn' in locals() and conn.open: conn.close()
    return False, None

def save_app_log_to_db(user_id, app_name, app_category, dwell_seconds):
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            sql = "INSERT INTO app_usage_logs (user_id, app_name, app_category, dwell_seconds) VALUES (%s, %s, %s, %s)"
            cursor.execute(sql, (user_id, app_name, app_category, dwell_seconds))
        conn.commit()
    except Exception: pass
    finally:
        if 'conn' in locals() and conn.open: conn.close()

# ==========================================
# 🕵️‍♂️ 윈도우 실제 화면 감지 & 백그라운드 로거
# ==========================================
user32 = ctypes.windll.user32

def get_active_window():
    try:
        hwnd = user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return psutil.Process(pid.value).name()
    except Exception:
        return "unknown"

EXE_TO_CATEGORY = {
    "chrome.exe": "Video", "KakaoTalk.exe": "Social", "LeagueClient.exe": "Game",
    "Notion.exe": "Study", "Code.exe": "Study", "pycharm64.exe": "Study",
    "EXCEL.EXE": "Study", "WINWORD.EXE": "Study"
}

# 대시보드가 켜져 있는 동안 백그라운드에서 계속 기록하는 쓰레드 클래스
class AppLogger:
    def __init__(self):
        self.current_user_id = None
        self.running = True
        self.current_app = get_active_window()
        self.app_start_time = time.time()

    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while self.running:
            time.sleep(1) # 1초마다 화면 감지
            if not self.current_user_id: continue # 로그인 안했으면 기록 안함

            active = get_active_window()
            if active == "unknown" or active == self.current_app: continue
            
            # 앱이 전환되었을 때! (기존 앱 사용 시간을 DB에 저장)
            dwell = time.time() - self.app_start_time
            if dwell >= 1: # 1초 이상 머물렀을 때만 기록
                mapped_category = EXE_TO_CATEGORY.get(self.current_app, "Etc")
                save_app_log_to_db(self.current_user_id, self.current_app, mapped_category, int(dwell))
            
            self.current_app = active
            self.app_start_time = time.time()

# Streamlit 특성상 앱이 새로고침될 때 로거가 여러 개 생기는 것을 방지
@st.cache_resource
def get_logger():
    logger = AppLogger()
    logger.start()
    return logger

app_logger = get_logger()

# ==========================================
# 🧠 AI 모델 및 핵심 로직
# ==========================================
@st.cache_data
def generate_educational_data_cached(size=1500):
    np.random.seed(42)
    apps = ['YouTube', 'Instagram', 'KakaoTalk', 'Notion', 'Netflix', 'Game_LoL', 'Slack', 'Other']
    cat_map = {'YouTube':'Video', 'Netflix':'Video', 'Instagram':'Social',
               'KakaoTalk':'Social', 'Notion':'Study', 'Slack':'Study', 'Game_LoL':'Game', 'Other':'Etc'}
    data = [[np.random.choice(apps), cat_map[np.random.choice(apps)], np.random.randint(0, 24), np.random.randint(0, 2), np.random.randint(10, 150)] for _ in range(size)]
    df = pd.DataFrame(data, columns=['app_name', 'app_category', 'hour', 'is_weekend', 'usage_time_min'])
    df['target'] = ((df['app_category'].isin(['Social', 'Video'])) & (df['usage_time_min'] > 60)).astype(int)
    return df

@st.cache_resource
def train_ai_model(df):
    df_encoded = pd.get_dummies(df, columns=['app_category'])
    X = df_encoded.drop(['target', 'app_name'], axis=1)
    return RandomForestClassifier(n_estimators=100, random_state=42).fit(X, df_encoded['target']), X.columns

model, train_cols = train_ai_model(generate_educational_data_cached())

def get_nudge_text(prob):
    if prob > 0.8: return "🚨 위험! 뇌가 쉬고 싶어해요. 지금 당장 폰을 엎어두세요!"
    if prob > 0.6: return "💡 잠깐! 5분만 창밖을 보는 '디지털 디톡스' 어때요?"
    return "✅ 아주 건강한 사용 패턴입니다. 지금처럼만 유지하세요!"

# ==========================================
# 🖥️ 메인 UI 및 화면 구성
# ==========================================
def main():
    st.set_page_config(layout="wide", page_title="FocusFlow Dashboard")

    if 'logged_in' not in st.session_state:
        st.session_state['logged_in'] = False

    # --- 로그인 & 회원가입 화면 ---
    if not st.session_state['logged_in']:
        col1, col2, col3 = st.columns([1, 2, 1])
        with col2:
            st.markdown("---")
            st.title("┏━━━━━━━━━━━━━━━━━━━━┓")
            st.title("┃ 🧠 AI 스크린타임 코치 'FocusFlow' ┃")
            st.title("┗━━━━━━━━━━━━━━━━━━━━┛")
            
            tab1, tab2 = st.tabs(["🔑 로그인", "📝 회원가입"])
            
            with tab1:
                user_id_input = st.text_input("ID:", key="login_id")
                password_input = st.text_input("PW:", type="password", key="login_pw")
                if st.button("로그인", use_container_width=True):
                    success, info = check_login(user_id_input, password_input)
                    if success:
                        st.session_state['logged_in'] = True
                        st.session_state['user_info'] = info
                        st.session_state['user_id'] = user_id_input
                        app_logger.current_user_id = user_id_input # 백그라운드 로거에 사용자 식별자 전달!
                        st.rerun()
                    else: st.error("❌ 로그인 실패! DB 연결 또는 정보를 확인하세요.")
            with tab2:
                new_id = st.text_input("새 ID:", key="reg_id")
                new_pw = st.text_input("새 PW:", type="password", key="reg_pw")
                if st.button("회원가입", use_container_width=True):
                    if save_user(new_id, new_pw): st.success(f"🎉 '{new_id}'님 회원가입 완료!")
                    else: st.error("이미 존재하는 아이디입니다.")
        return

    # --- 메인 대시보드 화면 ---
    user_info = st.session_state['user_info']
    current_user_id = st.session_state['user_id']
    
    header_col1, header_col2, header_col3 = st.columns([4, 1, 3])
    with header_col1: st.header("🧠 FocusFlow Dashboard")
    with header_col3:
        st.write(f"사용자: **{current_user_id}**님 | 오늘 상태: **안정적 ({user_info['current_stage']}단계)**")
        if st.button("로그아웃"):
            st.session_state['logged_in'] = False
            app_logger.current_user_id = None # 로깅 중지
            st.rerun()
    st.markdown("---")

    row1_col1, row1_col2 = st.columns([1, 1])
    row2_col1, row2_col2 = st.columns([1, 1])

    with row1_col1:
        st.subheader("💡 오늘의 집중 점수")
        st.markdown("<h1 style='text-align: center; color: #4CAF50; font-size: 80px;'>78점</h1>", unsafe_allow_html=True)

    with row1_col2:
        st.subheader("📊 시간대별 흐름")
        hour_data = pd.DataFrame({'시간': ['09:00', '11:00', '13:00'], '집중': [45, 50, 20], '이탈': [8, 5, 20]})
        fig_hour = px.bar(hour_data, x='시간', y='집중', color_discrete_sequence=['#4CAF50'])
        fig_line = px.line(hour_data, x='시간', y='이탈', color_discrete_sequence=['#F44336'])
        for t in fig_line.data: t.yaxis = 'y2'; fig_hour.add_trace(t)
        fig_hour.update_layout(yaxis2=dict(overlaying='y', side='right'), showlegend=False, height=300)
        st.plotly_chart(fig_hour, use_container_width=True)

    with row2_col1:
        st.subheader("🚫 앱 사용 비율")
        fig_pie = px.pie(pd.DataFrame({'앱': ['YouTube', 'KakaoTalk', 'Etc'], '비율': [60, 30, 10]}), values='비율', names='앱', hole=0.5)
        fig_pie.update_layout(height=300)
        st.plotly_chart(fig_pie, use_container_width=True)

    with row2_col2:
        st.subheader("⚠ 실시간 행동 패턴 분석")
        
        # 💡 코랩 가상 데이터가 아닌, 내 컴퓨터의 "진짜" 현재 활성 창을 즉시 읽어옵니다.
        current_app_exe = get_active_window()
        mapped_category = EXE_TO_CATEGORY.get(current_app_exe, "Etc")
        
        st.write(f"👀 **현재 감지된 내 PC 앱:** `{current_app_exe}` (분류: {mapped_category})")
        st.caption("새로고침(우측 상단 Rerun)을 누를 때마다 현재 보고 있는 창을 실시간으로 다시 감지합니다.")
        
        current_status = pd.DataFrame([{
            'hour': datetime.now().hour, 'is_weekend': 1 if datetime.now().weekday() >= 5 else 0,
            'app_category_Etc': 1 if mapped_category == 'Etc' else 0,
            'app_category_Game': 1 if mapped_category == 'Game' else 0,
            'app_category_Social': 1 if mapped_category == 'Social' else 0,
            'app_category_Study': 1 if mapped_category == 'Study' else 0,
            'app_category_Video': 1 if mapped_category == 'Video' else 0
        }]).reindex(columns=train_cols, fill_value=0)
        
        prob = model.predict_proba(current_status)[0][1]
        st.warning(f"📊 실시간 분석 결과 | 과몰입 위험도: **{prob*100:.1f}%**")
        st.info(f"💬 **AI 가이드:** {get_nudge_text(prob)}")

if __name__ == "__main__":
    main()