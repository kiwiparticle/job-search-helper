import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

// Owner file: absent in the engine tree, where this test skips.
const ownerSchedule = new URL('../data/schedule.json', import.meta.url);
test('the owner file mirrors the old crons', { skip: !existsSync(ownerSchedule) }, () => {
    const s = cleanSchedule(JSON.parse(readFileSync(ownerSchedule, 'utf8')));
    assert.deepEqual(s, {
        tracked: { days: null, hours: [10] },
        daily: { days: [1, 3, 5], hours: [11] },
        vertical: { days: [2, 4], hours: [11] },
        culture: { days: [1], hours: [13] },
        reconcile: { days: [5], hours: [13] },
        sweep: { days: null, hours: [4, 16] },
        'check-postings': { days: null, hours: [6, 18] },
        resolve: { days: [0], hours: [7] },
        'find-boards': { days: [0], hours: [8] },
        tune: { days: [6], hours: [13] },
    });
});
