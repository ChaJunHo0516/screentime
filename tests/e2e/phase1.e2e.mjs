// 사용법: (1) 테스트 DB에 seed_phase1_test.sql 적용 (2) npm run hash-passwords (3) 서버 실행 (4) node tests/e2e/phase1.e2e.mjs
// ⚠️ 운영 DB 에서 실행 금지 — 테스트 계정/로그/차단앱을 생성·수정한다.
const B = process.env.E2E_BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, extra); } }
async function call(path, { method = 'GET', body, cookie, bearer } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const res = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}
const cookieOf = (r, name) => { const c = r.setCookie.find(x => x.startsWith(name + '=')); return c ? c.split(';')[0] : null; };

console.log('[1] 비로그인 차단');
for (const [m, p] of [['GET','/api/logs/latest'],['GET','/api/logs/dashboard/jy16'],['POST','/api/logs'],['GET','/api/tracking/status'],['POST','/api/tracking/stop'],['GET','/api/admin/users'],['GET','/api/admin/block-events'],['GET','/api/admin/users/inha/summary'],['POST','/api/admin/blocked-apps'],['GET','/api/config/keywords'],['POST','/api/ai/nudge'],['POST','/api/reward/generate-quiz'],['GET','/api/ranking/top10']]) {
    const r = await call(p, { method: m, body: m === 'POST' ? {} : undefined });
    check(`${m} ${p} → 401`, r.status === 401, `got ${r.status}`);
}
check('에러 형식 통일 {success:false, error.code}', (await call('/api/logs/latest')).json?.error?.code === 'AUTH_REQUIRED');
check('없는 API → 404 JSON', (await call('/api/nope')).json?.error?.code === 'NOT_FOUND');

console.log('[2] 로그인 (1.0 계정, 해시 마이그레이션 후)');
const bad = await call('/api/auth/login', { method: 'POST', body: { user_id: 'jy16', password: 'wrong' } });
check('틀린 비밀번호 → 401', bad.status === 401 && bad.json.message.includes('일치하지'));
const lj = await call('/api/auth/login', { method: 'POST', body: { user_id: 'JY16', password: '1234' } });
const jyCookie = cookieOf(lj, 'ff_session');
check('기존 비밀번호로 로그인 성공 + 정규화 ID', lj.status === 200 && lj.json.user_info.user_id === 'jy16' && lj.json.user_info.username === '준영');
check('HttpOnly SameSite 쿠키 발급, body에 토큰 없음', /HttpOnly/.test(lj.setCookie.join()) && /SameSite=Lax/.test(lj.setCookie.join()) && !lj.json.token);
const li = await call('/api/auth/login', { method: 'POST', body: { user_id: 'inha', password: 'inhapw' } });
const inhaCookie = cookieOf(li, 'ff_session');
check('/api/auth/me', (await call('/api/auth/me', { cookie: jyCookie })).json.user_info.user_id === 'jy16');

console.log('[3] 사용자 격리');
check('latest: 본인 로그만 (inha 창 제목 노출 안 됨)', (await call('/api/logs/latest', { cookie: jyCookie })).json.data.app_name !== '인하의 비밀 창 제목');
check('inha latest 는 inha 것', (await call('/api/logs/latest', { cookie: inhaCookie })).json.data.app_name === '인하의 비밀 창 제목');
check('dashboard/inha by jy16 → 403', (await call('/api/logs/dashboard/inha', { cookie: jyCookie })).status === 403);
check('calendar/inha by jy16 → 403', (await call('/api/logs/calendar/inha', { cookie: jyCookie })).status === 403);
check('hourly/inha by jy16 → 403', (await call('/api/logs/hourly/inha?hours=2', { cookie: jyCookie })).status === 403);
const dash = await call('/api/logs/dashboard/jy16', { cookie: jyCookie });
check('dashboard/jy16 by jy16 → 200 기존 형태 유지', dash.status === 200 && 'score' in dash.json && Array.isArray(dash.json.pieData) && dash.json.barData.labels.length === 5, JSON.stringify(dash.json));
check('calendar 파라미터화 동작', (await call('/api/logs/calendar/jy16?days=30', { cookie: jyCookie })).json.success === true);
check('hourly 허용값 외 → 400', (await call('/api/logs/hourly/jy16?hours=999', { cookie: jyCookie })).status === 400);
check('hourly 6h → 200', (await call('/api/logs/hourly/jy16?hours=6', { cookie: jyCookie })).json.success === true);

console.log('[4] 로그 위조 방지');
const forged = await call('/api/logs', { method: 'POST', cookie: jyCookie, body: { user_id: 'inha', app_name: 'FORGED', category: 'Lecture', dwell_seconds: 3 } });
check('body user_id=inha 로 전송 → 201', forged.status === 201);
check('→ 실제로는 jy16 으로 저장', (await call('/api/logs/latest', { cookie: jyCookie })).json.data.app_name === 'FORGED');
check('→ inha 로그는 그대로', (await call('/api/logs/latest', { cookie: inhaCookie })).json.data.app_name === '인하의 비밀 창 제목');
check('잘못된 category → 400', (await call('/api/logs', { method: 'POST', cookie: jyCookie, body: { app_name: 'x', category: 'Hack', dwell_seconds: 3 } })).status === 400);
check('dwell_seconds 9999 → 400', (await call('/api/logs', { method: 'POST', cookie: jyCookie, body: { app_name: 'x', category: 'Lecture', dwell_seconds: 9999 } })).status === 400);
check('깨진 JSON → 400 INVALID_JSON', await (async () => { const r = await fetch(B + '/api/logs', { method: 'POST', headers: { 'content-type': 'application/json', cookie: jyCookie }, body: '{bad' }); return r.status === 400; })());

console.log('[5] 사용자별 tracking 상태');
await call('/api/tracking/stop', { method: 'POST', cookie: jyCookie });
check('jy16 정지 → jy16 active=false', (await call('/api/tracking/status', { cookie: jyCookie })).json.active === false);
check('inha 는 영향 없음 active=true', (await call('/api/tracking/status', { cookie: inhaCookie })).json.active === true);
await call('/api/tracking/start', { method: 'POST', cookie: jyCookie });
check('jy16 재시작 → true', (await call('/api/tracking/status', { cookie: jyCookie })).json.active === true);

console.log('[6] 관리자');
check('일반 사용자 → /api/admin/users 403', (await call('/api/admin/users', { cookie: jyCookie })).status === 403);
check('admin/admin 아닌 잘못된 비번 → 401', (await call('/api/admin/login', { method: 'POST', body: { admin_id: 'admin', password: 'nope' } })).status === 401);
const al = await call('/api/admin/login', { method: 'POST', body: { admin_id: 'admin', password: 'admin' } });
const adminCookie = cookieOf(al, 'ff_admin');
check('관리자 로그인(해시 검증) → ff_admin 쿠키', al.status === 200 && !!adminCookie && al.json.admin.admin_id === 'admin');
const users = await call('/api/admin/users', { cookie: adminCookie });
const jy = users.json.users.find(u => u.user_id === 'jy16');
check('사용자 목록 집계 버그 수정 (차단앱 2개여도 곱해지지 않음)', Number(jy.focus_seconds) === 603 && Number(jy.distract_seconds) === 120 && Number(jy.active_block_count) === 2, JSON.stringify(jy));
check('관리자 /me', (await call('/api/admin/me', { cookie: adminCookie })).json.admin.admin_id === 'admin');
check('사용자 쿠키 → /api/admin/me 403', (await call('/api/admin/me', { cookie: jyCookie })).status === 403);
check('관리자 blocked-apps 전체 조회', (await call('/api/admin/blocked-apps', { cookie: adminCookie })).json.blocked_apps.length === 2);
check('관리자 차단 등록 created_by=토큰 관리자', (await call('/api/admin/blocked-apps', { method: 'POST', cookie: adminCookie, body: { user_id: 'inha', app_name: 'game', admin_id: 'spoofed' } })).status === 201);
check('임시해제: 비번 재확인 실패 → 403(세션 유지)', (await call('/api/admin/unlock-approvals', { method: 'POST', cookie: adminCookie, body: { user_id: 'jy16', app_name: 'steam', password: 'bad' } })).status === 403);
check('임시해제 성공', (await call('/api/admin/unlock-approvals', { method: 'POST', cookie: adminCookie, body: { user_id: 'jy16', app_name: 'steam', password: 'admin', minutes: 5 } })).json.success === true);
check('넛지 메시지 수정', (await call('/api/admin/nudge-messages/1', { method: 'PUT', cookie: adminCookie, body: { message_text: '수정됨' } })).json.success === true);
check('사용자 → 넛지 메시지 수정 403', (await call('/api/admin/nudge-messages/1', { method: 'PUT', cookie: jyCookie, body: { message_text: 'x' } })).status === 403);

console.log('[7] agent 용 엔드포인트 (Bearer)');
const ag = await call('/api/auth/login', { method: 'POST', body: { user_id: 'jy16', password: '1234', client: 'agent', device_name: 'TEST-PC' } });
check('agent 로그인 → body token, 쿠키 없음', !!ag.json.token && ag.setCookie.length === 0);
const T = ag.json.token;
const ba = await call('/api/admin/blocked-apps?user_id=inha', { bearer: T });
check('agent blocked-apps: ?user_id=inha 무시하고 본인 것만', ba.status === 200 && ba.json.blocked_apps.every(b => b.user_id === 'jy16') && ba.json.blocked_apps.length === 2);
check('agent block/check (임시해제 반영)', (await call('/api/admin/block/check?app_name=steam.exe&user_id=inha', { bearer: T })).json.approved === true);
check('agent block/check discord blocked', (await call('/api/admin/block/check?app_name=Discord%20-%20chat', { bearer: T })).json.blocked === true);
check('agent block-event 기록', (await call('/api/admin/block-events', { method: 'POST', bearer: T, body: { user_id: 'inha', app_name: 'steam', event_type: 'BLOCK_PROCESS_KILLED', reason: '<script>x</script>' } })).status === 201);
const evs = (await call('/api/admin/block-events', { cookie: adminCookie })).json.events;
const killed = evs.find(e => e.event_type === 'BLOCK_PROCESS_KILLED'); check('→ 이벤트 user_id 는 토큰 본인(jy16), created_by 위조 불가', killed.user_id === 'jy16' && killed.created_by === null && evs[0].event_type === 'BLOCK_PROCESS_KILLED'); check('→ 관리자 차단 등록 이벤트 created_by=admin (body admin_id 무시)', evs.find(e => e.event_type === 'BLOCK_APP_ADDED').created_by === 'admin');
check('agent event_type 형식 검증', (await call('/api/admin/block-events', { method: 'POST', bearer: T, body: { app_name: 'x', event_type: 'drop table' } })).status === 400);
check('agent 토큰으로 관리자 API 불가', (await call('/api/admin/users', { bearer: T })).status === 403);

console.log('[8] 랭킹 isAdmin 우회');
const rk = await call('/api/ranking/top10?isAdmin=true', { cookie: jyCookie });
const hour = new Date().getHours(), day = new Date().getDay();
check('사용자: ?isAdmin=true 무시 (공개시간 규칙 그대로)', rk.json.isLocked === !(hour >= 15 || day === 0));
check('관리자: 항상 열람', (await call('/api/ranking/top10', { cookie: adminCookie })).json.isLocked === false);

console.log('[9] 키워드 API');
check('키워드 조회(로그인)', Array.isArray((await call('/api/config/keywords', { cookie: jyCookie })).json.keywords));
check('키워드 < > 차단', (await call('/api/config/keywords', { method: 'POST', cookie: jyCookie, body: { keyword: '<img>' } })).status === 400);
check('키워드 51자 차단', (await call('/api/config/keywords', { method: 'POST', cookie: jyCookie, body: { keyword: 'a'.repeat(51) } })).status === 400);

console.log('[10] 회원가입 검증');
check('짧은 비밀번호 → 400', (await call('/api/auth/register', { method: 'POST', body: { user_id: 'newbie', password: '123', username: 'n' } })).status === 400);
check('잘못된 아이디 → 400', (await call('/api/auth/register', { method: 'POST', body: { user_id: '<x>', password: '12345678', username: 'n' } })).status === 400);
check('정상 가입 → 201', (await call('/api/auth/register', { method: 'POST', body: { user_id: 'newbie', password: 'password123', username: '뉴비' } })).status === 201);
check('중복 가입 → 409', (await call('/api/auth/register', { method: 'POST', body: { user_id: 'NEWBIE', password: 'password123', username: '뉴비' } })).status === 409);
check('신규 계정 로그인', (await call('/api/auth/login', { method: 'POST', body: { user_id: 'newbie', password: 'password123' } })).status === 200);

console.log('[11] 로그아웃 = 토큰 폐기');
const lo = await call('/api/auth/logout', { method: 'POST', cookie: inhaCookie });
check('로그아웃 → 쿠키 삭제 지시', lo.setCookie.some(c => c.startsWith('ff_session=;') && /Max-Age=0/.test(c)));
check('폐기된 쿠키 재사용 → 401', (await call('/api/logs/latest', { cookie: inhaCookie })).status === 401);
await call('/api/auth/logout', { method: 'POST', bearer: T });
check('agent 토큰 폐기 → 401', (await call('/api/auth/me', { bearer: T })).status === 401);
await call('/api/admin/logout', { method: 'POST', cookie: adminCookie });
check('관리자 로그아웃 → 401', (await call('/api/admin/users', { cookie: adminCookie })).status === 401);

console.log(`\nE2E: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
