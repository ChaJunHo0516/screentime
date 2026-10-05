// public/js/api.js  — 2.0 Phase 1
// 인증은 HttpOnly 쿠키(ff_session / ff_admin)로 처리되므로 같은 origin 의 fetch 는 자동으로 인증된다.
// 이 파일은 다음을 담당한다.
//   1) FF.apiFetch(): 이후 Phase 에서 새로 작성하는 코드가 사용할 표준 API 호출 함수
//   2) 세션 만료(401) 공통 처리: 기존 app.js 의 fetch 호출을 수정하지 않고도
//      로그인 화면으로 이동하도록 window.fetch 를 감싼다. (Phase 9 에서 apiFetch 로 일괄 전환 후 제거 예정)
(function (global) {
    'use strict';

    const nativeFetch = global.fetch.bind(global);

    // 로그인 시도 자체가 실패(401)한 경우는 리다이렉트하지 않는다.
    const NO_REDIRECT_PATHS = ['/api/auth/login', '/api/auth/register', '/api/admin/login', '/api/admin/me'];

    function pathOf(input) {
        try {
            const url = typeof input === 'string' ? input : input.url;
            return new URL(url, global.location.origin).pathname;
        } catch (_) {
            return '';
        }
    }

    function isAdminPage() {
        return !!document.getElementById('admin-login-screen');
    }

    let redirecting = false;
    function handleUnauthorized() {
        if (redirecting) return;
        redirecting = true;
        if (isAdminPage()) {
            localStorage.removeItem('focusflow_admin_id');
            localStorage.removeItem('focusflow_admin_name');
            global.location.reload();
        } else {
            localStorage.removeItem('focusflow_user_id');
            localStorage.removeItem('focusflow_user_name');
            const here = global.location.pathname;
            if (here !== '/' && here !== '/index.html' && here !== '/register.html') {
                global.location.href = '/';
            }
        }
    }

    global.fetch = async function guardedFetch(input, init) {
        const res = await nativeFetch(input, init);
        const p = pathOf(input);
        if (res.status === 401 && p.startsWith('/api/') && !NO_REDIRECT_PATHS.includes(p)) {
            handleUnauthorized();
        }
        return res;
    };

    /**
     * 표준 API 호출. JSON body 자동 직렬화, 공통 에러 형식 처리.
     * @returns {Promise<any>} 응답 JSON
     * @throws {Error} err.status, err.code 포함
     */
    async function apiFetch(path, { method = 'GET', body, headers = {} } = {}) {
        const opts = { method, credentials: 'same-origin', headers: { ...headers } };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await global.fetch(path, opts);
        let data = null;
        try { data = await res.json(); } catch (_) { /* empty body */ }
        if (!res.ok || (data && data.success === false)) {
            const err = new Error((data && data.message) || `요청 실패 (${res.status})`);
            err.status = res.status;
            err.code = data && data.error && data.error.code;
            throw err;
        }
        return data;
    }

    global.FF = global.FF || {};
    global.FF.apiFetch = apiFetch;
})(window);
