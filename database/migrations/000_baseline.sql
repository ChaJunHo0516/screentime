-- 000_baseline.sql
-- FocusFlow 1.0 의 현재 스키마(legacy/schema_v1.sql + migration_nudge_update + runtime focus_apps)를
-- "CREATE TABLE IF NOT EXISTS" 로 재정의한다.
--   * 이미 1.0 DB가 있는 경우: 모든 문장이 no-op → 기존 데이터 그대로 유지
--   * 새로 설치하는 경우: 1.0 과 동일한 테이블이 생성됨
-- DROP / TRUNCATE 를 사용하지 않는다. 관리자 계정은 시드하지 않는다(scripts/create-admin.js 사용).

CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    username VARCHAR(50),
    current_stage INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS app_usage_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    dwell_seconds INT DEFAULT 0,
    ai_risk FLOAT DEFAULT 0,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS admins (
    admin_id VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    admin_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS blocked_apps (
    block_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS block_events (
    event_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    reason TEXT,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS unlock_approvals (
    approval_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    approved_by VARCHAR(50),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS nudge_messages (
    message_id INT AUTO_INCREMENT PRIMARY KEY,
    focus_stage INT NOT NULL,
    message_text TEXT NOT NULL,
    updated_by VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

INSERT INTO nudge_messages (focus_stage, message_text)
SELECT * FROM (
    SELECT 1 AS focus_stage, '어? 집중의 신호등이 빨간불이네요! 초록불로 바꿔볼까요?' AS message_text
    UNION ALL SELECT 2, '조금씩 집중력이 올라가고 있어요! 계속 유지해봐요!'
    UNION ALL SELECT 3, '파이썬 완전 몰입! 집중력 폭발 중! 이대로 쭉 가면 코딩 천재 됩니다!'
) seed
WHERE NOT EXISTS (SELECT 1 FROM nudge_messages LIMIT 1);

CREATE TABLE IF NOT EXISTS reward_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    grade_name VARCHAR(50) NOT NULL,
    min_score INT NOT NULL,
    max_score INT NOT NULL,
    points INT NOT NULL,
    updated_by VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

INSERT INTO reward_rules (grade_name, min_score, max_score, points)
SELECT * FROM (
    SELECT '위험' AS grade_name, 0 AS min_score, 49 AS max_score, 0 AS points
    UNION ALL SELECT '보통', 50, 79, 10
    UNION ALL SELECT '우수', 80, 100, 30
) seed
WHERE NOT EXISTS (SELECT 1 FROM reward_rules LIMIT 1);

CREATE TABLE IF NOT EXISTS nudge_resources (
    resource_id INT AUTO_INCREMENT PRIMARY KEY,
    focus_stage INT NOT NULL,
    resource_type VARCHAR(30) NOT NULL,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL,
    url VARCHAR(500),
    is_active TINYINT(1) DEFAULT 1,
    sort_order INT DEFAULT 0,
    updated_by VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES admins(admin_id) ON DELETE SET NULL
) CHARACTER SET utf8mb4;

-- 1.0 migration 의 시드와 동일하되 updated_by 는 NULL (새 설치 시 admin 행이 아직 없으므로 FK 오류 방지)
INSERT INTO nudge_resources (focus_stage, resource_type, title, description, url, sort_order, updated_by)
SELECT * FROM (
    SELECT 1 AS focus_stage, 'focus' AS resource_type, '10분 집중 유지' AS title, '현재 흐름이 안정적입니다. 다음 단락이나 다음 업무 하나만 더 마무리해보세요.' AS description, NULL AS url, 1 AS sort_order, NULL AS updated_by
    UNION ALL SELECT 1, 'phrase', '오늘 목표 확인', '오늘 해야 할 일을 한 줄로 다시 확인하고 현재 흐름을 이어갑니다.', NULL, 2, NULL
    UNION ALL SELECT 2, 'breathing', '1분 호흡 정리', '화면 전환이 많아졌을 때 1분 동안 호흡을 정리하고 다시 집중합니다.', NULL, 1, NULL
    UNION ALL SELECT 2, 'music', '집중 음악', '백색소음이나 로파이 음악으로 주변 방해를 줄이고 집중 흐름을 회복합니다.', 'https://www.youtube.com/results?search_query=lofi+focus+music', 2, NULL
    UNION ALL SELECT 3, 'stretching', '어깨 스트레칭', '오래 집중한 뒤 목과 어깨를 풀어 피로를 낮춥니다.', 'https://www.youtube.com/results?search_query=3+minute+stretching+neck+shoulder', 1, NULL
    UNION ALL SELECT 3, 'breathing', '5분 휴식', '눈을 잠시 쉬게 하고 물을 마신 뒤 다시 업무로 복귀합니다.', NULL, 2, NULL
    UNION ALL SELECT 4, 'focus', '5분 집중 모드', '방해 화면을 닫고 5분만 다시 시작합니다.', NULL, 1, NULL
    UNION ALL SELECT 4, 'phrase', '다시 시작 문구', '완벽하지 않아도 괜찮아요. 지금 한 단계만 다시 진행해봅시다.', NULL, 2, NULL
) seed
WHERE NOT EXISTS (SELECT 1 FROM nudge_resources LIMIT 1);

CREATE TABLE IF NOT EXISTS focus_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    session_type VARCHAR(30) NOT NULL,
    planned_minutes INT NOT NULL,
    completed TINYINT(1) DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

-- 1.0 에서는 routes/admin.js 가 서버 시작 시 런타임으로 생성하던 테이블. 2.0 부터 migration 으로 관리.
CREATE TABLE IF NOT EXISTS focus_apps (
    app_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    app_name VARCHAR(100) NOT NULL,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;
