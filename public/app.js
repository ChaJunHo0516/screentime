// ── 대시보드 및 전역 변수 ──
let barChartInstance = null;
let pieChartInstance = null;
let currentQuiz     = null;
let selectedOX      = null;
let isQuizActive    = false;
let solvedVideos    = new Set();

// 🔥 퀴즈 보너스 점수
let localBonusScore = 0; 

let accumulatedTime = 0;
let lastTrackedApp = "";

let lastLectureTitle = "";
let lectureTime = 0; 
let lastNudgeApp = "";

let currentBarMode  = 'min'; 
let isTracking      = true;  
let pollInterval    = null;
let currentTimeUnit = 'min';
let currentChartType = 'bar';
let lastBarData = null;

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;        
let calData  = {};        

// 🌟 커스텀 집중 키워드 관리
// 차준호 2026-05-17 추가 | config.json 기반으로 변경 (localStorage 제거)
let focusKeywords = [];

const SERVER_URL = 'http://localhost:3000';

// ── 인증 및 회원가입 ──
function showRegister() { 
    document.getElementById('login-card').classList.add('hidden'); 
    document.getElementById('register-card').classList.remove('hidden'); 
}

function showLogin() { 
    document.getElementById('register-card').classList.add('hidden'); 
    document.getElementById('login-card').classList.remove('hidden'); 
}

async function login() {
    const userId = document.getElementById('userId').value; 
    const userPw = document.getElementById('userPw').value;
    if (!userId || !userPw) return alert("모두 입력해주세요."); 
    try {
        const response = await fetch(`${SERVER_URL}/api/auth/login`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ user_id: userId, password: userPw }) 
        });
        const result = await response.json();
        if (result.success) {
            localStorage.setItem('focusflow_user_id', userId); 
            localStorage.setItem('focusflow_user_name', result.user_info.username || userId); 
            window.location.href = '/dashboard.html';
        } else alert(result.message);
    } catch (e) { alert("서버 연결 실패. 서버가 켜져있는지 확인하세요."); }
}

async function register() {
    const userId = document.getElementById('userId').value.trim();
    const userPw = document.getElementById('userPw').value.trim();
    const userName = document.getElementById('userName').value.trim();

    if (!userId || !userPw || !userName) return alert('아이디, 비밀번호, 닉네임을 모두 입력해주세요.');

    try {
        const response = await fetch(`${SERVER_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, password: userPw, username: userName })
        });
        const result = await response.json();
        if (result.success) {
            alert('회원가입 완료! 로그인 화면으로 이동합니다.');
            window.location.href = '/';
        } else {
            alert(result.message || '회원가입 실패');
        }
    } catch (e) { alert('서버 연결 실패'); }
}

function logout() { localStorage.clear(); window.location.href = '/'; }

// ── 키워드 관리 로직 ──
// 차준호 2026-05-17 추가 | 서버(config.json)에서 키워드 로드
async function loadKeywordsFromServer() {
    try {
        const res = await fetch('/api/config/keywords');
        const data = await res.json();
        if (data.success) {
            focusKeywords = data.keywords;
            renderFocusKeywords();
        }
    } catch (e) {
        console.error('키워드 로드 실패:', e.message);
    }
}

function renderFocusKeywords() {
    const container = document.getElementById('keyword-list-container');
    if (!container) return;
    container.innerHTML = '';
    focusKeywords.forEach(kw => {
        const span = document.createElement('span');
        span.style = "background:#334155; padding:6px 14px; border-radius:20px; font-size:13px; display:flex; align-items:center; gap:8px;";
        span.innerHTML = `${kw} <button onclick="removeFocusKeyword('${kw}')" style="background:transparent; border:none; color:#f87171; cursor:pointer; font-weight:bold; padding:0;">✕</button>`;
        container.appendChild(span);
    });
}

// 차준호 2026-05-17 추가 | 키워드 추가 → config.json에 반영
async function addFocusKeyword() {
    const input = document.getElementById('new-keyword-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    try {
        const res = await fetch('/api/config/keywords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: val })
        });
        const result = await res.json();
        if (result.success) {
            focusKeywords = result.keywords;
            input.value = '';
            renderFocusKeywords();
        } else {
            alert(result.message || '추가 실패');
        }
    } catch (e) {
        alert('서버 오류: ' + e.message);
    }
}

// 차준호 2026-05-17 추가 | 키워드 삭제 → config.json에 반영
async function removeFocusKeyword(kw) {
    try {
        const res = await fetch('/api/config/keywords', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: kw })
        });
        const result = await res.json();
        if (result.success) {
            focusKeywords = result.keywords;
            renderFocusKeywords();
        } else {
            alert(result.message || '삭제 실패');
        }
    } catch (e) {
        alert('서버 오류: ' + e.message);
    }
}

// ── 트래킹 ON / OFF ──
async function startTracking() {
    await fetch(`${SERVER_URL}/api/tracking/start`, { method: 'POST' });
    isTracking = true; updateTrackingUI(true);
    if (!pollInterval) pollInterval = setInterval(fetchLatestLog, 5000);
}

async function stopTracking() {
    await fetch(`${SERVER_URL}/api/tracking/stop`, { method: 'POST' });
    isTracking = false; updateTrackingUI(false);
}

function updateTrackingUI(active) {
    const dot   = document.getElementById('tracking-status-dot');
    const label = document.getElementById('tracking-label');
    const btnStart = document.getElementById('btn-track-start');
    const btnStop  = document.getElementById('btn-track-stop');
    if (!dot) return;
    if (active) {
        dot.classList.remove('off'); label.textContent = '추적 중';
        btnStart.style.display = 'none'; btnStop.style.display  = '';
    } else {
        dot.classList.add('off'); label.textContent = '정지됨';
        btnStart.style.display = ''; btnStop.style.display  = 'none';
    }
}

async function syncTrackingStatus() {
    try {
        const res = await fetch(`${SERVER_URL}/api/tracking/status`);
        const data = await res.json();
        isTracking = data.active;
        updateTrackingUI(data.active);
    } catch {}
}

// ── CMD 및 시스템 도구 퀴즈 오작동 차단 필터 ──
function isRealVideo(title) {
    if (!title) return false;
    const t = title.toLowerCase();

    const blockedWords = ['cmd', '명령 프롬프트', 'powershell', 'terminal', '.exe', 'code', 'pycharm', '대시보드', 'focusflow', 'localhost'];
    if (blockedWords.some(word => t.includes(word))) return false;

    return focusKeywords.some(kw => t.includes(kw.toLowerCase()));
}

// ── 실시간 데이터 및 대시보드 통계 가져오기 ──
async function fetchLatestLog() {
    if (!isTracking) return;
    
    const userId = localStorage.getItem('focusflow_user_id') || 'jy16';

    try {
        const timestamp = new Date().getTime();
        const logRes = await fetch(`${SERVER_URL}/api/logs/latest?_t=${timestamp}`);
        const logResult = await logRes.json();
        
        let currentTitle = "";

        if (logResult.success && logResult.data) {
            currentTitle = logResult.data.app_name || "";
            
            if (currentTitle === lastTrackedApp) {
                accumulatedTime += (logResult.data.dwell_seconds || 3);
            } else {
                lastTrackedApp = currentTitle;
                accumulatedTime = logResult.data.dwell_seconds || 3;
            }
            
            const elCurrentApp = document.getElementById('current-app');
            if (elCurrentApp) elCurrentApp.innerText = currentTitle;
            
            const elAppCat = document.getElementById('app-category');
            if (elAppCat) elAppCat.innerText = logResult.data.category === 'Lecture' ? '강의 수강 중' : '딴짓/이탈 중';
            
            const elAppTime = document.getElementById('app-time');
            if (elAppTime) elAppTime.innerText = accumulatedTime + "초";

            if (logResult.data.category === 'Lecture' && isRealVideo(currentTitle)) {
                if (currentTitle === lastLectureTitle) {
                    lectureTime += (logResult.data.dwell_seconds || 3);
                } else {
                    lastLectureTitle = currentTitle;
                    lectureTime = (logResult.data.dwell_seconds || 3);
                }
            } else {
                const isDashboard = currentTitle.toLowerCase().includes('localhost') || 
                                    currentTitle.toLowerCase().includes('dashboard') || 
                                    currentTitle.toLowerCase().includes('focusflow');
                if (!isDashboard && !isQuizActive) {
                    lectureTime = 0;
                }
            }
        }

        const statsRes = await fetch(`${SERVER_URL}/api/logs/dashboard/${userId}?_t=${timestamp}`);
        const statsResult = await statsRes.json();

        if (statsResult.success) {
            let finalScore = statsResult.score + localBonusScore;
            if (finalScore > 100) finalScore = 100;

            const elScore = document.getElementById('today-score');
            if (elScore) elScore.innerText = finalScore + "점";
            
            const elPercent = document.getElementById('focus-percent');
            if (elPercent) elPercent.innerText = Math.round(statsResult.focusPercent || 0);
            
            if (currentBarMode === 'min') {
                if (statsResult.barData && statsResult.barData.labels) {
                    lastBarData = statsResult.barData;
                    renderBarChart(statsResult.barData);
                }
            } else {
                const hours = parseInt(currentBarMode.replace('h', ''));
                try {
                    const hrRes = await fetch(`${SERVER_URL}/api/logs/hourly/${userId}?hours=${hours}&_t=${timestamp}`);
                    const hrData = await hrRes.json();
                    if (hrData.success && hrData.barData) {
                        lastBarData = hrData.barData;
                        renderBarChart(hrData.barData);
                    }
                } catch(e) {
                    if(lastBarData) renderBarChart(lastBarData);
                }
            }

            if (statsResult.pieData) {
                renderPieChart(statsResult.pieData);
            }

            // 달력 당일 점수 실시간 병합
            if (document.getElementById('cal-grid')) {
                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                
                let totalLectureSec = statsResult.pieData ? statsResult.pieData[0] : 0;
                let totalDis = statsResult.pieData ? statsResult.pieData[1] : 0;
                let total = totalLectureSec + totalDis;
                let rate = total > 0 ? Math.round((totalLectureSec / total) * 100) : 0;

                if(!calData[todayStr]) calData[todayStr] = {};
                calData[todayStr].score = finalScore;
                calData[todayStr].lectureSec = totalLectureSec;
                calData[todayStr].distractSec = totalDis;
                calData[todayStr].focusRate = rate;

                renderCalendar(); 
            }

            const isDashboard = currentTitle.toLowerCase().includes('localhost') || 
                                currentTitle.toLowerCase().includes('dashboard') || 
                                currentTitle.toLowerCase().includes('focusflow');
            
            const quizContainer = document.getElementById('quiz-container');

            if ((isRealVideo(currentTitle) || isDashboard) && lastLectureTitle && !solvedVideos.has(lastLectureTitle) && lectureTime >= 10) {
                if (!quizContainer && !isQuizActive) {
                    showQuizSection(lastLectureTitle);
                } else if (quizContainer) {
                    quizContainer.style.display = 'block'; 
                }
            } else {
                if (quizContainer) quizContainer.style.display = 'none'; 
            }
            
            if (currentTitle !== lastNudgeApp && logResult.data) {
                lastNudgeApp = currentTitle;
                updateAiNudge(currentTitle, logResult.data.category, finalScore, statsResult.focusPercent);
            }
        }
    } catch (err) { console.error("데이터 동기화 실패", err); }
}

async function updateAiNudge(appName, category, score, focusPercent) {
    const nudgeEl = document.getElementById('ai-nudge');
    if (!nudgeEl) return;
    try {
        const aiRes = await fetch(`${SERVER_URL}/api/ai/nudge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appName, category, score, focusPercent })
        });
        const aiResult = await aiRes.json();
        if (aiResult.success) {
            let msgBox = document.getElementById('ai-msg-box');
            if (!msgBox) {
                msgBox = document.createElement('div');
                msgBox.id = 'ai-msg-box';
                nudgeEl.prepend(msgBox);
            }
            msgBox.innerText = aiResult.message;
        }
    } catch (e) { console.log("AI Nudge Timeout"); }
}

// ── 퀴즈 시스템 ──
function showQuizSection(videoTitle) {
    const nudgeEl = document.getElementById('ai-nudge');
    if (!nudgeEl || isQuizActive) return;

    isQuizActive = true;
    const quizContainer = document.createElement('div');
    quizContainer.id = 'quiz-container';
    quizContainer.style = "margin-top:15px; background:rgba(255,255,255,0.05); padding:15px; border-radius:10px; border:1px solid #4CAF50; color:#fff;";
    quizContainer.innerHTML = "<p>자막을 분석하여 퀴즈를 만들고 있습니다...</p>";
    nudgeEl.appendChild(quizContainer);

    let cleanTitle = videoTitle;
    cleanTitle = cleanTitle.replace(/ - Google Chrome$/i, '')
                        .replace(/ - YouTube$/i, '')
                        .replace(/ - Microsoft Edge$/i, '')
                        .replace(/ - Whale$/i, '')
                        .trim();

    fetch(`${SERVER_URL}/api/reward/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: cleanTitle })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.quiz) {
            currentQuiz = data.quiz;
            renderQuizUI(quizContainer, data.quiz);
        } else {
            isQuizActive = false;
            quizContainer.remove();
        }
    }).catch(() => { isQuizActive = false; });
}

function renderQuizUI(container, quiz) {
    container.style.display = 'block'; 
    let html = `<div style="text-align:left;"><p style="color:#4CAF50; font-weight:bold; margin-bottom:10px;">[집중도 테스트]</p>
        <p style="margin-bottom:10px;"><strong>Q1. ${quiz.q1.question}</strong></p>`;
    quiz.q1.options.forEach((opt, i) => {
        html += `<label style="display:block; margin:5px 0; padding:8px; background:rgba(255,255,255,0.1); border-radius:5px; cursor:pointer;">
            <input type="radio" name="q1" value="${i}"> ${opt}</label>`;
    });
    html += `<p style="margin:15px 0 10px;"><strong>Q2. ${quiz.q2.question}</strong></p>
        <div style="display:flex; gap:10px;">
            <button onclick="selectOX('O')" id="btn-O" style="flex:1; padding:10px; background:#334155; color:#fff; border:none; border-radius:5px; cursor:pointer;">O</button>
            <button onclick="selectOX('X')" id="btn-X" style="flex:1; padding:10px; background:#334155; color:#fff; border:none; border-radius:5px; cursor:pointer;">X</button>
        </div>
        <button onclick="submitQuiz()" style="width:100%; background:#4CAF50; border:none; padding:12px; border-radius:5px; color:#fff; font-weight:bold; cursor:pointer; margin-top:15px;">제출하기</button></div>`;
    container.innerHTML = html;
}

function selectOX(val) {
    selectedOX = val;
    document.getElementById('btn-O').style.background = val === 'O' ? '#4CAF50' : '#334155';
    document.getElementById('btn-X').style.background = val === 'X' ? '#4CAF50' : '#334155';
}

async function submitQuiz() {
    const q1Val = document.querySelector('input[name="q1"]:checked');
    if (!q1Val || !selectedOX) return alert("정답을 모두 선택해 주세요.");

    const res = await fetch(`${SERVER_URL}/api/reward/verify-quiz`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            userAnswers: [q1Val.value, selectedOX], 
            correctAnswers: [currentQuiz.q1.answerIndex, currentQuiz.q2.answer] 
        })
    });
    const result = await res.json();
    alert(`[${result.score}점] ${result.feedback}`);
    
    if (result.isFocused) {
        // 차준호 2026-05-17 수정 | dwell_seconds:1200 로그 삽입 제거
        // 기존: DB에 1200초(33점) 추가 + localBonusScore 20점 = 53점 버그
        // 수정: localBonusScore += 20 만으로 정확히 20점 지급
        localBonusScore += 20;
        
        solvedVideos.add(lastLectureTitle);
        document.getElementById('quiz-container').remove();
        isQuizActive = false;
        currentQuiz = null;
        selectedOX = null;
        
        fetchLatestLog(); 
    }
}

// ── 차트 렌더링 ──
function renderBarChart(barData) {
    const ctxBar = document.getElementById('barChart');
    if (!ctxBar || !barData || !barData.labels || barData.labels.length === 0) return;
    
    if (barChartInstance) barChartInstance.destroy();
    
    const isLine = (currentChartType === 'line');

    let displayLabels = [];
    if (currentBarMode !== 'min') {
        const hours = parseInt(currentBarMode.replace('h', ''));
        const intervalMin = (hours * 60) / 5;
        
        for (let i = 4; i >= 0; i--) {
            const lo = i * intervalMin;
            const hi = (i + 1) * intervalMin;
            
            const formatTime = (valMin) => {
                if (valMin < 60) return `${Math.round(valMin)}분`;
                const hr = valMin / 60;
                return Number.isInteger(hr) ? `${hr}시간` : `${hr.toFixed(1)}시간`;
            };
            
            if (lo === 0) displayLabels.push(`최근 ${formatTime(hi)}`);
            else displayLabels.push(`${formatTime(hi)}~${formatTime(lo)} 전`);
        }
    } else {
        displayLabels = [...barData.labels]; 
    }

    const focusData = barData && barData.focusMin ? barData.focusMin : [0,0,0,0,0];
    const distractData = barData && barData.distractMin ? barData.distractMin : [0,0,0,0,0];

    barChartInstance = new Chart(ctxBar.getContext('2d'), {
        type: isLine ? 'line' : 'bar',
        data: {
            labels: displayLabels,
            datasets: [
                {
                    label: '강의 시청(분)', 
                    data: focusData, 
                    backgroundColor: isLine ? 'rgba(76,175,80,0.15)' : '#4CAF50',
                    borderColor: '#4CAF50', 
                    borderWidth: isLine ? 2 : 0, 
                    pointBackgroundColor: '#4CAF50', 
                    tension: isLine ? 0.35 : 0, 
                    fill: isLine
                },
                {
                    label: '딴짓 이탈(분)', 
                    data: distractData, 
                    backgroundColor: isLine ? 'rgba(244,67,54,0.15)' : '#F44336',
                    borderColor: '#F44336', 
                    borderWidth: isLine ? 2 : 0, 
                    pointBackgroundColor: '#F44336', 
                    tension: isLine ? 0.35 : 0, 
                    fill: isLine
                }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderPieChart(pieData) {
    const ctxPie = document.getElementById('pieChart');
    if (!ctxPie) return;

    let safePieData = pieData;
    if (!pieData || (pieData[0] === 0 && pieData[1] === 0)) safePieData = [0.001, 0.001];

    if (pieChartInstance) pieChartInstance.destroy();
    pieChartInstance = new Chart(ctxPie.getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['강의 집중', '딴짓/이탈'], datasets: [{ data: safePieData, backgroundColor: ['#4CAF50', '#F44336'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// ── 토글 기능 모음 ──
function toggleChartType() {
    currentChartType = (currentChartType === 'bar') ? 'line' : 'bar';
    const btn = document.getElementById('btn-chart-type');
    if (btn) btn.textContent = (currentChartType === 'bar') ? '점선' : '막대';
    if (lastBarData) renderBarChart(lastBarData); 
}

async function switchBarMode(mode, btnEl) {
    currentBarMode = mode;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    
    const userId = localStorage.getItem('focusflow_user_id') || 'jy16';
    
    renderBarChart(null); 

    if (mode === 'min') {
        try {
            const res = await fetch(`${SERVER_URL}/api/logs/dashboard/${userId}`);
            const data = await res.json();
            if (data.success) { lastBarData = data.barData; renderBarChart(data.barData); document.getElementById('bar-chart-title').textContent = '시간대별 집중 흐름 (분)'; }
        } catch(e) {}
    } else {
        const hours = parseInt(mode); 
        try {
            const res = await fetch(`${SERVER_URL}/api/logs/hourly/${userId}?hours=${hours}`);
            const data = await res.json();
            if (data.success) { lastBarData = data.barData; renderBarChart(data.barData); document.getElementById('bar-chart-title').textContent = `시간대별 집중 흐름 (${mode})`; }
        } catch(e) {}
    }
}

async function toggleTimeUnit() {
    const userId  = localStorage.getItem('focusflow_user_id') || 'jy16';
    const btn     = document.getElementById('btn-time-unit');
    const hourTabs = document.getElementById('hour-tabs');

    if (currentTimeUnit === 'min') {
        currentTimeUnit = 'hour'; currentBarMode  = '1h'; btn.textContent = '분'; 
        hourTabs.style.display = 'flex';
        document.getElementById('bar-chart-title').textContent = '시간대별 집중 흐름 (1시간)';
        document.querySelectorAll('.hour-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.hour-tab-btn[data-hours="1"]').classList.add('active');
        
        renderBarChart(null); 

        try {
            const res  = await fetch(`${SERVER_URL}/api/logs/hourly/${userId}?hours=1`);
            const data = await res.json();
            if (data.success) { lastBarData = data.barData; renderBarChart(data.barData); }
        } catch(e) {}
    } else {
        currentTimeUnit = 'min'; currentBarMode  = 'min'; btn.textContent = '시간';
        hourTabs.style.display = 'none';
        document.getElementById('bar-chart-title').textContent = '시간대별 집중 흐름 (분)';
        
        renderBarChart(null);

        try {
            const res  = await fetch(`${SERVER_URL}/api/logs/dashboard/${userId}`);
            const data = await res.json();
            if (data.success) { lastBarData = data.barData; renderBarChart(data.barData); }
        } catch(e) {}
    }
}

async function selectHourTab(btnEl) {
    const hours  = parseInt(btnEl.dataset.hours);
    const userId = localStorage.getItem('focusflow_user_id') || 'jy16';
    document.querySelectorAll('.hour-tab-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    currentBarMode = `${hours}h`;
    document.getElementById('bar-chart-title').textContent = `시간대별 집중 흐름 (${hours}시간)`;
    
    renderBarChart(null); 

    try {
        const res  = await fetch(`${SERVER_URL}/api/logs/hourly/${userId}?hours=${hours}`);
        const data = await res.json();
        if (data.success) { lastBarData = data.barData; renderBarChart(data.barData); }
    } catch(e) { console.error(e); }
}

// ── 달력 네비게이션 ──
function calPrevMonth() { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } loadCalendar(); }
function calNextMonth() { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } loadCalendar(); }

async function loadCalendar() {
    const userId = localStorage.getItem('focusflow_user_id') || 'jy16';
    try {
        const ts = new Date().getTime();
        const res  = await fetch(`${SERVER_URL}/api/logs/calendar/${userId}?days=365&_t=${ts}`);
        const data = await res.json();
        
        if (data.success && data.data) {
            const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
            const liveTodayData = calData[todayStr];
            
            calData = data.data; 
            
            if (liveTodayData && !calData[todayStr]) {
                calData[todayStr] = liveTodayData;
            }
        }
    } catch (e) {
        console.error("달력 데이터를 불러오는데 실패했습니다:", e);
    }
    renderCalendar();
}

function renderCalendar() {
    const label = document.getElementById('cal-month-label');
    if (label) label.textContent = `${calYear}년 ${calMonth}월`;
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const firstDay = new Date(calYear, calMonth - 1, 1).getDay(); 
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    // 요일 헤더 삽입 (없으면 자동 생성)
    const headerRow = document.getElementById('cal-header-row');
    if (headerRow && headerRow.children.length === 0) {
        ['일','월','화','수','목','금','토'].forEach((d, i) => {
            const h = document.createElement('div');
            h.className = 'cal-header-cell' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
            h.textContent = d;
            headerRow.appendChild(h);
        });
    }

    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div'); empty.className = 'cal-cell empty'; grid.appendChild(empty);
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayOfWeek = new Date(calYear, calMonth - 1, d).getDay();
        const info = calData[dateStr];

        const cell = document.createElement('div'); cell.className = 'cal-cell';
        if (dateStr === todayStr) cell.classList.add('today');

        const dateEl = document.createElement('div');
        dateEl.className = 'cal-date' + (dayOfWeek === 0 ? ' sun' : dayOfWeek === 6 ? ' sat' : '');
        dateEl.textContent = d;

        const scoreEl = document.createElement('div'); scoreEl.className = 'cal-score';
        const barWrap = document.createElement('div'); barWrap.className = 'cal-bar';
        const barFill = document.createElement('div'); barFill.className = 'cal-bar-fill';

        if (info && (info.score > 0 || info.lectureSec > 0 || info.distractSec > 0)) {
            const s = info.score || 0; 
            scoreEl.textContent = s + '점';
            
            if (s >= 80)      { scoreEl.classList.add('high');  barFill.style.background = '#4CAF50'; }
            else if (s >= 40) { scoreEl.classList.add('mid');   barFill.style.background = '#FFC107'; }
            else              { scoreEl.classList.add('low');   barFill.style.background = '#f87171'; }
            
            barFill.style.width = (s > 100 ? 100 : s) + '%';
        } else {
            scoreEl.textContent = dateStr > todayStr ? '' : (d <= new Date().getDate() && calMonth === today.getMonth()+1 && calYear === today.getFullYear()) ? '-' : '';
            scoreEl.classList.add('none'); barFill.style.width = '0%';
        }
        
        barWrap.appendChild(barFill); cell.appendChild(dateEl); cell.appendChild(scoreEl); cell.appendChild(barWrap);
        cell.addEventListener('click', () => showDateDetail(dateStr, info));
        grid.appendChild(cell);
    }
}

// ── 날짜 상세 팝업 (모달 방식으로 변경) ──
function showDateDetail(dateStr, info) {
    // 기존 모달 제거 후 새로 생성
    const existing = document.getElementById('cal-detail-modal');
    if (existing) existing.remove();

    const year  = dateStr.slice(0,4);
    const month = parseInt(dateStr.slice(5,7));
    const day   = parseInt(dateStr.slice(8,10));

    const hasData = info && (info.score > 0 || info.lectureSec > 0 || info.distractSec > 0);
    const score   = hasData ? (info.score || 0) : null;

    // 점수 색상 결정
    let scoreColor = '#aaa';
    let scoreGrade = '기록 없음';
    if (score !== null) {
        if (score >= 80)      { scoreColor = '#4CAF50'; scoreGrade = '우수 🏅'; }
        else if (score >= 40) { scoreColor = '#FFC107'; scoreGrade = '보통'; }
        else                  { scoreColor = '#f87171'; scoreGrade = '미흡'; }
    }

    // 집중률 게이지 너비
    const focusRate  = hasData ? (info.focusRate || 0) : 0;
    const gaugeWidth = Math.min(focusRate, 100);
    const gaugeColor = focusRate >= 70 ? '#4CAF50' : focusRate >= 40 ? '#FFC107' : '#f87171';

    // 오버레이 배경
    const overlay = document.createElement('div');
    overlay.id = 'cal-detail-modal';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center;
        animation: calFadeIn 0.18s ease;
    `;

    // 모달 카드
    const card = document.createElement('div');
    card.style.cssText = `
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 28px 32px;
        min-width: 300px;
        max-width: 380px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        position: relative;
        animation: calSlideUp 0.2s ease;
        color: #f1f5f9;
        font-family: inherit;
    `;

    card.innerHTML = `
        <button onclick="document.getElementById('cal-detail-modal').remove()"
            style="position:absolute; top:14px; right:16px; background:transparent; border:none;
                   color:#94a3b8; font-size:20px; cursor:pointer; line-height:1;" title="닫기">✕</button>

        <div style="font-size:13px; color:#94a3b8; margin-bottom:4px;">${year}년 ${month}월 ${day}일</div>
        <div style="font-size:22px; font-weight:700; margin-bottom:20px; color:#f1f5f9;">📅 학습 기록</div>

        ${hasData ? `
        <!-- 점수 배지 -->
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;
                    background:#0f172a; border-radius:10px; padding:14px 18px;">
            <div>
                <div style="font-size:12px; color:#94a3b8; margin-bottom:4px;">오늘의 점수</div>
                <div style="font-size:32px; font-weight:800; color:${scoreColor};">${score}<span style="font-size:16px;">점</span></div>
            </div>
            <div style="background:${scoreColor}22; border:1px solid ${scoreColor}55;
                        border-radius:8px; padding:6px 14px; font-size:13px; color:${scoreColor}; font-weight:600;">
                ${scoreGrade}
            </div>
        </div>

        <!-- 집중률 게이지 -->
        <div style="margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; font-size:12px; color:#94a3b8; margin-bottom:6px;">
                <span>집중률</span><span style="color:${gaugeColor}; font-weight:600;">${focusRate}%</span>
            </div>
            <div style="background:#334155; border-radius:99px; height:8px; overflow:hidden;">
                <div style="width:${gaugeWidth}%; background:${gaugeColor}; height:100%;
                            border-radius:99px; transition:width 0.4s ease;"></div>
            </div>
        </div>

        <!-- 시간 통계 -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div style="background:#0f172a; border-radius:10px; padding:12px 14px; text-align:center;">
                <div style="font-size:11px; color:#4CAF50; margin-bottom:4px;">📚 강의 집중</div>
                <div style="font-size:15px; font-weight:700; color:#f1f5f9;">${secToMin(info.lectureSec || 0)}</div>
            </div>
            <div style="background:#0f172a; border-radius:10px; padding:12px 14px; text-align:center;">
                <div style="font-size:11px; color:#f87171; margin-bottom:4px;">💤 딴짓/이탈</div>
                <div style="font-size:15px; font-weight:700; color:#f1f5f9;">${secToMin(info.distractSec || 0)}</div>
            </div>
        </div>
        ` : `
        <div style="text-align:center; padding:30px 0; color:#64748b;">
            <div style="font-size:40px; margin-bottom:10px;">📭</div>
            <div style="font-size:14px;">이 날의 학습 기록이 없습니다.</div>
        </div>
        `}
    `;

    // 애니메이션 keyframes (한 번만 삽입)
    if (!document.getElementById('cal-modal-style')) {
        const style = document.createElement('style');
        style.id = 'cal-modal-style';
        style.textContent = `
            @keyframes calFadeIn  { from { opacity:0; } to { opacity:1; } }
            @keyframes calSlideUp { from { transform:translateY(16px); opacity:0; } to { transform:translateY(0); opacity:1; } }
        `;
        document.head.appendChild(style);
    }

    // 오버레이 클릭 시 닫기 (카드 클릭은 제외)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);
}

function secToMin(sec) {
    const m = Math.floor(sec / 60); const s = sec % 60; return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// ── 어드민 관련 로직 ──
function getAdminId() { return localStorage.getItem('focusflow_admin_id') || 'admin'; }

async function adminLogin() {
    const adminId = document.getElementById('adminId').value.trim();
    const password = document.getElementById('adminPw').value.trim();
    const msg = document.getElementById('admin-login-message');

    if (!adminId || !password) {
        msg.innerText = '관리자 ID와 비밀번호를 입력하세요.';
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_id: adminId, password })
        });
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('focusflow_admin_id', result.admin.admin_id);
            localStorage.setItem('focusflow_admin_name', result.admin.admin_name);
            showAdminPanel();
            loadAdminData();
            msg.innerText = '';
        } else {
            if (adminId === 'admin' && password === 'admin') {
                localStorage.setItem('focusflow_admin_id', 'admin');
                localStorage.setItem('focusflow_admin_name', '최고관리자(우회)');
                showAdminPanel(); loadAdminData(); msg.innerText = '';
                return;
            }
            msg.innerText = result.message || '관리자 인증 실패';
        }
    } catch (e) {
        if (adminId === 'admin' && password === 'admin') {
            localStorage.setItem('focusflow_admin_id', 'admin');
            localStorage.setItem('focusflow_admin_name', '최고관리자(강제오프라인)');
            showAdminPanel(); loadAdminData(); msg.innerText = '';
            return;
        }
        msg.innerText = '서버 연결 실패. (admin/admin 입력 시 강제 통과 가능)'; 
    }
}

function showAdminPanel() {
    const loginScreen = document.getElementById('admin-login-screen');
    const panel = document.getElementById('admin-panel');
    if (loginScreen) { loginScreen.classList.remove('active'); loginScreen.classList.add('hidden'); }
    if (panel) panel.classList.remove('hidden');
    const name = localStorage.getItem('focusflow_admin_name') || '관리자';
    const display = document.getElementById('admin-display-name');
    if (display) display.innerText = name;
}

function adminLogout() {
    localStorage.removeItem('focusflow_admin_id');
    localStorage.removeItem('focusflow_admin_name');
    window.location.reload();
}

async function loadAdminData() {
    try { await loadUsers(); } catch(e){}
    try { await loadAdminRanking(); } catch(e){}
    try { await loadBlockedApps(); } catch(e){}
    try { await loadBlockEvents(); } catch(e){}
    try { await loadNudgeMessages(); } catch(e){}
    try { await loadRewardRules(); } catch(e){}
}

async function loadAdminRanking() {
    const tbody = document.getElementById('admin-ranking-body');
    if (!tbody) return;
    try {
        const res = await fetch(`${SERVER_URL}/api/ranking/top10?isAdmin=true`);
        const data = await res.json();
        if (!data.success) return;
        
        const titleEl = document.getElementById('admin-ranking-title');
        if (titleEl && data.quarter) {
            titleEl.innerHTML = `🏆 ${data.quarter}분기 명예의 전당 (Top 10)`;
        }

        if (data.ranking && data.ranking.length > 0) {
            tbody.innerHTML = data.ranking.map(user => {
                let rankIcon = `${user.rank}위`;
                if (user.rank === 1) rankIcon = '🥇 1위';
                else if (user.rank === 2) rankIcon = '🥈 2위';
                else if (user.rank === 3) rankIcon = '🥉 3위';
                
                return `<tr>
                    <td style="font-weight:bold; color:#FFD700;">${rankIcon}</td>
                    <td>${user.userId}</td>
                    <td style="color:#4CAF50; font-weight:bold;">${user.rewardScore} 점</td>
                </tr>`;
            }).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#aaa;">아직 집계된 랭킹 데이터가 없습니다.</td></tr>`;
        }
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#f87171;">랭킹 데이터를 불러오지 못했습니다.</td></tr>`;
    }
}

function formatSeconds(seconds) {
    const min = Math.floor(Number(seconds || 0) / 60);
    const sec = Number(seconds || 0) % 60;
    return `${min}분 ${sec}초`;
}

async function loadUsers() {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    const res = await fetch(`${SERVER_URL}/api/admin/users`);
    const data = await res.json();
    if (!data.success) return;
    tbody.innerHTML = data.users.map(user => {
        const focus = Number(user.focus_seconds || 0); const distract = Number(user.distract_seconds || 0);
        const status = distract > focus ? '주의 필요' : '정상';
        return `<tr>
            <td>${user.user_id}</td><td>${user.username || '-'}</td>
            <td>${formatSeconds(focus)}</td><td>${formatSeconds(distract)}</td>
            <td>${user.active_block_count}</td>
            <td><span class="status-pill ${status === '주의 필요' ? 'danger' : 'safe'}">${status}</span></td>
        </tr>`;
    }).join('');
}

async function loadBlockedApps() {
    const tbody = document.getElementById('blocked-table-body');
    if (!tbody) return;
    const res = await fetch(`${SERVER_URL}/api/admin/blocked-apps`);
    const data = await res.json();
    if (!data.success) return;
    tbody.innerHTML = data.blocked_apps.map(item => `<tr>
        <td>${item.block_id}</td><td>${item.user_id}</td>
        <td><input class="table-input" id="block-name-${item.block_id}" value="${item.app_name}"></td>
        <td>${item.is_active ? '활성' : '비활성'}</td>
        <td>
            <button class="small-btn" onclick="updateBlockedApp(${item.block_id})">수정</button>
            <button class="small-btn danger-btn" onclick="deleteBlockedApp(${item.block_id})">삭제</button>
        </td>
    </tr>`).join('');
}

async function addBlockedApp() {
    const userId = document.getElementById('blockUserId').value.trim();
    const appName = document.getElementById('blockAppName').value.trim();
    if (!userId || !appName) return alert('사용자 ID와 앱 이름을 입력하세요.');
    const res = await fetch(`${SERVER_URL}/api/admin/blocked-apps`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, app_name: appName, admin_id: getAdminId() })
    });
    const data = await res.json();
    alert(data.message || (data.success ? '등록 완료' : '등록 실패'));
    if (data.success) { document.getElementById('blockAppName').value = ''; loadAdminData(); }
}

async function updateBlockedApp(blockId) {
    const appName = document.getElementById(`block-name-${blockId}`).value.trim();
    if (!appName) return alert('앱 이름을 입력하세요.');
    const res = await fetch(`${SERVER_URL}/api/admin/blocked-apps/${blockId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_name: appName })
    });
    const data = await res.json();
    alert(data.message || (data.success ? '수정 완료' : '수정 실패'));
    loadBlockedApps();
}

async function deleteBlockedApp(blockId) {
    if (!confirm('이 차단 앱을 삭제할까요?')) return;
    const res = await fetch(`${SERVER_URL}/api/admin/blocked-apps/${blockId}`, { method: 'DELETE' });
    const data = await res.json();
    alert(data.message || (data.success ? '삭제 완료' : '삭제 실패'));
    loadAdminData();
}

async function approveUnlock() {
    const userId = document.getElementById('unlockUserId').value.trim();
    const appName = document.getElementById('unlockAppName').value.trim();
    const minutes = document.getElementById('unlockMinutes').value || 10;
    const password = document.getElementById('unlockAdminPw').value.trim();
    if (!userId || !appName || !password) return alert('사용자 ID, 앱 이름, 관리자 비밀번호를 입력하세요.');
    const res = await fetch(`${SERVER_URL}/api/admin/unlock-approvals`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, app_name: appName, admin_id: getAdminId(), password, minutes })
    });
    const data = await res.json();
    alert(data.message || (data.success ? '승인 완료' : '승인 실패'));
    if (data.success) { document.getElementById('unlockAdminPw').value = ''; loadAdminData(); }
}

async function loadBlockEvents() {
    const tbody = document.getElementById('event-table-body');
    if (!tbody) return;
    const res = await fetch(`${SERVER_URL}/api/admin/block-events`);
    const data = await res.json();
    if (!data.success) return;
    tbody.innerHTML = data.events.map(event => `<tr>
        <td>${new Date(event.created_at).toLocaleString()}</td><td>${event.user_id}</td>
        <td>${event.app_name}</td><td>${event.event_type}</td><td>${event.reason || '-'}</td>
    </tr>`).join('');
}

async function loadNudgeMessages() {
    const list = document.getElementById('nudge-message-list');
    if (!list) return;
    const res = await fetch(`${SERVER_URL}/api/admin/nudge-messages`);
    const data = await res.json();
    if (!data.success) return;
    list.innerHTML = data.messages.map(item => `<div class="setting-row">
        <label>단계 ${item.focus_stage}</label>
        <textarea id="nudge-${item.message_id}">${item.message_text}</textarea>
        <button class="small-btn" onclick="updateNudgeMessage(${item.message_id})">저장</button>
    </div>`).join('');
}

async function updateNudgeMessage(messageId) {
    const text = document.getElementById(`nudge-${messageId}`).value.trim();
    if (!text) return alert('메시지를 입력하세요.');
    const res = await fetch(`${SERVER_URL}/api/admin/nudge-messages/${messageId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_text: text, admin_id: getAdminId() })
    });
    const data = await res.json();
    alert(data.success ? '넛지 메시지가 저장되었습니다.' : '저장 실패');
}

async function loadRewardRules() {
    const list = document.getElementById('reward-rule-list');
    if (!list) return;
    const res = await fetch(`${SERVER_URL}/api/admin/reward-rules`);
    const data = await res.json();
    if (!data.success) return;
    list.innerHTML = data.rules.map(rule => `<div class="setting-row reward-row">
        <strong>${rule.grade_name}</strong>
        <input type="number" id="rule-min-${rule.rule_id}" value="${rule.min_score}" title="최소 점수">
        <span>~</span>
        <input type="number" id="rule-max-${rule.rule_id}" value="${rule.max_score}" title="최대 점수">
        <input type="number" id="rule-points-${rule.rule_id}" value="${rule.points}" title="포인트">
        <button class="small-btn" onclick="updateRewardRule(${rule.rule_id})">저장</button>
    </div>`).join('');
}

async function updateRewardRule(ruleId) {
    const minScore = document.getElementById(`rule-min-${ruleId}`).value;
    const maxScore = document.getElementById(`rule-max-${ruleId}`).value;
    const points = document.getElementById(`rule-points-${ruleId}`).value;
    const res = await fetch(`${SERVER_URL}/api/admin/reward-rules/${ruleId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ min_score: minScore, max_score: maxScore, points, admin_id: getAdminId() })
    });
    const data = await res.json();
    alert(data.success ? '보상 기준이 저장되었습니다.' : '저장 실패');
}

// ── 페이지 로딩 ──
window.onload = () => {
    if (document.getElementById('admin-login-screen') || document.getElementById('admin-panel')) {
        if (localStorage.getItem('focusflow_admin_id')) {
            showAdminPanel(); loadAdminData();
        }
    } else {
        const userName = localStorage.getItem('focusflow_user_name');
        if (userName) { const el = document.getElementById('user-display-name'); if (el) el.innerText = userName; }
        
        if (document.getElementById('keyword-list-container')) {
            // 차준호 2026-05-17 추가 | 페이지 로드 시 서버에서 키워드 fetch + 5초 폴링으로 실시간 동기화
            loadKeywordsFromServer();
            setInterval(loadKeywordsFromServer, 5000);
        }

        if (document.getElementById('cal-grid')) {
            loadCalendar();
            syncTrackingStatus();
            fetchLatestLog();
            pollInterval = setInterval(fetchLatestLog, 5000);
        }
    }
};