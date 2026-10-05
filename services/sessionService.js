// services/sessionService.js  (PHASE 2 — Focus Session)
//
// 상태 모델
//   PLANNED ──start──▶ ACTIVE ──end──▶ COMPLETED (goal_completed = true/false)
//      └──────────end(cancel)──────────▶ CANCELLED ◀── end(cancel) ── ACTIVE
//
// 원칙
//   * 사용자 ID 는 항상 호출자가 토큰에서 꺼낸 값(req.user.id)만 받는다.
//   * 남의 세션은 "없는 세션"과 같은 404 로 응답한다 (존재 여부 노출 방지).
//   * 상태 전이는 UPDATE ... WHERE status = <이전 상태> 로 원자적으로 처리한다 (중복 클릭/동시 요청 안전).
//   * 시간 계산(경과/남은 시간)은 DB 의 NOW() 기준으로 한다 → 서버·DB·브라우저 시계가 달라도 일관됨.
const { HttpError, badRequest, notFound } = require('../middleware/errorHandler');

const STATUS = Object.freeze({
    PLANNED: 'PLANNED',
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
});

const LIMITS = Object.freeze({
    goalMax: 200,
    minMinutes: 1,
    maxMinutes: 480,
    keywordsMax: 20,
    keywordLenMax: 50
});

const FORBIDDEN_CHARS = /[\u0000-\u001f<>]/;

/** 요청 body → 검증된 생성 입력. 실패 시 400 */
function validateCreateInput(body) {
    const src = body || {};
    const goal = typeof src.goal === 'string' ? src.goal.trim() : '';
    if (!goal) throw badRequest('집중 목표를 입력하세요.');
    if (goal.length > LIMITS.goalMax) throw badRequest(`목표는 ${LIMITS.goalMax}자 이하로 입력하세요.`);
    if (FORBIDDEN_CHARS.test(goal)) throw badRequest('목표에 사용할 수 없는 문자가 있습니다.');

    const minutes = Number(src.plannedMinutes);
    if (!Number.isInteger(minutes) || minutes < LIMITS.minMinutes || minutes > LIMITS.maxMinutes) {
        throw badRequest(`계획 시간은 ${LIMITS.minMinutes}~${LIMITS.maxMinutes}분 사이의 정수로 입력하세요.`);
    }

    // keywords: 배열 또는 "a, b, c" 문자열 허용
    let raw = src.keywords === undefined || src.keywords === null ? [] : src.keywords;
    if (typeof raw === 'string') raw = raw.split(',');
    if (!Array.isArray(raw)) throw badRequest('keywords 는 배열이어야 합니다.');
    const seen = new Set();
    const keywords = [];
    for (const item of raw) {
        if (typeof item !== 'string') throw badRequest('키워드는 문자열이어야 합니다.');
        const kw = item.trim();
        if (!kw) continue;
        if (kw.length > LIMITS.keywordLenMax) throw badRequest(`키워드는 ${LIMITS.keywordLenMax}자 이하로 입력하세요.`);
        if (FORBIDDEN_CHARS.test(kw)) throw badRequest('키워드에 사용할 수 없는 문자가 있습니다.');
        const key = kw.toLowerCase();
        if (seen.has(key)) continue;           // 대소문자 무시 중복 제거
        seen.add(key);
        keywords.push(kw);
    }
    if (keywords.length > LIMITS.keywordsMax) throw badRequest(`키워드는 최대 ${LIMITS.keywordsMax}개까지 입력할 수 있습니다.`);

    return { goal, plannedMinutes: minutes, keywords };
}

/** end 요청 body 검증 → { cancel } 또는 { goalCompleted } */
function validateEndInput(body) {
    const src = body || {};
    if (src.cancel === true) return { cancel: true };
    if (typeof src.goalCompleted !== 'boolean') {
        throw badRequest('goalCompleted(true/false) 또는 cancel:true 가 필요합니다.');
    }
    return { cancel: false, goalCompleted: src.goalCompleted };
}

function parseSessionId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== String(value)) return null;
    return id;
}

function toIso(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** DB 행 → API 응답 객체 (남은 시간 계산 포함) */
function toSessionDto(row, keywords = []) {
    const plannedSeconds = Number(row.planned_minutes) * 60;
    const elapsed = Math.max(0, Number(row.elapsed_seconds) || 0);
    let remaining;
    if (row.status === STATUS.PLANNED) remaining = plannedSeconds;
    else if (row.status === STATUS.ACTIVE) remaining = Math.max(0, plannedSeconds - elapsed);
    else remaining = 0;

    return {
        id: Number(row.session_id),
        goal: row.goal,
        plannedMinutes: Number(row.planned_minutes),
        keywords,
        status: row.status,
        goalCompleted: row.goal_completed === null || row.goal_completed === undefined ? null : Boolean(Number(row.goal_completed)),
        createdAt: toIso(row.created_at),
        startedAt: toIso(row.started_at),
        endedAt: toIso(row.ended_at),
        elapsedSeconds: row.status === STATUS.PLANNED ? 0 : elapsed,
        remainingSeconds: remaining,
        overtime: row.status === STATUS.ACTIVE && elapsed >= plannedSeconds
    };
}

const SELECT_SESSION = `
    SELECT session_id, user_id, goal, planned_minutes, status, goal_completed,
           started_at, ended_at, created_at,
           CASE WHEN started_at IS NULL THEN 0
                ELSE TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, NOW())) END AS elapsed_seconds
      FROM focus_sessions`;

function createSessionService({ getDb }) {
    async function loadKeywords(db, sessionId) {
        const [rows] = await db.query(
            "SELECT value FROM session_rules WHERE session_id = ? AND rule_type = 'KEYWORD' ORDER BY rule_id",
            [sessionId]
        );
        return rows.map(r => r.value);
    }

    async function findOwned(userId, sessionId) {
        const db = getDb();
        const [rows] = await db.query(`${SELECT_SESSION} WHERE session_id = ? AND user_id = ? LIMIT 1`, [sessionId, userId]);
        if (!rows[0]) return null;
        return toSessionDto(rows[0], await loadKeywords(db, sessionId));
    }

    async function getOwnedOr404(userId, sessionId) {
        const session = await findOwned(userId, sessionId);
        if (!session) throw notFound('세션을 찾을 수 없습니다.', 'SESSION_NOT_FOUND');
        return session;
    }

    async function getCurrent(userId) {
        const db = getDb();
        const [rows] = await db.query(
            `${SELECT_SESSION} WHERE user_id = ? AND status IN ('PLANNED', 'ACTIVE') ORDER BY created_at DESC, session_id DESC LIMIT 1`,
            [userId]
        );
        if (!rows[0]) return null;
        return toSessionDto(rows[0], await loadKeywords(db, rows[0].session_id));
    }

    async function createSession(userId, input) {
        const { goal, plannedMinutes, keywords } = validateCreateInput(input);
        const conn = await getDb().getConnection();
        let sessionId;
        try {
            await conn.beginTransaction();
            const [result] = await conn.query(
                `INSERT INTO focus_sessions (user_id, goal, session_type, planned_minutes, status)
                 VALUES (?, ?, 'FOCUS', ?, 'PLANNED')`,
                [userId, goal, plannedMinutes]
            );
            sessionId = result.insertId;
            for (const kw of keywords) {
                await conn.query(
                    "INSERT INTO session_rules (session_id, rule_type, value) VALUES (?, 'KEYWORD', ?)",
                    [sessionId, kw]
                );
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback().catch(() => {});
            if (err.code === 'ER_DUP_ENTRY') {
                throw new HttpError(409, 'SESSION_ALREADY_OPEN', '이미 진행 중인 세션이 있습니다. 먼저 종료하거나 취소하세요.');
            }
            throw err;
        } finally {
            conn.release();
        }
        return getOwnedOr404(userId, sessionId);
    }

    /** 원자적 상태 전이. 0행이면 404(남의 것/없음) 또는 409(상태 불일치) */
    async function transition(userId, sessionId, setSql, setParams, fromStatuses, actionLabel) {
        const placeholders = fromStatuses.map(() => '?').join(', ');
        const [result] = await getDb().query(
            `UPDATE focus_sessions SET ${setSql}
              WHERE session_id = ? AND user_id = ? AND status IN (${placeholders})`,
            [...setParams, sessionId, userId, ...fromStatuses]
        );
        if (result.affectedRows === 0) {
            const current = await getOwnedOr404(userId, sessionId);
            throw new HttpError(409, 'INVALID_SESSION_STATE',
                `${current.status} 상태의 세션은 ${actionLabel}할 수 없습니다.`);
        }
        return getOwnedOr404(userId, sessionId);
    }

    async function startSession(userId, sessionId) {
        return transition(userId, sessionId,
            "status = 'ACTIVE', started_at = NOW()", [],
            [STATUS.PLANNED], '시작');
    }

    async function endSession(userId, sessionId, body) {
        const input = validateEndInput(body);
        if (input.cancel) {
            return transition(userId, sessionId,
                "status = 'CANCELLED', ended_at = NOW()", [],
                [STATUS.PLANNED, STATUS.ACTIVE], '취소');
        }
        // completed(1.0 컬럼)도 함께 갱신해 기존 스키마와 의미를 맞춘다
        return transition(userId, sessionId,
            "status = 'COMPLETED', ended_at = NOW(), completed = 1, goal_completed = ?", [input.goalCompleted ? 1 : 0],
            [STATUS.ACTIVE], '종료');
    }

    return { getCurrent, createSession, startSession, endSession, findOwned };
}

let defaultInstance = null;
function getDefault() {
    if (!defaultInstance) defaultInstance = createSessionService({ getDb: () => require('../config/db') });
    return defaultInstance;
}

module.exports = {
    STATUS,
    LIMITS,
    validateCreateInput,
    validateEndInput,
    parseSessionId,
    toSessionDto,
    createSessionService,
    getCurrent: (...a) => getDefault().getCurrent(...a),
    createSession: (...a) => getDefault().createSession(...a),
    startSession: (...a) => getDefault().startSession(...a),
    endSession: (...a) => getDefault().endSession(...a)
};
