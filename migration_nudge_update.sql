USE nudgeai;

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
);

CREATE TABLE IF NOT EXISTS focus_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    session_type VARCHAR(30) NOT NULL,
    planned_minutes INT NOT NULL,
    completed TINYINT(1) DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT INTO nudge_resources (focus_stage, resource_type, title, description, url, sort_order, updated_by)
SELECT * FROM (
    SELECT 1, 'focus', '10분 집중 유지', '현재 흐름이 안정적입니다. 다음 단락이나 다음 업무 하나만 더 마무리해보세요.', NULL, 1, 'admin'
    UNION ALL SELECT 1, 'phrase', '오늘 목표 확인', '오늘 해야 할 일을 한 줄로 다시 확인하고 현재 흐름을 이어갑니다.', NULL, 2, 'admin'
    UNION ALL SELECT 2, 'breathing', '1분 호흡 정리', '화면 전환이 많아졌을 때 1분 동안 호흡을 정리하고 다시 집중합니다.', NULL, 1, 'admin'
    UNION ALL SELECT 2, 'music', '집중 음악', '백색소음이나 로파이 음악으로 주변 방해를 줄이고 집중 흐름을 회복합니다.', 'https://www.youtube.com/results?search_query=lofi+focus+music', 2, 'admin'
    UNION ALL SELECT 3, 'stretching', '어깨 스트레칭', '오래 집중한 뒤 목과 어깨를 풀어 피로를 낮춥니다.', 'https://www.youtube.com/results?search_query=3+minute+stretching+neck+shoulder', 1, 'admin'
    UNION ALL SELECT 3, 'breathing', '5분 휴식', '눈을 잠시 쉬게 하고 물을 마신 뒤 다시 업무로 복귀합니다.', NULL, 2, 'admin'
    UNION ALL SELECT 4, 'focus', '5분 집중 모드', '방해 화면을 닫고 5분만 다시 시작합니다.', NULL, 1, 'admin'
    UNION ALL SELECT 4, 'phrase', '다시 시작 문구', '완벽하지 않아도 괜찮아요. 지금 한 단계만 다시 진행해봅시다.', NULL, 2, 'admin'
) seed
WHERE NOT EXISTS (SELECT 1 FROM nudge_resources LIMIT 1);
