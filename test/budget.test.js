import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { estimateTokens, limitTokens } from '../lib/budget.js';

test('estimateTokens is length / 4 rounded up', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
});
test('limitTokens is 60% of ctx', () => assert.equal(limitTokens(64000), 38400));

import { trimContext, capItems } from '../lib/budget.js';
const big = { workflow: 'tracked', sweep: [{ company: 'S1' }, { company: 'S2' }], manualTargets: [{ company: 'A' }, { company: 'B' }], rotation: ['A', 'B'] };
test('trimContext drops sweep before manualTargets and keeps rotation consistent', () => {
    const snap = JSON.stringify(big);
    const a = trimContext(big, (c) => c.sweep.length <= 1);
    assert.equal(a.dropped, 1);
    assert.deepEqual(a.context.sweep, [{ company: 'S1' }]);
    assert.equal(a.context.manualTargets.length, 2);
    const b = trimContext(big, (c) => c.sweep.length === 0 && c.manualTargets.length <= 1);
    assert.equal(b.dropped, 3);
    assert.deepEqual(b.context.manualTargets, [{ company: 'A' }]);
    assert.deepEqual(b.context.rotation, ['A']);
    assert.equal(JSON.stringify(big), snap);
});
test('trimContext returns null when nothing fits', () => assert.equal(trimContext(big, () => false), null));
test('capItems keeps a prefix and never exceeds the budget', () => {
    const items = [{ a: 'x'.repeat(40) }, { a: 'y'.repeat(40) }, { a: 'z'.repeat(40) }];
    const one = estimateTokens(JSON.stringify(items.slice(0, 1), null, 2));
    const kept = capItems(items, one + 5);
    assert.deepEqual(kept, items.slice(0, 1));
    assert.ok(estimateTokens(JSON.stringify(kept, null, 2)) <= one + 5);
    assert.deepEqual(capItems(items, 3), []);
    assert.equal(capItems(items, 1e6).length, 3);
});

// bin/review-input.js in a scratch repo: a small-context reviewer gets only what fits, and says so on stderr.
function reviewInputRun(t, ctx, finds, profile = { who: 'w' }) {
    const root = mkdtempSync(join(tmpdir(), 'rvin-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'data')); mkdirSync(join(root, 'prompts'));
    writeFileSync(join(root, 'data/models.json'), JSON.stringify({ models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'loc', label: 'Loc', runner: 'opencode', model: 'x/loc', ctx }], defaults: { search: { searchers: ['claude'], reviewer: 'loc' }, ask: { model: 'claude' }, fill: { model: 'claude' } } }));
    writeFileSync(join(root, 'data/profile.json'), JSON.stringify(profile));
    writeFileSync(join(root, 'prompts/review.md'), '{{PROFILE_WHO}}' + 'p'.repeat(400));
    writeFileSync(join(root, 'instructions.md'), 'i'.repeat(400));
    const run = join(root, 'run');
    mkdirSync(join(run, 'claude'), { recursive: true });
    writeFileSync(join(run, 'route.json'), JSON.stringify({ searchers: ['claude'], reviewer: 'loc', advisory: [] }));
    writeFileSync(join(run, 'claude/status.txt'), 'ok');
    writeFileSync(join(run, 'claude/candidates.json'), JSON.stringify(Array.from({ length: finds }, (_, i) => ({ company: `Co${i}`, role: 'Staff', verdict: 'Worth interviewing', note: 'n'.repeat(200) }))));
    return spawnSync(process.execPath, [new URL('../bin/review-input.js', import.meta.url).pathname, run, 'loc', join(root, 'in.json')], { cwd: root, encoding: 'utf8' });
}
test('review-input warns how many finds were left out to fit the reviewer', (t) => {
    const r = reviewInputRun(t, 1000, 5);
    const kept = Number(r.stdout.trim());
    assert.ok(kept < 5);
    assert.match(r.stderr, new RegExp(`${5 - kept} of 5 finds left out of review`));
});
test('review-input warns when prompt and instructions alone leave no room', (t) => {
    const r = reviewInputRun(t, 300, 2);
    assert.equal(r.stdout.trim(), '0');
    assert.match(r.stderr, /2 of 2 finds left out of review/);
    assert.match(r.stderr, /no room/);
});
test('review-input counts the filled profile text against the reviewer', (t) => {
    const r = reviewInputRun(t, 1000, 5, { who: 'w'.repeat(1200) });
    assert.ok(Number(r.stdout.trim()) < Number(reviewInputRun(t, 1000, 5).stdout.trim()));
});
test('review-input is quiet when everything fits', (t) => {
    const r = reviewInputRun(t, 100000, 2);
    assert.equal(r.stdout.trim(), '2');
    assert.equal(r.stderr, '');
});
