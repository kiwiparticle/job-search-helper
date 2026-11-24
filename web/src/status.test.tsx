import { expect, test } from 'vitest';
import type { ActivityRun } from './data';
import { dismissRun, runsWithFailedSearchers, statusState, tokenNotice } from './status';
import type { RunSummary } from './model';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const failed = (h: number): ActivityRun => ({ id: 1, workflow: 'search', status: 'completed', conclusion: 'failure', createdAt: hoursAgo(h), updatedAt: hoursAgo(h), url: '' });

test('idle with nothing running or failed', () => {
    expect(statusState([], [], null)).toEqual({ kind: 'idle', count: 0 });
});

test('running wins over a failure', () => {
    expect(statusState([{ workflow: 'search', status: 'in_progress' }], [failed(1)], null)).toEqual({ kind: 'running', count: 1 });
});

test('a failure in the last day not yet seen', () => {
    expect(statusState([], [failed(1)], null)).toEqual({ kind: 'failed', count: 1 });
});

test('a failure seen on the Status page is idle', () => {
    expect(statusState([], [failed(1)], hoursAgo(0.5))).toEqual({ kind: 'idle', count: 0 });
});

test('a failure older than a day is idle', () => {
    expect(statusState([], [failed(25)], null)).toEqual({ kind: 'idle', count: 0 });
});

test('a finished search run with a failed searcher counts as a failure until seen', () => {
    const run = (h: number, status: string): RunSummary => ({ run: `r${h}`, finishedAt: hoursAgo(h), models: { claude: { status: 'ok' }, glm: { status } } });
    expect(statusState([], [], null, [run(1, 'failed')])).toEqual({ kind: 'failed', count: 1 });
    expect(statusState([], [], null, [run(1, 'ok'), run(25, 'failed')])).toEqual({ kind: 'idle', count: 0 });
    expect(statusState([], [failed(1)], hoursAgo(2), [run(1, 'limit')])).toEqual({ kind: 'failed', count: 2 });
    expect(statusState([], [], hoursAgo(0.5), [run(1, 'failed')])).toEqual({ kind: 'idle', count: 0 });
});

test('a run marked seen drops out of the failed searchers', () => {
    const run: RunSummary = { run: 'r1', finishedAt: hoursAgo(1), models: { glm: { status: 'failed' } } };
    dismissRun('r1');
    expect(runsWithFailedSearchers([run], 0)).toEqual([]);
    expect(statusState([], [], null, [run])).toEqual({ kind: 'idle', count: 0 });
    localStorage.clear();
});

test('tokenNotice: expired or refused is bad, 14 days or less warns, otherwise nothing', () => {
    const now = Date.parse('2026-11-24T00:00:00Z');
    expect(tokenNotice({ status: 401, expires: null }, now)?.level).toBe('bad');
    expect(tokenNotice({ status: 404, expires: null }, now)?.text).toMatch(/can't reach your repo/);
    expect(tokenNotice({ status: 200, expires: '2026-12-01T00:00:00Z' }, now)?.text).toMatch(/runs out in 7 days/);
    expect(tokenNotice({ status: 200, expires: '2026-11-25T00:00:00Z' }, now)?.text).toMatch(/runs out in 1 day\./);
    expect(tokenNotice({ status: 200, expires: '2027-06-01T00:00:00Z' }, now)).toBeNull();
    expect(tokenNotice({ status: 200, expires: null }, now)).toBeNull();
    expect(tokenNotice(undefined, now)).toBeNull();
});
