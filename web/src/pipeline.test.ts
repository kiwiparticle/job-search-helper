import { expect, test } from 'vitest';
import type { Application } from './model';
import { kitStatus, needsFollowUp } from './pipeline';

const app = (a: Partial<Application> = {}): Application => ({ id: 'a1', role: 'R', appliedOn: '2026-11-14', outcome: 'applied', ...a });
const today = '2026-11-21';

test('needsFollowUp: 7 days since applying with no next step', () => {
    expect(needsFollowUp(app(), today)).toBe(true);
    expect(needsFollowUp(app({ appliedOn: '2026-11-19' }), today)).toBe(false);
});

test('needsFollowUp: a next-step date wins over the age', () => {
    expect(needsFollowUp(app({ stageOn: '2026-11-01', next: { text: 'Call', on: '2026-11-24' } }), today)).toBe(false);
    expect(needsFollowUp(app({ appliedOn: '2026-11-20', next: { text: 'Call', on: '2026-11-21' } }), today)).toBe(true);
});

test('needsFollowUp: never for a closed application', () => {
    expect(needsFollowUp(app({ outcome: 'rejected' }), today)).toBe(false);
});

const kits = [{ name: 'acme-senior', meta: { postingId: 'p1' } }];
const run = { workflow: 'kit', title: 'kit Acme | Senior Engineer', status: 'in_progress' };
test('kitStatus: an active kit run is drafting, and wins over an older kit', () => {
    expect(kitStatus('Acme', 'Senior Engineer', 'p1', [], [run])).toEqual({ state: 'drafting' });
    expect(kitStatus('Acme', 'Senior Engineer', 'p1', kits, [run])).toEqual({ state: 'drafting' });
});
test('kitStatus: a run for a longer role title does not match', () => {
    expect(kitStatus('Acme', 'Senior Engineer', 'p2', [], [{ ...run, title: 'kit Acme | Senior Engineer II' }])).toEqual({ state: 'missing' });
});
test('kitStatus: no run or kit yet reads drafting for 3 minutes after the start, then missing', () => {
    const now = Date.parse('2026-11-23T10:00:00Z');
    expect(kitStatus('Acme', 'Senior Engineer', 'p1', [], [], '2026-11-23T09:58:00Z', now)).toEqual({ state: 'drafting' });
    expect(kitStatus('Acme', 'Senior Engineer', 'p1', [], [], '2026-11-23T09:56:00Z', now)).toEqual({ state: 'missing' });
});
test('kitStatus: a kit for the posting is ready; nothing is missing', () => {
    expect(kitStatus('Acme', 'Senior Engineer', 'p1', kits, [])).toEqual({ state: 'ready', kit: 'acme-senior' });
    expect(kitStatus('Acme', 'Senior Engineer', 'p2', kits, [{ ...run, title: 'kit Other | Senior Engineer' }])).toEqual({ state: 'missing' });
});
