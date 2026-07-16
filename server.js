const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const authRoutes = require('./routes/auth');
const logRoutes = require('./routes/logs');
const aiRoutes = require('./routes/ai');
const rewardRoutes = require('./routes/reward');
const adminRoutes = require('./routes/admin');
const rankingRoutes = require('./routes/ranking');

app.use('/api/auth', authRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reward', rewardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ranking',rankingRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// 차준호 2026-05-17 추가 | 트래킹 시작/정지 상태 관리
let trackingActive = true;

app.get('/api/tracking/status', (req, res) => res.json({ active: trackingActive }));
app.post('/api/tracking/start', (req, res) => {
    trackingActive = true;
    console.log('▶️  트래킹 시작');
    res.json({ success: true, active: true });
});
app.post('/api/tracking/stop', (req, res) => {
    trackingActive = false;
    console.log('⏸️  트래킹 정지');
    res.json({ success: true, active: false });
});

// 차준호 2026-05-17 추가 | config.json 키워드 읽기/쓰기 API
// 대시보드·어드민에서 키워드 추가/삭제 시 config.json에 직접 반영
const fs = require('fs');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// GET /api/config/keywords — 현재 lecture_keywords 반환
app.get('/api/config/keywords', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        res.json({ success: true, keywords: config.lecture_keywords || [] });
    } catch (err) {
        console.error('config 읽기 실패:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/config/keywords — 키워드 추가
app.post('/api/config/keywords', (req, res) => {
    const { keyword } = req.body;
    if (!keyword || !keyword.trim()) {
        return res.status(400).json({ success: false, message: '키워드를 입력하세요.' });
    }
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const kw = keyword.trim();
        if (config.lecture_keywords.includes(kw)) {
            return res.json({ success: false, message: '이미 등록된 키워드입니다.' });
        }
        config.lecture_keywords.push(kw);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
        console.log(`🔑 [키워드 추가] ${kw}`);
        res.json({ success: true, keywords: config.lecture_keywords });
    } catch (err) {
        console.error('config 쓰기 실패:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/config/keywords — 키워드 삭제
app.delete('/api/config/keywords', (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ success: false, message: '키워드를 입력하세요.' });
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        config.lecture_keywords = config.lecture_keywords.filter(k => k !== keyword);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
        console.log(`🗑️  [키워드 삭제] ${keyword}`);
        res.json({ success: true, keywords: config.lecture_keywords });
    } catch (err) {
        console.error('config 쓰기 실패:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});