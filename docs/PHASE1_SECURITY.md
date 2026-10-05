# FocusFlow 2.0 — PHASE 1: Security / Configuration

## 0. 적용 전 (반드시)

```powershell
git tag v1-final                                   # 코드 rollback 지점
mysqldump -u root -p nudgeai > backup_phase1.sql   # DB 백업 (평문 비밀번호 포함 → 안전한 곳에 보관 후 폐기)
```

**Gemini API 키 교체**: 1.0 저장소에 `.env` 가 포함되어 있었으므로, GitHub 에 push 된 적이 있다면 키를 재발급하고 이전 키를 폐기한다.
**MySQL root 비밀번호 변경**: 1.0 `config/db.js` 에 하드코딩되어 있었다.

## 1. 설치 / 마이그레이션 순서

```powershell
git rm --cached .env                 # (저장소에 .env 가 추적 중이라면) 로컬 파일은 유지됨
copy .env.example .env               # 값 채우기: DB_USER / DB_PASSWORD / DB_NAME / GEMINI_API_KEY
npm install                          # bcrypt, cookie-parser, helmet, express-rate-limit 추가
npm run migrate                      # 000_baseline(기존 DB no-op) + 001_security_upgrade
npm run hash-passwords -- --dry-run  # 대상 건수 미리보기
npm run hash-passwords               # 1.0 평문 비밀번호 → bcrypt (평문은 아직 유지)
npm run create-admin                 # 관리자 비밀번호 재설정 (1.0 시드 'admin' 은 반드시 교체)
npm test                             # 단위 테스트
npm start

pip install -r requirements.txt      # keyring 추가
python tracker.py --login            # agent 최초 1회 로그인 (토큰 → Windows 자격 증명 관리자)
python tracker.py
```

권장: 앱 실행용 DB 계정은 DML 권한만 부여하고, 마이그레이션은 `DB_MIGRATION_USER` 로 실행한다.

```sql
CREATE USER 'focusflow_app'@'localhost' IDENTIFIED BY '<강한 비밀번호>';
GRANT SELECT, INSERT, UPDATE, DELETE ON nudgeai.* TO 'focusflow_app'@'localhost';
```

## 2. 변경 요약

| 영역 | 1.0 | 2.0 Phase 1 |
|---|---|---|
| 비밀번호 | 평문 저장/비교 | bcrypt (`password_hash`). 1.0 계정은 스크립트 일괄 변환 + 로그인 시 자동 변환 |
| 인증 | localStorage 의 user_id | DB 기반 opaque 토큰. 브라우저=HttpOnly 쿠키(`ff_session`, `ff_admin`), agent=Bearer |
| 관리자 | `admin/admin` 클라이언트 우회, 서버 인증 없음 | 우회 삭제, 모든 관리자 API `requireAdmin` |
| 사용자 데이터 | URL/body 의 user_id 신뢰 | 서버가 토큰으로 사용자 결정. 타인 데이터 403 |
| `/api/logs/latest` | 시스템 전역 최신 1건 | 인증된 본인 최신 1건 |
| tracking 정지 | 서버 전역 변수 1개 | `user_settings.tracking_paused` (사용자별) |
| Secret | `.env` 커밋, DB 비밀번호 하드코딩 | `.gitignore`, `.env.example`, `config/env.js` 검증 |
| XSS | 창 제목/닉네임/AI 응답을 innerHTML | `escapeHtml` / textContent |
| 에러 형식 | 제각각 | `{success:false, message, error:{code,message}}` |
| 기타 | 관리자 사용자목록 집계 ×(차단앱 수) 버그, 랭킹 `?isAdmin=true` 우회 | 수정 |

## 3. API 변화

- 신규: `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/admin/logout`, `GET /api/admin/me`
- `POST /api/auth/login`: body 에 `client: "agent"` 를 주면 쿠키 대신 `token` 반환 (agent 전용). 응답에 `user_info.user_id` 추가
- 기존 경로·응답 형태 유지. 인증 없음 → 401, 권한 없음 → 403, 입력 오류 → 400
- agent 용 `/api/admin/blocked-apps`, `/block/check`, `/block-events` 는 사용자 토큰으로 호출하며 query/body 의 `user_id` 는 무시

## 4. 테스트

| 종류 | 명령 | 내용 |
|---|---|---|
| 단위 | `npm test` | 토큰 해시 저장, 만료/폐기, bcrypt/평문 자동 변환, 미들웨어 401/403, migration 비파괴성 |
| E2E (테스트 DB) | `tests/e2e/seed_phase1_test.sql` → `npm run hash-passwords` → `npm start` → `node tests/e2e/phase1.e2e.mjs` | 72개 시나리오 (격리, 위조, 관리자, agent, 로그아웃) |
| 수동 | 아래 체크리스트 | 실제 Windows agent / 브라우저 |

수동 체크리스트
- [ ] 기존 계정이 기존 비밀번호로 웹 로그인 → 대시보드 차트/달력/점수 정상
- [ ] 다른 브라우저(시크릿 창)에서 다른 계정 로그인 → "현재 띄워둔 앱"에 서로의 창 제목이 보이지 않음
- [ ] 대시보드 ⏸ 정지 → 내 agent 만 `[정지 중]`, 다른 사용자 agent 는 계속 전송
- [ ] `python tracker.py --login` → `python tracker.py` → `✅ [전송 성공]`
- [ ] 관리자 페이지: `admin/admin` 등 틀린 비밀번호로 진입 불가, `create-admin` 으로 만든 비밀번호로 진입
- [ ] 관리자 사용자 목록의 집중/딴짓 시간이 대시보드 값과 일치 (차단 앱이 있는 사용자 포함)
- [ ] 차단 앱 등록 → agent 가 해당 프로세스 종료, 임시 해제 승인 동작
- [ ] DB 확인: `SELECT COUNT(*) FROM users WHERE password_hash IS NULL;` → 0

## 5. Rollback

1. 코드: `git checkout v1-final`
2. DB: `node database/migrate.js --down 001_security_upgrade` (신규 테이블/컬럼/인덱스만 제거, 1.0 데이터 유지)
3. 평문 비밀번호는 `001b` 실행 전까지 그대로 남아 있으므로 v1 로그인이 즉시 동작한다.

**비가역 단계**: `database/manual/001b_clear_plaintext_passwords.sql` (평문 제거) 은 1~2주 검증 후 수동 실행. 실행 후 rollback 하려면 백업에서 password 컬럼 복원 필요.

## 6. 알려진 한계 (다음 Phase 에서 해결)

- `lecture_keywords` 는 여전히 config.json 의 전역 설정 (→ Phase 4 사용자별 DB 규칙)
- agent 는 여전히 3초마다 HTTP 4회 (→ Phase 3 batch)
- 1.0 의 차단 프로세스 부분 문자열 매칭, unlock 승인이 프로세스 kill 경로에 미반영 (→ Phase 11)
- CSP 비활성 (inline onclick, CDN) (→ Phase 9 프론트 분리 후)
- `public/js/api.js` 의 fetch 래핑은 과도기 장치 (→ Phase 9 에서 `FF.apiFetch` 로 전환)
- `package-lock.json` 은 `npm install` 로 재생성 필요
