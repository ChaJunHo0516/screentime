-- ROLLBACK for 001_security_upgrade.sql
-- PHASE 1 에서 "새로 추가한 것"만 제거한다. 기존 1.0 데이터(users, admins, app_usage_logs ...)는 건드리지 않는다.
-- ⚠️ 주의
--   1) 001b(평문 비밀번호 제거)를 이미 실행했다면 이 rollback 후 v1 코드로는 로그인할 수 없다.
--      그 경우 백업(mysqldump)에서 password 컬럼을 복원해야 한다.
--   2) password 컬럼은 NULL 허용 상태로 남긴다. (NOT NULL 로 되돌리면 NULL 행이 있을 때 실패하므로)
--   3) 발급된 모든 로그인 토큰이 삭제된다.

DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS user_settings;

ALTER TABLE users DROP COLUMN password_updated_at;
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE admins DROP COLUMN password_updated_at;
ALTER TABLE admins DROP COLUMN password_hash;

-- MySQL은 (user_id, logged_at) 인덱스가 생기면 FK용 자동 인덱스(user_id)를 조용히 제거한다.
-- 바로 DROP 하면 ER_DROP_INDEX_FK(1553) 가 나므로 FK용 단일 인덱스를 먼저 만든다.
CREATE INDEX idx_logs_user ON app_usage_logs (user_id);
DROP INDEX idx_logs_user_time ON app_usage_logs;
