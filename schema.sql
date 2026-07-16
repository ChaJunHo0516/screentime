-- 1. 기존 DB 밀어버리고 새로 만들기
DROP DATABASE IF EXISTS nudgeai;
CREATE DATABASE nudgeai CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE nudgeai;

-- 2. 회원 명부 테이블 만들기 
CREATE TABLE users (
    user_id VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    username VARCHAR(50),
    current_stage INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 기록 저장용 테이블 만들기 
CREATE TABLE app_usage_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    dwell_seconds INT DEFAULT 0,
    ai_risk FLOAT DEFAULT 0,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


-- 4. 관리자 계정 테이블
CREATE TABLE admins (
    admin_id VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    admin_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- 💡 초기 관리자 계정 생성 (아이디: admin / 비밀번호: admin123)
INSERT INTO admins (admin_id, password, admin_name) VALUES ('admin', 'admin', '관리자');

-- 5. 차단 앱 목록 테이블
CREATE TABLE blocked_apps (
    block_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 6. 차단/해제 이벤트 로그 테이블 (기록용)
CREATE TABLE block_events (
    event_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    reason TEXT,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. 임시 차단 해제 승인 테이블
CREATE TABLE unlock_approvals (
    approval_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    approved_by VARCHAR(50),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. 넛지(AI 멘트) 메시지 설정 테이블
CREATE TABLE nudge_messages (
    message_id INT AUTO_INCREMENT PRIMARY KEY,
    focus_stage INT NOT NULL,
    message_text TEXT NOT NULL,
    updated_by VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--  초기 넛지 메시지 기본값 세팅
INSERT INTO nudge_messages (focus_stage, message_text) VALUES 
(1, '어? 집중의 신호등이 빨간불이네요! 초록불로 바꿔볼까요?'),
(2, '조금씩 집중력이 올라가고 있어요! 계속 유지해봐요!'),
(3, '파이썬 완전 몰입! 집중력 폭발 중! 이대로 쭉 가면 코딩 천재 됩니다!');

-- 9. 보상(점수) 규칙 테이블
CREATE TABLE reward_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    grade_name VARCHAR(50) NOT NULL,
    min_score INT NOT NULL,
    max_score INT NOT NULL,
    points INT NOT NULL,
    updated_by VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
--  초기 보상 규칙 기본값 세팅
INSERT INTO reward_rules (grade_name, min_score, max_score, points) VALUES 
('위험', 0, 49, 0),
('보통', 50, 79, 10),
('우수', 80, 100, 30);

