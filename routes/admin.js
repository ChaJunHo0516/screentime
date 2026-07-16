const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 시스템이 구동될 때 DB에 '집중 앱' 테이블이 없으면 자동으로 생성
pool.query(`
    CREATE TABLE IF NOT EXISTS focus_apps (
        app_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        app_name VARCHAR(100) NOT NULL,
        created_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error("focus_apps 테이블 생성 실패:", err.message));

async function verifyAdmin(adminId, password) {
    const [rows] = await pool.query(
        'SELECT admin_id, admin_name FROM admins WHERE admin_id = ? AND password = ?',
        [adminId, password]
    );
    return rows[0] || null;
}

router.post('/login', async (req, res) => {
    const { admin_id, password } = req.body;
    if (!admin_id || !password) {
        return res.status(400).json({ success: false, message: '관리자 ID와 비밀번호를 입력하세요.' });
    }

    try {
        const admin = await verifyAdmin(admin_id, password);
        if (!admin) {
            return res.status(401).json({ success: false, message: '관리자 인증에 실패했습니다.' });
        }
        res.json({ success: true, admin });
    } catch (err) {
        console.error('관리자 로그인 에러:', err.message);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

router.get('/users', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                u.user_id,
                u.username,
                u.current_stage,
                IFNULL(SUM(CASE WHEN l.category = 'Lecture' AND DATE(l.logged_at) = CURDATE() THEN l.dwell_seconds ELSE 0 END), 0) AS focus_seconds,
                IFNULL(SUM(CASE WHEN l.category <> 'Lecture' AND DATE(l.logged_at) = CURDATE() THEN l.dwell_seconds ELSE 0 END), 0) AS distract_seconds,
                COUNT(DISTINCT b.block_id) AS active_block_count
            FROM users u
            LEFT JOIN app_usage_logs l ON u.user_id = l.user_id
            LEFT JOIN blocked_apps b ON u.user_id = b.user_id AND b.is_active = 1
            GROUP BY u.user_id, u.username, u.current_stage
            ORDER BY u.created_at DESC
        `);
        res.json({ success: true, users: rows });
    } catch (err) {
        console.error('사용자 목록 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.get('/users/:userId/summary', async (req, res) => {
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

router.get('/blocked-apps', async (req, res) => {
    const { user_id } = req.query;
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

router.post('/blocked-apps', async (req, res) => {
    const { user_id, app_name, admin_id = 'admin' } = req.body;
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

router.put('/blocked-apps/:blockId', async (req, res) => {
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

router.delete('/blocked-apps/:blockId', async (req, res) => {
    const { blockId } = req.params;
    try {
        const [rows] = await pool.query('SELECT user_id, app_name FROM blocked_apps WHERE block_id = ?', [blockId]);
        await pool.query('DELETE FROM blocked_apps WHERE block_id = ?', [blockId]);
        if (rows[0]) {
            await pool.query(
                'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
                [rows[0].user_id, rows[0].app_name, 'BLOCK_APP_DELETED', '관리자가 차단 목록에서 삭제', 'admin']
            );
        }
        res.json({ success: true, message: '차단 앱이 삭제되었습니다.' });
    } catch (err) {
        console.error('차단 앱 삭제 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.get('/block/check', async (req, res) => {
    const { user_id, app_name } = req.query;
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

router.post('/block-events', async (req, res) => {
    const { user_id, app_name, event_type, reason, created_by = null } = req.body;
    if (!user_id || !app_name || !event_type) {
        return res.status(400).json({ success: false });
    }

    try {
        await pool.query(
            'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
            [user_id, app_name, event_type, reason || null, created_by]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('차단 이벤트 저장 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.get('/block-events', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT event_id, user_id, app_name, event_type, reason, created_by, created_at
            FROM block_events
            ORDER BY created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, events: rows });
    } catch (err) {
        console.error('차단 로그 조회 에러:', err.message);
        res.status(500).json({ success: false });
    }
});

router.post('/unlock-approvals', async (req, res) => {
    const { user_id, app_name, admin_id = 'admin', password, minutes = 10 } = req.body;
    if (!user_id || !app_name || !password) {
        return res.status(400).json({ success: false, message: '사용자 ID, 앱 이름, 관리자 비밀번호를 입력하세요.' });
    }

    try {
        const admin = await verifyAdmin(admin_id, password);
        if (!admin) {
            return res.status(401).json({ success: false, message: '관리자 인증에 실패했습니다.' });
        }

        await pool.query(
            'INSERT INTO unlock_approvals (user_id, app_name, approved_by, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
            [user_id, app_name, admin_id, Number(minutes) || 10]
        );
        await pool.query(
            'INSERT INTO block_events (user_id, app_name, event_type, reason, created_by) VALUES (?, ?, ?, ?, ?)',
            [user_id, app_name, 'UNLOCK_APPROVED', `${Number(minutes) || 10}분 임시 해제 승인`, admin_id]
        );
        res.json({ success: true, message: `${Number(minutes) || 10}분 동안 임시 해제되었습니다.` });
    } catch (err) {
        console.error('차단 해제 승인 에러:', err.message);
        res.status(500).json({ success: false, message: '차단 해제 승인에 실패했습니다.' });
    }
});

router.get('/nudge-messages', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM nudge_messages ORDER BY focus_stage ASC');
        res.json({ success: true, messages: rows });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

router.put('/nudge-messages/:messageId', async (req, res) => {
    const { messageId } = req.params;
    const { message_text, admin_id = 'admin' } = req.body;
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

router.get('/reward-rules', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM reward_rules ORDER BY min_score DESC');
        res.json({ success: true, rules: rows });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

router.put('/reward-rules/:ruleId', async (req, res) => {
    const { ruleId } = req.params;
    const { min_score, max_score, points, admin_id = 'admin' } = req.body;
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
router.get('/focus-apps', async (req, res) => {
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

router.post('/focus-apps', async (req, res) => {
    const { user_id, app_name, admin_id = 'admin' } = req.body;
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

router.delete('/focus-apps/:appId', async (req, res) => {
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