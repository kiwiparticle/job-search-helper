import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSchedule, dueAt, dispatchOf } from '../lib/schedule.js';

test('dueAt matches day and hour in UTC', () => {
    const s = { tracked: { days: null, hours: [10] }, daily: { days: [1, 3, 5], hours: [11] } };
    assert.deepEqual(dueAt(s, new Date('2026-11-23T10:05Z')), ['tracked']);
    assert.deepEqual(dueAt(s, new Date('2026-11-23T11:05Z')), ['daily']);
    assert.deepEqual(dueAt(s, new Date('2026-11-24T11:05Z')), []);
});

test('a tick fired at 10:05 but run at 11:02 still dispatches the 10:00 run', () => {
    const s = { tracked: { days: null, hours: [10] }, daily: { days: [1], hours: [11] } };
    const firedAt = new Date('2026-11-23T10:05Z');
    assert.deepEqual(dueAt(s, firedAt), ['tracked']);
});

test('cleanSchedule drops unknown ids and bad entries', () => {
    const sweep = { days: null, hours: [4, 16] };
    assert.deepEqual(cleanSchedule({ bogus: { days: null, hours: [1] }, sweep, tune: 'x' }), { sweep });
    assert.deepEqual(cleanSchedule(null), {});
    assert.deepEqual(cleanSchedule({ sweep: { days: [9], hours: [4] }, tune: { days: null, hours: [25] } }), {});
    assert.deepEqual(cleanSchedule({ triage: { days: null, hours: [4] } }), {});
});

test('dispatchOf maps ids to workflow files', () => {
    assert.deepEqual(dispatchOf('culture'), { file: 'search.yml', inputs: { workflow: 'culture' } });
    assert.deepEqual(dispatchOf('resolve'), { file: 'resolve-links.yml', inputs: {} });
    assert.deepEqual(dispatchOf('check-postings'), { file: 'check-postings.yml', inputs: {} });
});
