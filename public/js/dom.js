// public/js/dom.js  — 2.0 Phase 1
// innerHTML 로 렌더링하는 모든 외부 데이터(창 제목, user_id, 닉네임, AI 생성 텍스트 등)는
// 반드시 escapeHtml() 을 거친다. (Stored XSS 방지)
(function (global) {
    'use strict';

    const HTML_ESCAPES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;'
    };

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"'`]/g, ch => HTML_ESCAPES[ch]);
    }

    global.FF = global.FF || {};
    global.FF.escapeHtml = escapeHtml;
    // 기존 app.js 에서 짧게 쓰기 위한 전역 별칭
    global.escapeHtml = escapeHtml;
})(window);
