const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authService = require('../services/authService');
const {
    ADMIN_COOKIE, requireAdmin, requireUser, requireUserOrAdmin,
    setAuthCookie, clearAuthCookie
} = require('../middleware/auth');

// 2.0 Phase 1 | focus_apps 런타임 CREATE TABLE 제거 → database/migrations/000_baseline.sql 에서 관리
//               (앱 실행 계정에는 DDL 권한을 주지 않는다)

// 2.0 Phase 1 | 평문 비교 → bcrypt 검증 (authService.verifyCredentials)
async function verifyAdmin(adminId, password) {
    if (typeof adminId !== 'string' || typeof password !== 'string' || !adminId || !password) return null;
    return authService.verifyCredentials('ADMIN', adminId, password);
}

// 2.0 Phase 1 | 관리자 로그인 성공 시 HttpOnly 쿠키(ff_admin) 발급. 응답 형태(admin)는 기존과 동일.
router.post('/login', async (req, res) => {
    const { admin_id, password } = req.body || {};
    if (!admin_id || !password) {
        return res.status(400).json({ success: false, message: '관리자 ID와 비밀번호를 입력하세요.' });
    }

    try {
        const admin = await verifyAdmin(admin_id, password);
        if (!admin) {
            return res.status(401).json({ success: false, message: '관리자 인증에 실패했습니다.' });
        }
        const issued = await authService.issueToken({ subjectType: 'ADMIN', subjectId: admin.admin_id });
        setAuthCookie(res, ADMIN_COOKIE, issued.token, issued.maxAgeMs);
        res.json({ success: true, admin });
    } catch (err) {
        console.error('관리자 로그인 에러:', err.message);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

router.post('/logout', async (req, res) => {
    const token = (req.cookies && req.cookies[ADMIN_COOKIE]) || null;
    if (token) await authService.revokeToken(token);
    clearAuthCookie(res, ADMIN_COOKIE);
    res.json({ success: true });
});

// 관리자 화면 진입 시 세션 확인용 (localStorage 값 대신 서버 판단)
router.get('/me', requireAdmin, async (req, res) => {
    const [rows] = await pool.query('SELECT admin_id, admin_name FROM admins WHERE admin_id = ?', [req.admin.id]);
    if (!rows[0]) return res.status(401).json({ success: false, message: '관리자 계정을 찾을 수 없습니다.' });
    res.json({ success: true, admin: rows[0] });
});

// 2.0 Phase 1 | 집계 버그 수정: logs 와 blocked_apps 를 동시에 JOIN 하면
//   SUM(dwell_seconds) 가 "활성 차단 앱 개수" 만큼 곱해졌다 → 각각 서브쿼리로 미리 집계 후 JOIN
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                u.user_id,
                u.username,
                u.current_stage,
                IFNULL(l.focus_seconds, 0) AS focus_seconds,
                IFNULL(l.distract_seconds, 0) AS distract_seconds,
                IFNULL(b.active_block_count, 0) AS active_block_count
            FROM users u
            LEFT JOIN (
                SELECT user_id,
                       SUM(CASE WHEN category = 'Lecture' THEN dwell_seconds ELSE 0 END) AS focus_seconds,
                       SUM(CASE WHEN category <> 'Lecture' THEN dwell_seconds ELSE 0 END) AS distract_seconds
                FROM app_usage_logs
                WHERE logged_at >= CURDATE()
                GROUP BY user_id
            ) l ON l.user_id = u.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS active_block_count
                FROM blocked_apps
                WHERE is_active = 1
                GROUP BY user_id
            ) b ON b.user_id = u.user_id
            ORDER BY u.created_at DESC
        `);
        res.json({ success: true, users: rows });
    } catch (err) {
        console.error('사용자 목록 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.get('/users/:userId/summary', requireAdmin, async (req, res) => {
    const { userId } = req.params;
    try {
        const [stats] = await pool.query(`
            SELECT
                IFNULL(SUM(CASE WHEN category = 'Lecture' THEN dwell_seconds ELSE 0 END), 0) AS focus_seconds,
                IFNULL(SUM(CASE WHEN category <> 'Lecture' THEN dwell_seconds ELSE 0 END), 0) AS distract_seconds,
                COUNT(*) AS log_count
            FROM app_usage_logs
            WHERE user_id = ? AND DATE(logged_at) = CURDATE()
        `, [userId]);
        const [latest] = await pool.query(`
            SELECT app_name, category, logged_at
            FROM app_usage_logs
            WHERE user_id = ?
            ORDER BY logged_at DESC
            LIMIT 10
        `, [userId]);
        res.json({ success: true, stats: stats[0], latest });
    } catch (err) {
        console.error('사용자 요약 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

// 관리자: 전체 또는 ?user_id 필터 / 사용자(agent): 항상 "본인" 목록만 (query 의 user_id 무시)
router.get('/blocked-apps', requireUserOrAdmin, async (req, res) => {
    const user_id = req.admin ? req.query.user_id : req.user.id;
    try {
        const params = [];
        let sql = `
            SELECT b.block_id, b.user_id, u.username, b.app_name, b.is_active, b.created_at, b.created_by
            FROM blocked_apps b
            JOIN users u ON b.user_id = u.user_id
        `;
        if (user_id) {
            sql += ' WHERE b.user_id = ?';
            params.push(user_id);
        }
        sql += ' ORDER BY b.created_at DESC';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, blocked_apps: rows });
    } catch (err) {
        console.error('차단 앱 조회 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.post('/blocked-apps', requireAdmin, async (req, res) => {
    const { user_id, app_name } = req.body || {};
    const admin_id = req.admin.id;   // body 의 admin_id 는 신뢰하지 않는다
    if (!user_id || !app_name) {
        return res.status(400).json({ success: false, message: '사용자 ID와 앱 이름을 입력하세요.' });
    }

    try {
        await pool.query(
            'INSERT INTO blocked_apps (user_id, app_name, created_by) VALUES (?, ?, ?)',
            [user_id, app_name, admin_id]
        );
        await pool.query(
            'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
            [user_id, app_name, 'BLOCK_APP_ADDED', '관리자가 차단 앱으로 등록', admin_id]
        );
        res.status(201).json({ success: true, message: '차단 앱이 등록되었습니다.' });
    } catch (err) {
        console.error('차단 앱 등록 에러:', err.message);
        res.status(500).json({ success: false, message: '사용자 ID가 없거나 DB 저장에 실패했습니다.' });
    }
});

router.put('/blocked-apps/:blockId', requireAdmin, async (req, res) => {
    const { blockId } = req.params;
    const { app_name, is_active } = req.body;
    try {
        const fields = [];
        const params = [];
        if (app_name !== undefined) {
            fields.push('app_name = ?');
            params.push(app_name);
        }
        if (is_active !== undefined) {
            fields.push('is_active = ?');
            params.push(Number(is_active));
        }
        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: '수정할 값이 없습니다.' });
        }
        params.push(blockId);
        await pool.query(`UPDATE blocked_apps SET ${fields.join(', ')} WHERE block_id = ?`, params);
        res.json({ success: true, message: '차단 앱 정보가 수정되었습니다.' });
    } catch (err) {
        console.error('차단 앱 수정 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.delete('/blocked-apps/:blockId', requireAdmin, async (req, res) => {
    const { blockId } = req.params;
    try {
        const [rows] = await pool.query('SELECT user_id, app_name FROM blocked_apps WHERE block_id = ?', [blockId]);
        await pool.query('DELETE FROM blocked_apps WHERE block_id = ?', [blockId]);
        if (rows[0]) {
            await pool.query(
                'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
                [rows[0].user_id, rows[0].app_name, 'BLOCK_APP_DELETED', '관리자가 차단 목록에서 삭제', req.admin.id]
            );
        }
        res.json({ success: true, message: '차단 앱이 삭제되었습니다.' });
    } catch (err) {
        console.error('차단 앱 삭제 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

// agent 전용: 사용자 = 토큰의 본인
router.get('/block/check', requireUser, async (req, res) => {
    const user_id = req.user.id;
    const { app_name } = req.query;
    if (!user_id || !app_name) {
        return res.status(400).json({ success: false, blocked: false });
    }

    try {
        const [blocks] = await pool.query(`
            SELECT block_id, app_name
            FROM blocked_apps
            WHERE user_id = ?
              AND is_active = 1
              AND LOCATE(LOWER(app_name), LOWER(?)) > 0
            ORDER BY created_at DESC
            LIMIT 1
        `, [user_id, app_name]);

        if (blocks.length === 0) {
            return res.json({ success: true, blocked: false });
        }

        const [approvals] = await pool.query(`
            SELECT approval_id
            FROM unlock_approvals
            WHERE user_id = ?
              AND LOCATE(LOWER(app_name), LOWER(?)) > 0
              AND expires_at > NOW()
            ORDER BY expires_at DESC
            LIMIT 1
        `, [user_id, app_name]);

        if (approvals.length > 0) {
            return res.json({ success: true, blocked: false, approved: true, matched_app: blocks[0].app_name });
        }

        res.json({ success: true, blocked: true, matched_app: blocks[0].app_name });
    } catch (err) {
        console.error('차단 확인 에러:', err.message);
        res.status(500).json({ success: false, blocked: false });
    }
});

// agent 전용: 차단 이벤트 기록. 사용자 = 토큰의 본인, created_by 는 agent 가 지정할 수 없음
router.post('/block-events', requireUser, async (req, res) => {
    const user_id = req.user.id;
    const { app_name, event_type, reason } = req.body || {};
    const created_by = null;
    if (typeof app_name !== 'string' || !app_name || typeof event_type !== 'string' || !/^[A-Z_]{1,50}$/.test(event_type)) {
        return res.status(400).json({ success: false });
    }

    try {
        await pool.query(
            'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
            [user_id, app_name.slice(0, 100), event_type, typeof reason === 'string' ? reason.slice(0, 500) : null, created_by]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('차단 이벤트 저장 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.get('/block-events', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT event_id, user_id, app_name, event_type, reason, created_by, created_at
            FROM block_events
            ORDER BY created_at DESC, event_id DESC
            LIMIT 100
        `);
        res.json({ success: true, events: rows });
    } catch (err) {
        console.error('차단 로그 조회 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

// 임시 해제는 로그인된 관리자 + 비밀번호 재확인 (기존 동작 유지, bcrypt 검증)
router.post('/unlock-approvals', requireAdmin, async (req, res) => {
    const { user_id, app_name, password, minutes = 10 } = req.body || {};
    const admin_id = req.admin.id;
    const mins = Math.min(Math.max(Number(minutes) || 10, 1), 1440);
    if (!user_id || !app_name || !password) {
        return res.status(400).json({ success: false, message: '사용자 ID, 앱 이름, 관리자 비밀번호를 입력하세요.' });
    }

    try {
        const admin = await verifyAdmin(admin_id, password);
        if (!admin) {
            // 이미 로그인된 관리자의 "비밀번호 재확인" 실패 → 403 (401 은 세션 만료 의미로만 사용)
            return res.status(403).json({ success: false, message: '관리자 비밀번호가 일치하지 않습니다.' });
        }

        await pool.query(
            'INSERT INTO unlock_approvals (user_id, app_name, approved_by, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
            [user_id, app_name, admin_id, mins]
        );
        await pool.query(
            'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
            [user_id, app_name, 'UNLOCK_APPROVED', `${mins}분 임시 해제 승인`, admin_id]
        );
        res.json({ success: true, message: `${mins}분 동안 임시 해제되었습니다.` });
    } catch (err) {
        console.error('차단 해제 승인 에러:', err.message);
        res.status(500).json({ success: false, message: '차단 해제 승인에 실패했습니다.' });
    }
});

router.get('/nudge-messages', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM nudge_messages ORDER BY focus_stage ASC');
        res.json({ success: true, messages: rows });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

router.put('/nudge-messages/:messageId', requireAdmin, async (req, res) => {
    const { messageId } = req.params;
    const { message_text } = req.body || {};
    const admin_id = req.admin.id;
    if (typeof message_text !== 'string' || !message_text.trim() || message_text.length > 500) {
        return res.status(400).json({ success: false, message: '메시지는 1~500자로 입력하세요.' });
    }
    try {
        await pool.query(
            'UPDATE nudge_messages SET message_text = ?, updated_by = ? WHERE message_id = ?',
            [message_text, admin_id, messageId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

router.get('/reward-rules', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM reward_rules ORDER BY min_score DESC');
        res.json({ success: true, rules: rows });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

router.put('/reward-rules/:ruleId', requireAdmin, async (req, res) => {
    const { ruleId } = req.params;
    const { min_score, max_score, points } = req.body || {};
    const admin_id = req.admin.id;
    try {
        await pool.query(
            'UPDATE reward_rules SET min_score = ?, max_score = ?, points = ?, updated_by = ? WHERE rule_id = ?',
            [min_score, max_score, points, admin_id, ruleId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 🌟 새로 추가된 기능: 집중도 판별 허용 앱(Focus App) 백엔드 라우터 🌟
router.get('/focus-apps', requireAdmin, async (req, res) => {
    const { user_id } = req.query;
    try {
        let sql = `
            SELECT f.app_id, f.user_id, u.username, f.app_name, f.created_at
            FROM focus_apps f
            JOIN users u ON f.user_id = u.user_id
        `;
        const params = [];
        if (user_id) {
            sql += ' WHERE f.user_id = ?';
            params.push(user_id);
        }
        sql += ' ORDER BY f.created_at DESC';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, focus_apps: rows });
    } catch (err) {
        console.error('집중 앱 조회 에러:', err.message);
        res.json({ success: true, focus_apps: [] }); // 에러 나도 빈 배열로 안전하게 리턴
    }
});

router.post('/focus-apps', requireAdmin, async (req, res) => {
    const { user_id, app_name } = req.body || {};
    const admin_id = req.admin.id;
    if (!user_id || !app_name) {
        return res.status(400).json({ success: false, message: '사용자 ID와 앱 이름을 입력하세요.' });
    }
    try {
        await pool.query(
            'INSERT INTO focus_apps (user_id, app_name, created_by) VALUES (?, ?, ?)',
            [user_id, app_name, admin_id]
        );

        // 차준호 2026-05-17 추가 | 어드민 집중 앱 등록 → config.json에도 동기화
        try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, '..', 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (!config.lecture_keywords.includes(app_name)) {
                config.lecture_keywords.push(app_name);
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                console.log(`🔑 [어드민 키워드 추가 → config.json] ${app_name}`);
            }
        } catch (configErr) {
            console.error('config.json 동기화 실패:', configErr.message);
        }

        res.status(201).json({ success: true, message: '집중도 판별 앱이 등록되었습니다.' });
    } catch (err) {
        console.error('집중 앱 등록 에러:', err.message);
        res.status(500).json({ success: false, message: '등록에 실패했습니다.' });
    }
});

router.delete('/focus-apps/:appId', requireAdmin, async (req, res) => {
    const { appId } = req.params;
    try {
        // 차준호 2026-05-17 추가 | 삭제 전 app_name 조회해서 config.json에서도 제거
        const [rows] = await pool.query('SELECT app_name FROM focus_apps WHERE app_id = ?', [appId]);
        await pool.query('DELETE FROM focus_apps WHERE app_id = ?', [appId]);

        if (rows[0]) {
            try {
                const fs = require('fs');
                const path = require('path');
                const configPath = path.join(__dirname, '..', 'config.json');
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                config.lecture_keywords = config.lecture_keywords.filter(k => k !== rows[0].app_name);
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                console.log(`🗑️  [어드민 키워드 삭제 → config.json] ${rows[0].app_name}`);
            } catch (configErr) {
                console.error('config.json 동기화 실패:', configErr.message);
            }
        }

        res.json({ success: true, message: '집중 앱이 삭제되었습니다.' });
    } catch (err) {
        console.error('집중 앱 삭제 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

module.exports = router;