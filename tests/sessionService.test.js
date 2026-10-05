'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateCreateInput, validateEndInput, parseSessionId, toSessionDto
} = require('../services/sessionService');

const status400 = (fn) => { try { fn(); return null; } catch (e) { return e.status; } };

test('validateCreateInput: 정상 입력 정규화 (trim, 키워드 중복 제거, 쉼표 문자열 허용)', () => {
    const v = validateCreateInput({ goal: '  머신러닝 강의 2개 듣기 ', plannedMinutes: 60, keywords: 'ML, 머신러닝, ml , ,scikit-learn' });
    assert.deepEqual(v, { goal: '머신러닝 강의 2개 듣기', plannedMinutes: 60, keywords: ['ML', '머신러닝', 'scikit-learn'] });
    assert.deepEqual(validateCreateInput({ goal: 'x', plannedMinutes: 1 }).keywords, []);
});

test('validateCreateInput: 잘못된 입력 → 400', () => {
    assert.equal(status400(() => validateCreateInput({})), 400);
    assert.equal(status400(() => validateCreateInput({ goal: '   ', plannedMinutes: 60 })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'a'.repeat(201), plannedMinutes: 60 })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: '<script>', plannedMinutes: 60 })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 0 })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 481 })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 12.5 })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: '60' })), null, '숫자 문자열은 허용');
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 60, keywords: [1] })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 60, keywords: { a: 1 } })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 60, keywords: ['a'.repeat(51)] })), 400);
    assert.equal(status400(() => validateCreateInput({ goal: 'x', plannedMinutes: 60, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })), 400);
});

test('validateEndInput', () => {
    assert.deepEqual(validateEndInput({ cancel: true }), { cancel: true });
    assert.deepEqual(validateEndInput({ goalCompleted: false }), { cancel: false, goalCompleted: false });
    assert.equal(status400(() => validateEndInput({})), 400);
    assert.equal(status400(() => validateEndInput({ goalCompleted: 'yes' })), 400);
});

test('parseSessionId: 양의 정수 문자열만 허용', () => {
    assert.equal(parseSessionId('42'), 42);
    for (const bad of ['0', '-1', '1.5', 'abc', '1e3', '01', '', '9007199254740993']) assert.equal(parseSessionId(bad), null, bad);
});

test('toSessionDto: 상태별 남은 시간 계산', () => {
    const base = { session_id: 7, goal: 'g', planned_minutes: 60, goal_completed: null, created_at: '2026-10-05 10:00:00' };
    const planned = toSessionDto({ ...base, status: 'PLANNED', elapsed_seconds: 0 }, ['k']);
    assert.equal(planned.remainingSeconds, 3600);
    assert.equal(planned.elapsedSeconds, 0);
    assert.deepEqual(planned.keywords, ['k']);

    const active = toSessionDto({ ...base, status: 'ACTIVE', elapsed_seconds: 600, started_at: '2026-10-05 10:00:00' });
    assert.equal(active.remainingSeconds, 3000);
    assert.equal(active.overtime, false);

    const over = toSessionDto({ ...base, status: 'ACTIVE', elapsed_seconds: 4000 });
    assert.equal(over.remainingSeconds, 0);
    assert.equal(over.overtime, true);

    const done = toSessionDto({ ...base, status: 'COMPLETED', elapsed_seconds: 3500, goal_completed: 1 });
    assert.equal(done.remainingSeconds, 0);
    assert.equal(done.goalCompleted, true);
    assert.equal(toSessionDto({ ...base, status: 'COMPLETED', goal_completed: 0 }).goalCompleted, false);
});
