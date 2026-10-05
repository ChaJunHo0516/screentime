// PHASE 2 — Focus Session E2E
// 사용법: Phase 1 과 동일한 테스트 DB/시드(seed_phase1_test.sql + npm run hash-passwords) 후 서버 실행 → node tests/e2e/phase2.e2e.mjs
// ⚠️ 운영 DB 에서 실행 금지 — 테스트 계정의 세션을 생성/종료한다.
const B = process.env.E2E_BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, extra); } }
async function call(path, { method = 'GET', body, cookie } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}
async function login(user_id, password) {
    const r = await call('/api/auth/login', { method: 'POST', body: { user_id, password } });
    return r.setCookie.find(c => c.startsWith('ff_session=')).split(';')[0];
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const S = '/api/v2/sessions';

const jy = await login('jy16', '1234');
const inha = await login('inha', 'inhapw');

// 이전 테스트 실행에서 남은 진행 중 세션 정리
for (const c of [jy, inha]) {
    const cur = (await call(`${S}/current`, { cookie: c })).json?.data?.session;
    if (cur) await call(`${S}/${cur.id}/end`, { method: 'POST', cookie: c, body: { cancel: true } });
}

console.log('[1] 인증');
check('비로그인 current → 401', (await call(`${S}/current`)).status === 401);
check('비로그인 생성 → 401', (await call(S, { method: 'POST', body: { goal: 'x', plannedMinutes: 10 } })).status === 401);

console.log('[2] 생성 → 시작 → 진행 → 종료(달성)');
check('세션 없음 → session:null', (await call(`${S}/current`, { cookie: jy })).json.data.session === null);
const c1 = await call(S, { method: 'POST', cookie: jy, body: { goal: '머신러닝 강의 2개 듣기', plannedMinutes: 60, keywords: ['머신러닝', 'ML', 'ml', 'scikit-learn'] } });
const s1 = c1.json.data.session;
check('생성 201 + PLANNED', c1.status === 201 && s1.status === 'PLANNED');
check('키워드 저장(대소문자 중복 제거)', JSON.stringify(s1.keywords) === JSON.stringify(['머신러닝', 'ML', 'scikit-learn']), JSON.stringify(s1.keywords));
check('PLANNED 남은 시간 = 계획 전체', s1.remainingSeconds === 3600 && s1.startedAt === null);
check('current = 방금 만든 세션', (await call(`${S}/current`, { cookie: jy })).json.data.session.id === s1.id);
check('동시 세션 생성 → 409', (await call(S, { method: 'POST', cookie: jy, body: { goal: '두번째', plannedMinutes: 30 } })).status === 409);
check('PLANNED 를 바로 완료 → 409', (await call(`${S}/${s1.id}/end`, { method: 'POST', cookie: jy, body: { goalCompleted: true } })).status === 409);

const st = await call(`${S}/${s1.id}/start`, { method: 'POST', cookie: jy });
check('시작 → ACTIVE + startedAt', st.status === 200 && st.json.data.session.status === 'ACTIVE' && !!st.json.data.session.startedAt);
check('중복 시작 → 409 INVALID_SESSION_STATE', (await call(`${S}/${s1.id}/start`, { method: 'POST', cookie: jy })).json?.error?.code === 'INVALID_SESSION_STATE');
await sleep(2200);
const cur = (await call(`${S}/current`, { cookie: jy })).json.data.session;
check('시간 경과 반영 (남은 시간 감소)', cur.elapsedSeconds >= 2 && cur.remainingSeconds <= 3598, `${cur.elapsedSeconds}/${cur.remainingSeconds}`);

console.log('[3] 사용자 격리');
check('inha 의 current 에는 안 보임', (await call(`${S}/current`, { cookie: inha })).json.data.session === null);
const foreign = await call(`${S}/${s1.id}/end`, { method: 'POST', cookie: inha, body: { cancel: true } });
check('타인 세션 종료 시도 → 404 (존재 노출 X)', foreign.status === 404 && foreign.json.error.code === 'SESSION_NOT_FOUND');
check('타인 세션 시작 시도 → 404', (await call(`${S}/${s1.id}/start`, { method: 'POST', cookie: inha })).status === 404);
check('jy 세션은 그대로 ACTIVE', (await call(`${S}/current`, { cookie: jy })).json.data.session.status === 'ACTIVE');
check('inha 는 독립적으로 세션 생성 가능', (await call(S, { method: 'POST', cookie: inha, body: { goal: '인하 목표', plannedMinutes: 25 } })).status === 201);

console.log('[4] 입력 검증');
check('end body 없음 → 400', (await call(`${S}/${s1.id}/end`, { method: 'POST', cookie: jy, body: {} })).status === 400);
check('잘못된 id → 404', (await call(`${S}/abc/start`, { method: 'POST', cookie: jy })).status === 404);
check('없는 id → 404', (await call(`${S}/99999999/start`, { method: 'POST', cookie: jy })).status === 404);
const inhaCur = (await call(`${S}/current`, { cookie: inha })).json.data.session;
await call(`${S}/${inhaCur.id}/end`, { method: 'POST', cookie: inha, body: { cancel: true } });
check('목표 없음 → 400', (await call(S, { method: 'POST', cookie: inha, body: { plannedMinutes: 30 } })).status === 400);
check('계획 0분 → 400', (await call(S, { method: 'POST', cookie: inha, body: { goal: 'x', plannedMinutes: 0 } })).status === 400);
check('키워드 21개 → 400', (await call(S, { method: 'POST', cookie: inha, body: { goal: 'x', plannedMinutes: 30, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) } })).status === 400);
check('검증 실패 시 세션이 만들어지지 않음', (await call(`${S}/current`, { cookie: inha })).json.data.session === null);

console.log('[5] 종료');
const done = await call(`${S}/${s1.id}/end`, { method: 'POST', cookie: jy, body: { goalCompleted: true } });
const d = done.json.data.session;
check('종료 → COMPLETED + goalCompleted=true + endedAt', d.status === 'COMPLETED' && d.goalCompleted === true && !!d.endedAt && d.remainingSeconds === 0);
check('종료 후 current = null', (await call(`${S}/current`, { cookie: jy })).json.data.session === null);
check('종료된 세션 취소 → 409', (await call(`${S}/${s1.id}/end`, { method: 'POST', cookie: jy, body: { cancel: true } })).status === 409);

console.log('[6] 취소 (PLANNED / ACTIVE)');
const p2 = (await call(S, { method: 'POST', cookie: jy, body: { goal: '취소 테스트', plannedMinutes: 10 } })).json.data.session;
const cx = await call(`${S}/${p2.id}/end`, { method: 'POST', cookie: jy, body: { cancel: true } });
check('PLANNED 취소 → CANCELLED', cx.json.data.session.status === 'CANCELLED');
const p3 = (await call(S, { method: 'POST', cookie: jy, body: { goal: '미달성 테스트', plannedMinutes: 10 } })).json.data.session;
await call(`${S}/${p3.id}/start`, { method: 'POST', cookie: jy });
const nd = await call(`${S}/${p3.id}/end`, { method: 'POST', cookie: jy, body: { goalCompleted: false } });
check('ACTIVE 미달성 종료 → goalCompleted=false', nd.json.data.session.status === 'COMPLETED' && nd.json.data.session.goalCompleted === false);

console.log('[7] 기존 기능 회귀');
check('기존 tracking 상태 API 정상', typeof (await call('/api/tracking/status', { cookie: jy })).json.active === 'boolean');
check('기존 대시보드 API 정상', (await call('/api/logs/dashboard/jy16', { cookie: jy })).json.success === true);

console.log(`\nPhase 2 E2E: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
