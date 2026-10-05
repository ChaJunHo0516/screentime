// public/js/session.js  — 2.0 Phase 2: Focus Session 카드
// app.js 에서 분리된 첫 기능 모듈. 의존: js/dom.js(escapeHtml), js/api.js(FF.apiFetch)
// 기존 tracking(시작/정지) 기능과 독립적으로 동작한다.
(function (global) {
    'use strict';

    const API = '/api/v2/sessions';
    const SYNC_INTERVAL_MS = 30 * 1000;   // 서버와 남은 시간 재동기화 주기
    const PRESET_MINUTES = [25, 50, 60, 90];

    const state = {
        session: null,       // 서버에서 받은 세션
        fetchedAt: 0,        // 받은 시각(브라우저 시계) → 로컬 카운트다운 기준
        confirmingEnd: false,
        busy: false,
        lastResult: null,    // 방금 종료한 세션 결과 표시용
        error: ''
    };
    let tickTimer = null;
    let syncTimer = null;

    const $ = (id) => document.getElementById(id);
    const esc = (v) => global.escapeHtml(v);

    function fmtClock(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(sec).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    // 서버 값 + 받은 뒤 흐른 시간 → 현재 경과/남은 시간
    function liveTiming() {
        const s = state.session;
        if (!s) return null;
        const planned = s.plannedMinutes * 60;
        if (s.status !== 'ACTIVE') return { elapsed: s.elapsedSeconds, remaining: s.remainingSeconds, planned, overtime: false };
        const drift = (Date.now() - state.fetchedAt) / 1000;
        const elapsed = s.elapsedSeconds + drift;
        return { elapsed, remaining: Math.max(0, planned - elapsed), planned, overtime: elapsed >= planned };
    }

    function setSession(session) {
        // 같은 세션이 계속 진행 중이면 "종료 확인" 화면을 유지 (주기적 동기화로 닫히지 않도록)
        const keepConfirm = state.confirmingEnd && session && state.session &&
            session.id === state.session.id && session.status === 'ACTIVE';
        state.session = session;
        state.fetchedAt = Date.now();
        state.confirmingEnd = Boolean(keepConfirm);
    }

    async function refresh() {
        const before = state.session ? `${state.session.id}:${state.session.status}` : 'none';
        const prevError = state.error;
        try {
            const res = await global.FF.apiFetch(`${API}/current`);
            setSession(res.data.session);
            state.error = '';
        } catch (e) {
            if (e.status !== 401) state.error = '세션 정보를 불러오지 못했습니다.';
        }
        const after = state.session ? `${state.session.id}:${state.session.status}` : 'none';
        // 세션이 없고 변화도 없으면 다시 그리지 않는다 (입력 중인 폼의 포커스 유지)
        if (before === 'none' && after === 'none' && prevError === state.error && $('session-goal')) return;
        render();
    }

    async function run(action) {
        if (state.busy) return;
        state.busy = true;
        state.error = '';
        render();
        try {
            await action();
        } catch (e) {
            state.error = e.message || '요청에 실패했습니다.';
            // 상태가 어긋났을 수 있으므로 서버 기준으로 다시 맞춘다
            if (e.status === 409 || e.status === 404) await refresh();
        } finally {
            state.busy = false;
            render();
        }
    }

    function readForm() {
        const goal = $('session-goal').value.trim();
        const plannedMinutes = Number($('session-minutes').value);
        const keywords = $('session-keywords').value.split(',').map(k => k.trim()).filter(Boolean);
        return { goal, plannedMinutes, keywords };
    }

    function createAndStart() {
        return run(async () => {
            const input = readForm();
            if (!input.goal) throw new Error('집중 목표를 입력하세요.');
            const created = await global.FF.apiFetch(API, { method: 'POST', body: input });
            setSession(created.data.session);
            const started = await global.FF.apiFetch(`${API}/${created.data.session.id}/start`, { method: 'POST' });
            setSession(started.data.session);
            state.lastResult = null;
        });
    }

    function startPlanned() {
        return run(async () => {
            const res = await global.FF.apiFetch(`${API}/${state.session.id}/start`, { method: 'POST' });
            setSession(res.data.session);
        });
    }

    function endSession(body) {
        return run(async () => {
            const res = await global.FF.apiFetch(`${API}/${state.session.id}/end`, { method: 'POST', body });
            state.lastResult = res.data.session;
            setSession(null);
        });
    }

    // ── 렌더링 ──
    function renderForm() {
        const presets = PRESET_MINUTES.map(m =>
            `<button type="button" class="session-preset" data-minutes="${m}">${m}분</button>`).join('');
        return `
            <div class="session-form">
                <label class="session-label" for="session-goal">이번 세션의 목표</label>
                <input id="session-goal" class="session-input" maxlength="200" placeholder="예: 머신러닝 강의 2개 듣기">
                <div class="session-row">
                    <div class="session-field">
                        <label class="session-label" for="session-minutes">계획 시간 (분)</label>
                        <div class="session-minutes-row">
                            <input id="session-minutes" class="session-input session-minutes" type="number" min="1" max="480" value="60">
                            ${presets}
                        </div>
                    </div>
                    <div class="session-field session-field-grow">
                        <label class="session-label" for="session-keywords">목표 키워드 (쉼표로 구분, 선택)</label>
                        <input id="session-keywords" class="session-input" maxlength="500" placeholder="예: 머신러닝, scikit-learn, 강의">
                    </div>
                </div>
                <button id="session-start-btn" class="btn btn-green session-main-btn" ${state.busy ? 'disabled' : ''}>▶ 세션 시작</button>
            </div>`;
    }

    function renderKeywords(keywords) {
        if (!keywords || keywords.length === 0) return '';
        return `<div class="session-keywords">${keywords.map(k => `<span class="session-chip">${esc(k)}</span>`).join('')}</div>`;
    }

    function renderSession() {
        const s = state.session;
        const t = liveTiming();
        const pct = Math.min(100, (t.elapsed / t.planned) * 100);
        const isActive = s.status === 'ACTIVE';

        let timeBlock;
        if (!isActive) {
            timeBlock = `<div class="session-time-label">계획 시간</div><div class="session-clock">${s.plannedMinutes}분</div>`;
        } else if (t.overtime) {
            timeBlock = `<div class="session-time-label session-overtime">목표 시간 도달 🎉</div>
                         <div class="session-clock session-overtime" id="session-clock">+${fmtClock(t.elapsed - t.planned)}</div>`;
        } else {
            timeBlock = `<div class="session-time-label">남은 시간</div><div class="session-clock" id="session-clock">${fmtClock(t.remaining)}</div>`;
        }

        let actions;
        if (state.confirmingEnd) {
            actions = `
                <div class="session-confirm">
                    <span>목표를 달성했나요?</span>
                    <button class="btn btn-green" data-end="done" ${state.busy ? 'disabled' : ''}>달성했어요 ✅</button>
                    <button class="btn btn-red" data-end="notdone" ${state.busy ? 'disabled' : ''}>못 했어요</button>
                    <button class="btn btn-gray" data-end="back" ${state.busy ? 'disabled' : ''}>계속하기</button>
                </div>`;
        } else if (isActive) {
            actions = `
                <button class="btn btn-red" id="session-end-btn" ${state.busy ? 'disabled' : ''}>■ 세션 종료</button>
                <button class="session-link" id="session-cancel-btn" ${state.busy ? 'disabled' : ''}>세션 취소</button>`;
        } else {
            actions = `
                <button class="btn btn-green" id="session-resume-btn" ${state.busy ? 'disabled' : ''}>▶ 시작</button>
                <button class="session-link" id="session-cancel-btn" ${state.busy ? 'disabled' : ''}>세션 취소</button>`;
        }

        return `
            <div class="session-active">
                <div class="session-main">
                    <div class="session-status ${isActive ? 'is-active' : 'is-planned'}">${isActive ? '● 집중 세션 진행 중' : '○ 시작 대기'}</div>
                    <div class="session-goal" id="session-goal-text">${esc(s.goal)}</div>
                    ${renderKeywords(s.keywords)}
                    <div class="session-progress"><div class="session-progress-fill ${t.overtime ? 'is-overtime' : ''}" id="session-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
                    <div class="session-meta" id="session-meta">${isActive ? `${fmtClock(t.elapsed)} 경과 / 계획 ${s.plannedMinutes}분` : `계획 ${s.plannedMinutes}분`}</div>
                </div>
                <div class="session-side">
                    ${timeBlock}
                    <div class="session-actions">${actions}</div>
                </div>
            </div>`;
    }

    function renderResult() {
        const r = state.lastResult;
        if (!r) return '';
        const mins = Math.round(r.elapsedSeconds / 60);
        let text;
        if (r.status === 'CANCELLED') text = `세션을 취소했습니다. (${esc(r.goal)})`;
        else if (r.goalCompleted) text = `🎉 목표 달성! "${esc(r.goal)}" — ${mins}분 집중했어요.`;
        else text = `수고했어요. "${esc(r.goal)}" — ${mins}분 진행했어요. 다음엔 조금 더!`;
        return `<div class="session-result">${text}</div>`;
    }

    function render() {
        const box = $('session-body');
        if (!box) return;
        const errorHtml = state.error ? `<div class="session-error">${esc(state.error)}</div>` : '';
        // 입력 중인 폼을 다시 그리지 않도록, 폼 상태에서 값이 이미 있으면 보존
        const prev = $('session-goal') ? readForm() : null;
        box.innerHTML = renderResult() + (state.session ? renderSession() : renderForm()) + errorHtml;
        if (!state.session && prev) {
            $('session-goal').value = prev.goal;
            $('session-minutes').value = prev.plannedMinutes || 60;
            $('session-keywords').value = prev.keywords.join(', ');
        }
        bind();
    }

    // 1초마다 숫자만 갱신 (전체 다시 그리기 X)
    function tick() {
        const s = state.session;
        if (!s || s.status !== 'ACTIVE') return;
        const t = liveTiming();
        const clock = $('session-clock');
        if (!clock) return;
        const wasOvertime = clock.classList.contains('session-overtime');
        if (t.overtime !== wasOvertime) { render(); return; }   // 목표 시간 도달 순간에 표시 전환
        clock.textContent = t.overtime ? `+${fmtClock(t.elapsed - t.planned)}` : fmtClock(t.remaining);
        const fill = $('session-progress-fill');
        if (fill) fill.style.width = `${Math.min(100, (t.elapsed / t.planned) * 100).toFixed(1)}%`;
        const meta = $('session-meta');
        if (meta) meta.textContent = `${fmtClock(t.elapsed)} 경과 / 계획 ${s.plannedMinutes}분`;
    }

    function bind() {
        const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
        on('session-start-btn', createAndStart);
        on('session-resume-btn', startPlanned);
        on('session-end-btn', () => { state.confirmingEnd = true; render(); });
        on('session-cancel-btn', () => endSession({ cancel: true }));
        document.querySelectorAll('#session-body .session-preset').forEach(btn => {
            btn.addEventListener('click', () => { $('session-minutes').value = btn.dataset.minutes; });
        });
        document.querySelectorAll('#session-body [data-end]').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.dataset.end;
                if (v === 'back') { state.confirmingEnd = false; render(); return; }
                endSession({ goalCompleted: v === 'done' });
            });
        });
        const goal = $('session-goal');
        if (goal) goal.addEventListener('keydown', (e) => { if (e.key === 'Enter') createAndStart(); });
    }

    function init() {
        if (!$('session-body')) return;
        render();
        refresh();
        clearInterval(tickTimer);
        clearInterval(syncTimer);
        tickTimer = setInterval(tick, 1000);
        syncTimer = setInterval(refresh, SYNC_INTERVAL_MS);
        // 다른 탭에서 돌아오면 즉시 서버 기준으로 맞춤
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    }

    global.FF = global.FF || {};
    global.FF.session = { init, refresh, _fmtClock: fmtClock };
    document.addEventListener('DOMContentLoaded', init);
})(window);
