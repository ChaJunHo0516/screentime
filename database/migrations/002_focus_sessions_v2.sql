-- 002_focus_sessions_v2.sql  (PHASE 2 — Focus Session)
-- 1.0 의 focus_sessions(미사용 테이블)를 삭제하지 않고 확장한다.
--   기존 컬럼 유지: session_id, user_id, session_type, planned_minutes, completed, started_at, ended_at
--   상태 모델:  PLANNED → ACTIVE → COMPLETED
--               PLANNED / ACTIVE → CANCELLED

-- 1) 목표 / 상태 / 목표 달성 여부 / 생성·수정 시각
ALTER TABLE focus_sessions ADD COLUMN goal VARCHAR(200) NULL AFTER user_id;
ALTER TABLE focus_sessions ADD COLUMN status ENUM('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED' AFTER planned_minutes;
ALTER TABLE focus_sessions ADD COLUMN goal_completed TINYINT(1) NULL AFTER completed;
ALTER TABLE focus_sessions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE focus_sessions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 2) PLANNED 세션은 아직 시작 시각이 없다 → NULL 허용 (기존 값은 그대로 유지됨)
ALTER TABLE focus_sessions MODIFY COLUMN started_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE focus_sessions MODIFY COLUMN session_type VARCHAR(30) NOT NULL DEFAULT 'FOCUS';

-- 3) 1.0 시절 행이 있다면 상태를 채운다 (새로 추가한 컬럼만 갱신, 기존 데이터 변경 없음)
--    완료 표시가 없는 과거 행을 ACTIVE 로 두면 "사용자당 진행 중 세션 1개" 규칙을 막으므로 CANCELLED 로 본다.
UPDATE focus_sessions
   SET status = CASE WHEN completed = 1 THEN 'COMPLETED' ELSE 'CANCELLED' END,
       created_at = COALESCE(started_at, created_at)
 WHERE goal IS NULL AND status = 'PLANNED';

-- 4) 사용자당 "진행 중(PLANNED/ACTIVE)" 세션은 최대 1개 — 동시 요청에도 DB 가 보장
--    (MySQL 은 부분 UNIQUE 인덱스가 없으므로 생성 컬럼 + UNIQUE 사용. NULL 은 중복 허용)
ALTER TABLE focus_sessions
  ADD COLUMN open_session_user VARCHAR(50)
  GENERATED ALWAYS AS (CASE WHEN status IN ('PLANNED', 'ACTIVE') THEN user_id ELSE NULL END) STORED;
CREATE UNIQUE INDEX uq_focus_sessions_open ON focus_sessions (open_session_user);
CREATE INDEX idx_focus_sessions_user_created ON focus_sessions (user_id, created_at);

-- 5) 세션별 규칙. Phase 2 에서는 KEYWORD(목표 키워드)만 사용한다.
--    ALLOW_APP / BLOCK_APP / ALLOW_DOMAIN 은 Phase 4(분류), Phase 11(Focus Mode)에서 사용 예정.
CREATE TABLE IF NOT EXISTS session_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    rule_type ENUM('KEYWORD', 'ALLOW_APP', 'BLOCK_APP', 'ALLOW_DOMAIN') NOT NULL,
    value VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_session_rules (session_id, rule_type, value),
    FOREIGN KEY (session_id) REFERENCES focus_sessions(session_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
