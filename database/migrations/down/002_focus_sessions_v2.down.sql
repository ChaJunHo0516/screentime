-- ROLLBACK for 002_focus_sessions_v2.sql
-- Phase 2 에서 추가한 것만 제거한다. ⚠️ Phase 2 이후 생성된 세션의 목표/상태/키워드 정보는 사라진다.
-- (session_id, user_id, planned_minutes, completed, started_at, ended_at 은 남는다)
-- started_at / session_type 의 NULL 허용·기본값 변경은 되돌리지 않는다 (NULL 행이 있으면 실패하므로).

DROP TABLE IF EXISTS session_rules;
DROP INDEX uq_focus_sessions_open ON focus_sessions;
-- (user_id, created_at) 인덱스가 FK 용 자동 인덱스를 대체했을 수 있으므로 FK 용 단일 인덱스를 먼저 만든다 (ER_DROP_INDEX_FK 방지)
CREATE INDEX idx_focus_sessions_user ON focus_sessions (user_id);
DROP INDEX idx_focus_sessions_user_created ON focus_sessions;
ALTER TABLE focus_sessions DROP COLUMN open_session_user;
ALTER TABLE focus_sessions DROP COLUMN updated_at;
ALTER TABLE focus_sessions DROP COLUMN created_at;
ALTER TABLE focus_sessions DROP COLUMN goal_completed;
ALTER TABLE focus_sessions DROP COLUMN status;
ALTER TABLE focus_sessions DROP COLUMN goal;
