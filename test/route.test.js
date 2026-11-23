import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRoute } from '../lib/models.js';

const script = new URL('../bin/route.js', import.meta.url).pathname;
const models = {
    models: [
        { id: 'claude', label: 'Claude', runner: 'claude' },
        { id: 'codex', label: 'Codex', runner: 'codex' },
        { id: 'qwen', label: 'Qwen', runner: 'opencode', model: 'x/qwen' },
    ],
    defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'claude' } },
};
function setup(t, registry = models) {
    const root = mkdtempSync(join(tmpdir(), 'route-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data/models.json'), JSON.stringify(registry));
    const runDir = join(root, 'runs/r1');
    mkdirSync(runDir, { recursive: true });
    const go = (env = {}, ...args) => spawnSync('node', [script, runDir, ...args], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
    return { runDir, go };
}
const lines = (out) => Object.fromEntries(out.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), JSON.parse(l.slice(l.indexOf('=') + 1))]));

test('defaults route writes route.json', (t) => {
    const s = setup(t);
    const r = s.go();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), { searchers: ['claude', 'codex'], reviewers: ['claude', 'codex'] });
    assert.deepEqual(JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')), { searchers: ['claude', 'codex'], reviewer: null });
});
test('one searcher, no reviewer', (t) => {
    const s = setup(t);
    const r = s.go({ SEARCHERS: 'qwen' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), { searchers: ['qwen'], reviewers: [] });
});
test('named reviewer', (t) => {
    const s = setup(t);
    const r = s.go({ SEARCHERS: 'qwen', REVIEWER: 'claude' });
    assert.deepEqual(lines(r.stdout), { searchers: ['qwen'], reviewers: ['claude'] });
});
test('self review exits 1 and names the problem', (t) => {
    const s = setup(t);
    const r = s.go({ SEARCHERS: 'qwen', REVIEWER: 'qwen' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /route error: .*own finds/);
    assert.equal(existsSync(join(s.runDir, 'route.json')), false);
});
test('finish-push iterates route ids, not literals', () => {
    const sh = readFileSync(new URL('../bin/finish-push.sh', import.meta.url), 'utf8');
    assert.equal(sh.includes('for m in claude codex'), false);
    assert.match(sh, /route\/route\.json/);
    assert.equal(spawnSync('bash', ['-n', new URL('../bin/finish-push.sh', import.meta.url).pathname]).status, 0);
});

function local(t, ctxTokens) {
    const s = setup(t);
    const root = join(s.runDir, '../..');
    writeFileSync(join(root, 'data/models.json'), JSON.stringify({ ...models, models: [...models.models, { id: 'loc', label: 'Loc', runner: 'opencode', model: 'x/loc', ctx: ctxTokens }] }));
    mkdirSync(join(root, 'prompts'));
    writeFileSync(join(root, 'data/profile.json'), JSON.stringify({ who: 'w' }));
    writeFileSync(join(root, 'prompts/search.md'), 'p'.repeat(400));
    writeFileSync(join(root, 'instructions.md'), 'i'.repeat(400));
    const sweep = Array.from({ length: 10 }, (_, i) => ({ company: `S${i}`, pad: 'x'.repeat(200) }));
    writeFileSync(join(s.runDir, 'context.json'), JSON.stringify({ workflow: 'tracked', sweep, manualTargets: [], rotation: [] }, null, 2) + '\n');
    return s;
}
test('an over-budget local searcher gets a trimmed context-<id>.json and route.trimmed', (t) => {
    const s = local(t, 1000); // limit 600 tokens; prompt+instructions = 200; full context ~ 600+
    const r = s.go({ SEARCHERS: 'loc' });
    assert.equal(r.status, 0, r.stderr);
    const route = JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8'));
    const dropped = route.trimmed.loc.dropped;
    assert.ok(dropped > 0);
    // names, not only a count, survive route.json and readRoute
    assert.deepEqual(route.trimmed.loc.sweep, Array.from({ length: dropped }, (_, i) => `S${9 - i}`).reverse());
    assert.deepEqual(route.trimmed.loc.manualTargets, []);
    assert.deepEqual(readRoute(s.runDir).trimmed, route.trimmed);
    const c = JSON.parse(readFileSync(join(s.runDir, 'context-loc.json'), 'utf8'));
    assert.equal(c.sweep.length, 10 - dropped);
});
test('profile text counts toward the budget', (t) => {
    const s = local(t, 1000);
    const root = join(s.runDir, '../..');
    const trimmedBy = (who) => {
        writeFileSync(join(root, 'data/profile.json'), JSON.stringify({ who }));
        writeFileSync(join(root, 'prompts/search.md'), '{{PROFILE_WHO}}');
        s.go({ SEARCHERS: 'loc' });
        return JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')).trimmed?.loc?.dropped ?? 0;
    };
    assert.ok(trimmedBy('x'.repeat(400)) > trimmedBy('x'));
});
test('a context that fits is left alone', (t) => {
    const s = local(t, 100000);
    assert.equal(s.go({ SEARCHERS: 'loc' }).status, 0);
    assert.ok(!existsSync(join(s.runDir, 'context-loc.json')));
    assert.equal(JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')).trimmed, undefined);
});
test('an impossible budget exits 1 with the numbers', (t) => {
    const s = local(t, 100); // limit 60 < prompt+instructions
    const r = s.go({ SEARCHERS: 'loc' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^route error: .*loc.*\d+ tokens.*limit 60/);
});

// Runs finish-push.sh's own route_ids function from the repo root against an artifacts dir.
function routeIds(t, json, which) {
    const a = mkdtempSync(join(tmpdir(), 'fp-route-'));
    t.after(() => rmSync(a, { recursive: true, force: true }));
    if (json != null) { mkdirSync(join(a, 'route')); writeFileSync(join(a, 'route', 'route.json'), json); }
    const sh = readFileSync(new URL('../bin/finish-push.sh', import.meta.url), 'utf8');
    const fn = sh.slice(sh.indexOf('route_ids() {'), sh.indexOf('\n}\n', sh.indexOf('route_ids() {')) + 3);
    const r = spawnSync('bash', ['-c', `a=$1; ${fn}\nroute_ids "$2"`, 'x', a, which], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });
    return { ids: r.stdout.trim().split(/\s+/), stderr: r.stderr };
}
test('finish-push route_ids: no route file falls back quietly', (t) => {
    const r = routeIds(t, null, 'all');
    assert.deepEqual(r.ids, ['claude', 'codex']);
    assert.equal(r.stderr, '');
});
test('finish-push route_ids: searchers vs all', (t) => {
    const json = JSON.stringify({ searchers: ['qwen'], reviewer: 'claude', advisory: ['qwen'] });
    assert.deepEqual(routeIds(t, json, 'searchers').ids, ['qwen']);
    assert.deepEqual(routeIds(t, json, 'all').ids, ['qwen', 'claude']);
});
test('finish-push route_ids: uses the one route validator (reserved and long names refused, with a warning)', (t) => {
    for (const bad of ['{"searchers":["review"]}', `{"searchers":["${'a'.repeat(31)}"]}`, '{not json', '{"searchers":["*"]}']) {
        const r = routeIds(t, bad, 'all');
        assert.deepEqual(r.ids, ['claude', 'codex'], bad);
        assert.match(r.stderr, /route\.json/, bad);
    }
});

test('REVIEWER=none overrides a default reviewer with no reviewer', (t) => {
    const s = setup(t);
    writeFileSync(join(s.runDir, '../../data/models.json'), JSON.stringify({ ...models, defaults: { ...models.defaults, search: { searchers: ['codex'], reviewer: 'claude' } } }));
    assert.deepEqual(lines(s.go().stdout), { searchers: ['codex'], reviewers: ['claude'] });
    const r = s.go({ REVIEWER: 'none' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), { searchers: ['codex'], reviewers: [] });
    assert.equal(JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')).reviewer, 'none');
});
test('REVIEWER=none with two searchers: no reviewers', (t) => {
    const s = setup(t);
    const r = s.go({ REVIEWER: 'none' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout).reviewers, []);
    assert.equal(JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')).reviewer, 'none');
});
test('REVIEWER=each: each searcher reviews the other', (t) => {
    const s = setup(t);
    writeFileSync(join(s.runDir, '../../data/models.json'), JSON.stringify({ ...models, defaults: { ...models.defaults, search: { searchers: ['claude', 'codex'], reviewer: 'none' } } }));
    assert.deepEqual(lines(s.go().stdout).reviewers, []);
    const r = s.go({ REVIEWER: 'each', SEARCHERS: 'claude,codex' });
    assert.deepEqual(lines(r.stdout).reviewers, ['claude', 'codex']);
    assert.equal(JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')).reviewer, null);
});
test('"none" cannot be a registry id', async () => {
    const { loadModels } = await import('../lib/models.js');
    const root = mkdtempSync(join(tmpdir(), 'route-none-'));
    try {
        mkdirSync(join(root, 'data'));
        writeFileSync(join(root, 'data/models.json'), JSON.stringify({ ...models, models: [...models.models, { id: 'none', label: 'N', runner: 'claude' }] }));
        assert.equal(loadModels(root).models.some((m) => m.id === 'none'), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

const withSearches = { ...models, defaults: { ...models.defaults, searches: { culture: { searchers: ['claude'], reviewer: 'none' } } } };
test('WORKFLOW picks that workflow\'s default route', (t) => {
    const s = setup(t, withSearches);
    const r = s.go({ WORKFLOW: 'culture' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), { searchers: ['claude'], reviewers: [] });
    assert.deepEqual(JSON.parse(readFileSync(join(s.runDir, 'route.json'), 'utf8')), { searchers: ['claude'], reviewer: 'none' });
});
test('WORKFLOW with no entry uses defaults.search', (t) => {
    const s = setup(t, withSearches);
    const r = s.go({ WORKFLOW: 'daily' });
    assert.deepEqual(lines(r.stdout), { searchers: ['claude', 'codex'], reviewers: ['claude', 'codex'] });
    assert.deepEqual(lines(setup(t, withSearches).go().stdout), { searchers: ['claude', 'codex'], reviewers: ['claude', 'codex'] });
});
test('search.yml route step passes the workflow', () => {
    const wf = readFileSync(new URL('../.github/workflows/search.yml', import.meta.url), 'utf8');
    const step = wf.split('      - id: route\n')[1].split('        run: |')[0];
    assert.ok(step.includes('          WORKFLOW: ${{ steps.s.outputs.workflow }}\n'));
});
