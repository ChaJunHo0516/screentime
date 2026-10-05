-- 001b_clear_plaintext_passwords.sql   ⚠️ 비가역(irreversible) 수동 단계 ⚠️
--
-- 언제 실행하는가?
--   1) 001_security_upgrade 적용 + `npm run hash-passwords` 실행 완료
--   2) 2.0 코드로 모든 사용자/관리자 로그인이 정상 동작하는 것을 확인 (권장: 1~2주 운영)
--   3) rollback 필요성이 없다고 판단한 뒤
--
-- 실행 전 확인 (아래 두 값이 모두 0 이어야 한다 = 해시가 없는 계정이 없음):
--   SELECT COUNT(*) FROM users  WHERE password_hash IS NULL;
--   SELECT COUNT(*) FROM admins WHERE password_hash IS NULL;
--
-- 이 파일은 migrate.js 가 자동 실행하지 않는다. MySQL 클라이언트에서 직접 실행한다.
-- 실행 후에는 평문 비밀번호가 포함된 과거 DB 백업 파일도 안전하게 폐기한다.

UPDATE users  SET password = NULL WHERE password_hash IS NOT NULL;
UPDATE admins SET password = NULL WHERE password_hash IS NOT NULL;
