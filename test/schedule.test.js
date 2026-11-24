import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanSchedule, dueAt, dueSince, dispatchOf } from '../lib/schedule.js';

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

test('schedule-tick fails loudly on a schedule file that does not parse, stays quiet when it is missing', () => {
    const tick = new URL('../bin/schedule-tick.js', import.meta.url).pathname;
    const d = mkdtempSync(join(tmpdir(), 'tick-'));
    const bad = join(d, 'schedule.json');
    writeFileSync(bad, '{ "tracked": ');
    const run = (file) => spawnSync('node', [tick], { encoding: 'utf8', env: { ...process.env, SCHEDULE_FILE: file } });
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /schedule\.json does not parse/);
    const none = run(join(d, 'missing.json'));
    assert.equal(none.status, 0);
    assert.match(none.stdout, /nothing due/);
});

test('dueSince catches up a dropped slot within the window unless a run already started', () => {
    const s = { tracked: { days: null, hours: [10] }, sweep: { days: null, hours: [4, 16] } };
    const none = () => false;
    assert.deepEqual(dueSince(s, new Date('2026-11-24T12:05Z'), 6, none), ['tracked']);
    assert.deepEqual(dueSince(s, new Date('2026-11-24T17:05Z'), 6, none), ['sweep']);
    assert.deepEqual(dueSince(s, new Date('2026-11-24T12:05Z'), 6, (id, slot) => slot.toISOString() === '2026-11-24T10:00:00.000Z'), []);
    assert.deepEqual(dueSince(s, new Date('2026-11-24T17:05Z'), 6, (id) => id === 'sweep'), []);
    assert.deepEqual(dueSince(s, new Date('2026-11-24T23:05Z'), 6, none), []);
});
