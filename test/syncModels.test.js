import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncRegistry } from '../lib/syncModels.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = (ctx, alias = 'qwen-3.6-35b') => ({ [alias]: { model: 'x.gguf', args: ['-a', alias, ...(ctx ? ['--ctx-size', String(ctx)] : [])] } });
const base = () => ({
    models: [
        { id: 'claude', label: 'Claude', runner: 'claude' },
        { id: 'codex', label: 'Codex', runner: 'codex' },
        { id: 'or', label: 'OR', runner: 'opencode', model: 'openrouter/x' },
        { id: 'zai', label: 'Z', runner: 'opencode', model: 'zai-coding-plan/glm' },
        { id: 'agy', label: 'Agy', runner: 'agy' },
    ],
    defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'claude' } },
});

test('new alias is added disabled with a clean id', () => {
    const { registry, changes } = syncRegistry(base(), cfg(65536));
    const e = registry.models.at(-1);
    assert.deepEqual(e, { id: 'qwen-3-6-35b', label: 'qwen-3.6-35b', runner: 'opencode', model: 'llama-local/qwen-3.6-35b', ctx: 65536, enabled: false });
    assert.equal(changes.length, 1);
    assert.deepEqual(registry.models.slice(0, 5), base().models);
    assert.deepEqual(registry.defaults, base().defaults);
});

test('alias without --ctx-size gets no ctx; -c is accepted', () => {
    assert.equal('ctx' in syncRegistry(base(), cfg(0)).registry.models.at(-1), false);
    const c = { a: { args: ['-c', '4096'] } };
    assert.equal(syncRegistry(base(), c).registry.models.at(-1).ctx, 4096);
});

test('id collision gets a numeric suffix and is reported', () => {
    const r = base();
    r.models.push({ id: 'qwen-3-6-35b', label: 'mine', runner: 'claude' });
    const { registry, changes } = syncRegistry(r, cfg(1));
    assert.equal(registry.models.at(-1).id, 'qwen-3-6-35b-2');
    assert.ok(changes.some((c) => c.includes('qwen-3-6-35b-2')));
    const long = 'a'.repeat(40);
    assert.equal(syncRegistry(base(), cfg(1, long)).registry.models.at(-1).id, 'a'.repeat(30));
    assert.equal(syncRegistry(base(), cfg(1, 'Both')).registry.models.at(-1).id, 'both-2');
    assert.equal(syncRegistry(base(), cfg(1, 'each')).registry.models.at(-1).id, 'each-2');
});

test('existing entry: only ctx refreshes; owner edits survive; unset ctx kept', () => {
    const r = base();
    r.models.push({ id: 'q', label: 'My Q', runner: 'opencode', model: 'llama-local/qwen-3.6-35b', ctx: 65536, enabled: true });
    const { registry, changes } = syncRegistry(r, cfg(98304));
    assert.deepEqual(registry.models.at(-1), { id: 'q', label: 'My Q', runner: 'opencode', model: 'llama-local/qwen-3.6-35b', ctx: 98304, enabled: true });
    assert.equal(changes.length, 1);
    assert.equal(syncRegistry(r, cfg(0)).registry.models.at(-1).ctx, 65536);
    assert.equal(r.models.at(-1).ctx, 65536, 'input not mutated');
});

test('vanished alias is disabled and missing, never deleted; return clears missing only', () => {
    const r = base();
    r.models.push({ id: 'q', label: 'Q', runner: 'opencode', model: 'llama-local/gone', enabled: true });
    const gone = syncRegistry(r, cfg(1));
    const e = gone.registry.models.find((m) => m.id === 'q');
    assert.equal(e.enabled, false);
    assert.equal(e.missing, true);
    assert.equal(gone.registry.models.length, 7);
    const back = syncRegistry(gone.registry, cfg(5, 'gone'));
    const b = back.registry.models.find((m) => m.id === 'q');
    assert.equal(b.enabled, false);
    assert.equal('missing' in b, false);
    assert.equal(b.ctx, 5);
});

test('idempotent', () => {
    const once = syncRegistry(base(), { ...cfg(65536), ...cfg(8, 'other') });
    assert.ok(once.changes.length);
    const twice = syncRegistry(once.registry, { ...cfg(65536), ...cfg(8, 'other') });
    assert.deepEqual(twice.changes, []);
    assert.deepEqual(twice.registry, once.registry);
    const v = syncRegistry(once.registry, {});
    assert.deepEqual(syncRegistry(v.registry, {}).changes, []);
});

function repo(configs) {
    const dir = mkdtempSync(join(tmpdir(), 'sync-'));
    for (const d of ['bin', 'lib', 'data']) mkdirSync(join(dir, d));
    cpSync(join(root, 'bin/sync-models.js'), join(dir, 'bin/sync-models.js'));
    cpSync(join(root, 'lib/syncModels.js'), join(dir, 'lib/syncModels.js'));
    cpSync(join(root, 'lib/models.js'), join(dir, 'lib/models.js'));
    cpSync(join(root, 'lib/modelsText.js'), join(dir, 'lib/modelsText.js'));
    // A fixed seed, not the live registry: the live one gains llama-local entries once the owner syncs.
    writeFileSync(join(dir, 'data/models.json'), '{\n  "models": [\n    { "id": "claude", "label": "Claude", "runner": "claude" },\n    { "id": "codex", "label": "Codex", "runner": "codex" }\n  ],\n  "defaults": {\n    "search": { "searchers": ["claude"], "reviewer": "none" }\n  }\n}\n');
    const src = join(dir, 'src.json');
    if (configs !== undefined) writeFileSync(src, typeof configs === 'string' ? configs : JSON.stringify(configs));
    return { dir, src, file: join(dir, 'data/models.json') };
}
const run = (r, ...args) => spawnSync('node', [join(r.dir, 'bin/sync-models.js'), '--source', r.src, ...args], { encoding: 'utf8' });

test('CLI: --dry-run prints changes and leaves the file byte-identical', () => {
    const r = repo(cfg(65536));
    const before = readFileSync(r.file);
    const out = run(r, '--dry-run');
    assert.equal(out.status, 0);
    assert.match(out.stdout, /qwen-3-6-35b/);
    assert.ok(readFileSync(r.file).equals(before));
});

test('CLI: writes once, second run writes nothing, file stays loadable and compact', () => {
    const r = repo(cfg(65536));
    assert.equal(run(r).status, 0);
    const after = readFileSync(r.file, 'utf8');
    assert.ok(after.endsWith('\n'));
    assert.equal(JSON.parse(after).models.at(-1).model, 'llama-local/qwen-3.6-35b');
    assert.match(after, /\{ "id": "claude", "label": "Claude", "runner": "claude" \}/);
    const second = run(r);
    assert.equal(second.status, 0);
    assert.equal(second.stdout.trim(), '');
    assert.equal(readFileSync(r.file, 'utf8'), after);
});

test('CLI: env MODEL_CONFIGS works and flag wins; bad sources exit non-zero', () => {
    const r = repo(cfg(1));
    const env = spawnSync('node', [join(r.dir, 'bin/sync-models.js'), '--dry-run'], { encoding: 'utf8', env: { ...process.env, MODEL_CONFIGS: r.src } });
    assert.equal(env.status, 0);
    const flag = spawnSync('node', [join(r.dir, 'bin/sync-models.js'), '--dry-run', '--source', r.src], { encoding: 'utf8', env: { ...process.env, MODEL_CONFIGS: '/nope' } });
    assert.equal(flag.status, 0);
    for (const bad of [undefined, 'not json', '[1]']) {
        const b = run(repo(bad), '--dry-run');
        assert.notEqual(b.status, 0);
        assert.ok(b.stderr.length > 0);
    }
});

test('CLI: --source without a value or an unknown flag is a usage error and writes nothing', () => {
    const r = repo(cfg(65536));
    const before = readFileSync(r.file);
    for (const args of [['--source'], ['--source', ''], ['--source', '--dry-run'], ['--sorce', r.src], ['--source', r.src, '--dryrun'], ['stray']]) {
        const out = spawnSync('node', [join(r.dir, 'bin/sync-models.js'), ...args], { encoding: 'utf8', env: { ...process.env, MODEL_CONFIGS: r.src } });
        assert.equal(out.status, 2, args.join(' '));
        assert.match(out.stderr, /usage/, args.join(' '));
        assert.ok(readFileSync(r.file).equals(before), args.join(' '));
    }
});
