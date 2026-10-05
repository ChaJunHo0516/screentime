-- 001_security_upgrade.sql  (PHASE 1)
-- 비파괴(additive) 변경만 수행한다.
--   * 평문 password 컬럼은 삭제하지 않는다. NULL 허용으로만 바꾼다.
--     → 해시 백필 후에도 v1 코드로 즉시 rollback 가능.
--     → 평문 제거는 검증 완료 후 database/manual/001b_clear_plaintext_passwords.sql 로 별도 수행.

-- 1) 사용자 비밀번호 해시 컬럼
ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER password;
ALTER TABLE users ADD COLUMN password_updated_at DATETIME NULL AFTER password_hash;
ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NULL;

-- 2) 관리자 비밀번호 해시 컬럼
ALTER TABLE admins ADD COLUMN password_hash VARCHAR(255) NULL AFTER password;
ALTER TABLE admins ADD COLUMN password_updated_at DATETIME NULL AFTER password_hash;
ALTER TABLE admins MODIFY COLUMN password VARCHAR(255) NULL;

-- 3) 인증 토큰 (DB 기반 opaque token)
--    원문 토큰은 저장하지 않고 SHA-256 해시만 저장한다.
--    subject_type: USER(users.user_id) / ADMIN(admins.admin_id)
--    client_type : WEB(브라우저 HttpOnly 쿠키) / AGENT(Windows agent Bearer)
CREATE TABLE IF NOT EXISTS auth_tokens (
    token_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    subject_type ENUM('USER', 'ADMIN') NOT NULL,
    subject_id VARCHAR(50) NOT NULL,
    client_type ENUM('WEB', 'AGENT') NOT NULL DEFAULT 'WEB',
    device_name VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    UNIQUE KEY uq_auth_tokens_hash (token_hash),
    KEY idx_auth_tokens_subject (subject_type, subject_id)
) CHARACTER SET utf8mb4;

-- 4) 사용자별 설정 (전역 trackingActive 대체)
--    행이 없으면 기본값(tracking 활성, AI 사용)으로 간주한다.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id VARCHAR(50) PRIMARY KEY,
    tracking_paused TINYINT(1) NOT NULL DEFAULT 0,
    ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

-- 5) 사용자별 로그 조회 성능 (dashboard / latest / calendar 가 모두 user_id + logged_at 범위 조회)
CREATE INDEX idx_logs_user_time ON app_usage_logs (user_id, logged_at);
