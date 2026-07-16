const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.post('/register', async (req, res) => {
    const { user_id, password, username } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (user_id, password, username) VALUES (?, ?, ?)', 
            [user_id, password, username]
        );
        res.status(201).json({ success: true, message: "가입 성공" });
    } catch (err) {
        console.error("회원가입 에러:", err);
        res.status(500).json({ success: false, message: "이미 존재하는 아이디거나 서버 에러입니다." });
    }
});

router.post('/login', async (req, res) => {
    const { user_id, password } = req.body;
    try {
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE user_id = ? AND password = ?', 
            [user_id, password]
        );
        
        if (rows.length > 0) {
            res.status(200).json({
                success: true,
                user_info: { username: rows[0].username } 
            });
        } else {
            res.status(401).json({ success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." });
        }
    } catch (err) {
        console.error("로그인 에러:", err);
        res.status(500).json({ success: false, message: "서버 내부 에러가 발생했습니다." });
    }
});

module.exports = router;