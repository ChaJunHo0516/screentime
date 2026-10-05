-- PHASE 1 E2E 테스트용 시드 — ⚠️ 테스트 전용 DB(예: nudgeai_test)에서만 실행
--   1) .env 의 DB_NAME=nudgeai_test 로 바꾼 뒤  npm run migrate -- --create-db
--   2) mysql -u <user> -p nudgeai_test < tests/e2e/seed_phase1_test.sql
--   3) npm run hash-passwords        (1.0 처럼 평문으로 넣은 계정을 해시로 변환 → 실제 마이그레이션 경로 검증)
--   4) npm start  →  node tests/e2e/phase1.e2e.mjs
INSERT INTO users (user_id, password, username) VALUES
  ('jy16', '1234', '준영'),
  ('inha', 'inhapw', '인하'),
  ('evil', 'evilpw', '<img src=x onerror="window.__xssUser=1">');
INSERT INTO admins (admin_id, password, admin_name) VALUES ('admin', 'admin', '관리자');
INSERT INTO app_usage_logs (user_id, app_name, category, dwell_seconds) VALUES
  ('inha', '인하의 비밀 창 제목', 'Lecture', 3),
  ('jy16', 'Python 강의 - YouTube', 'Lecture', 600),
  ('jy16', '카톡', 'Distract', 120);
INSERT INTO blocked_apps (user_id, app_name) VALUES ('jy16', 'steam'), ('jy16', 'discord');
