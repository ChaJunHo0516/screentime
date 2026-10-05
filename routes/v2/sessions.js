// routes/v2/sessions.js  (PHASE 2 — Focus Session)
// server.js 에서 requireUser 뒤에 mount 된다 → req.user.id 는 항상 인증된 사용자.
// 응답 형식: { success: true, data: { session } }   /  에러는 middleware/errorHandler 공통 형식
const express = require('express');
const router = express.Router();
const sessionService = require('../../services/sessionService');
const { notFound } = require('../../middleware/errorHandler');

function sessionIdOr404(req) {
    const id = sessionService.parseSessionId(req.params.id);
    if (!id) throw notFound('세션을 찾을 수 없습니다.', 'SESSION_NOT_FOUND');
    return id;
}

// 현재 진행 중(PLANNED/ACTIVE) 세션. 없으면 session: null
router.get('/current', async (req, res) => {
    const session = await sessionService.getCurrent(req.user.id);
    res.json({ success: true, data: { session } });
});

// 세션 생성 (PLANNED). body: { goal, plannedMinutes, keywords[] }
router.post('/', async (req, res) => {
    const session = await sessionService.createSession(req.user.id, req.body);
    res.status(201).json({ success: true, data: { session } });
});

// PLANNED → ACTIVE
router.post('/:id/start', async (req, res) => {
    const session = await sessionService.startSession(req.user.id, sessionIdOr404(req));
    res.json({ success: true, data: { session } });
});

// ACTIVE → COMPLETED  body: { goalCompleted: boolean }
// PLANNED/ACTIVE → CANCELLED  body: { cancel: true }
router.post('/:id/end', async (req, res) => {
    const session = await sessionService.endSession(req.user.id, sessionIdOr404(req), req.body);
    res.json({ success: true, data: { session } });
});

module.exports = router;
