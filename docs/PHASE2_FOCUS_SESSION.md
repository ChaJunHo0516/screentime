# FocusFlow 2.0 — PHASE 2: Focus Session

## 적용

```powershell
mysqldump -u root -p nudgeai > backup_phase2.sql
git pull / 압축 해제
npm run migrate          # 002_focus_sessions_v2 적용 (000, 001 은 이미 적용되어 있으면 건너뜀)
npm run migrate:status   # ✔ 002_focus_sessions_v2 확인
npm test
npm start
```

Agent(tracker.py) 변경 없음 — 재설치 불필요.

## 상태 모델

```
PLANNED ──start──▶ ACTIVE ──end{goalCompleted}──▶ COMPLETED
   │                  │
   └──end{cancel}─────┴──end{cancel}──▶ CANCELLED
```

* 사용자당 진행 중(PLANNED/ACTIVE) 세션은 1개 — DB UNIQUE(생성 컬럼 `open_session_user`)로 보장
* 남은 시간은 DB `NOW()` 기준으로 서버가 계산 → 새로고침/다른 기기에서도 동일
* 계획 시간이 지나도 자동 종료하지 않는다 (사용자가 직접 종료하며 목표 달성 여부를 답함)

## DB (002_focus_sessions_v2)

| 대상 | 변경 |
|---|---|
| `focus_sessions` | 추가: `goal`, `status`, `goal_completed`, `created_at`, `updated_at`, `open_session_user`(생성 컬럼) / `started_at` NULL 허용 / `session_type` 기본값 'FOCUS' |
| 기존 컬럼 | `session_type`, `planned_minutes`, `completed`, `started_at`, `ended_at` 유지. COMPLETED 시 `completed=1` 동기화 |
| `session_rules` (신규) | `(session_id, rule_type, value)` — Phase 2 는 `KEYWORD` 만 사용 |
| 1.0 행 | 있을 경우 `completed` 기준으로 COMPLETED / CANCELLED 채움 |

## API

| Method | Path | Body | 결과 |
|---|---|---|---|
| POST | `/api/v2/sessions` | `{goal, plannedMinutes, keywords[]}` | 201 PLANNED / 409 `SESSION_ALREADY_OPEN` / 400 |
| POST | `/api/v2/sessions/:id/start` | – | ACTIVE / 409 `INVALID_SESSION_STATE` |
| POST | `/api/v2/sessions/:id/end` | `{goalCompleted: bool}` 또는 `{cancel: true}` | COMPLETED / CANCELLED / 409 |
| GET | `/api/v2/sessions/current` | – | `{session}` 또는 `{session: null}` |

응답: `{ success: true, data: { session: { id, goal, plannedMinutes, keywords, status, goalCompleted, createdAt, startedAt, endedAt, elapsedSeconds, remainingSeconds, overtime } } }`
타인/없는 세션: 404 `SESSION_NOT_FOUND` (존재 여부 비노출). 모든 v2 API 는 로그인 필요(401).

입력 제한: 목표 1~200자, 계획 1~480분(정수), 키워드 최대 20개·각 50자, `<` `>` 제어문자 금지, 대소문자 무시 중복 제거.

## UI (dashboard.html 상단 "🎯 집중 세션" 카드, `public/js/session.js`)

* 세션 없음: 목표 / 계획 시간(25·50·60·90 프리셋) / 키워드 입력 → "세션 시작"
* 진행 중: 목표, 키워드 칩, 진행 바, 남은 시간 카운트다운(1초), "세션 종료" → 목표 달성 여부 확인, "세션 취소"
* 계획 시간 도달 시 "+경과" 표시로 전환
* 30초마다 + 탭 복귀 시 서버와 재동기화
* 기존 tracking 시작/정지와 독립 (세션 키워드를 활동 분류에 쓰는 것은 Phase 4)

## 테스트

| 종류 | 명령 |
|---|---|
| 단위 | `npm test` (입력 검증, 상태별 남은 시간, id 파싱) |
| E2E | Phase 1 테스트 DB 시드 상태에서 `node tests/e2e/phase2.e2e.mjs` (31 시나리오) |

수동 체크리스트
- [ ] 목표 입력 → 세션 시작 → 남은 시간이 1초씩 줄어듦
- [ ] 새로고침 / 다른 브라우저에서 같은 계정 로그인 → 같은 세션·남은 시간
- [ ] 세션 종료 → "달성했어요" / "못 했어요" → 결과 배너, DB `goal_completed` 1/0
- [ ] 세션 취소 → CANCELLED
- [ ] 다른 계정에서는 내 세션이 보이지 않음
- [ ] 기존 tracking 정지/시작, 차트, 달력, 퀴즈 정상
- [ ] DB: `SELECT status, COUNT(*) FROM focus_sessions GROUP BY status;`

## Rollback

* 코드: Phase 1 커밋으로 checkout (또는 server.js 의 `/api/v2/sessions` 한 줄 + dashboard.html 세션 카드 제거)
* DB: `node database/migrate.js --down 002_focus_sessions_v2`
  (Phase 2 이후 생성된 세션의 목표/상태/키워드 정보는 삭제됨. 1.0 컬럼은 유지)

## 알려진 한계 / 다음 Phase 연결

* `/api/v2/sessions/history` 는 범위 외 → Phase 9 (Dashboard 2.0)
* 세션 키워드·목표는 아직 tracking 분류에 사용되지 않음 → Phase 4
* agent 는 세션을 모름 → Phase 3 batch payload 에 `sessionId` 포함 예정
* `final_focus_score` 는 Phase 5, 세션 종료 후 퀴즈 연결은 Phase 8
