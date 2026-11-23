import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MODELS, loadModels, getModel, resolveRoute, reviewersOf, namedReviewer, parseRoute, readRoute } from '../lib/models.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'models-'));
const repoWith = (text) => {
    const d = tmp();
    mkdirSync(join(d, 'data'));
    writeFileSync(join(d, 'data/models.json'), text);
    return d;
};
const LEGACY = { searchers: ['claude', 'codex'], reviewer: null };

test('loadModels falls back when the file is missing', () => {
    assert.deepEqual(loadModels(tmp()), DEFAULT_MODELS);
});

test('loadModels falls back on invalid JSON', () => {
    assert.deepEqual(loadModels(repoWith('{nope')), DEFAULT_MODELS);
});

test('loadModels drops an entry with a bad id or an opencode entry without model', () => {
    const reg = loadModels(repoWith(JSON.stringify({
        models: [
            { id: 'claude', label: 'Claude', runner: 'claude' },
            { id: 'Bad Id', label: 'x', runner: 'claude' },
            { id: 'both', label: 'x', runner: 'claude' },
            { id: 'loc', label: 'x', runner: 'opencode' },
            { id: 'loc2', label: 'x', runner: 'opencode', model: 'p/m' },
        ],
        defaults: DEFAULT_MODELS.defaults,
    })));
    assert.deepEqual(reg.models.map((m) => m.id), ['claude', 'loc2']);
});

const reg = {
    models: [
        { id: 'claude', label: 'C', runner: 'claude' },
        { id: 'codex', label: 'X', runner: 'codex' },
        { id: 'off', label: 'O', runner: 'codex', enabled: false },
    ],
    defaults: DEFAULT_MODELS.defaults,
};

test('getModel finds by id', () => {
    assert.equal(getModel(reg, 'codex').runner, 'codex');
    assert.equal(getModel(reg, 'zzz'), null);
});

test('resolveRoute uses the search defaults', () => {
    assert.deepEqual(resolveRoute(reg, {}), { searchers: ['claude'], reviewer: 'none' });
});

test('route reviewer values: none, each, default none, default each', () => {
    assert.deepEqual(resolveRoute(reg, { reviewer: 'none' }), { searchers: ['claude'], reviewer: 'none' });
    assert.equal(resolveRoute(reg, { reviewer: 'each' }).reviewer, null);
    assert.doesNotThrow(() => resolveRoute(reg, { searchers: ['claude'], reviewer: 'none' }));
    const of = (reviewer) => withModels([C, X], { search: { searchers: ['claude', 'codex'], reviewer } });
    assert.equal(resolveRoute(of('none'), {}).reviewer, 'none');
    assert.equal(resolveRoute(of('each'), {}).reviewer, null);
    assert.equal(DEFAULT_MODELS.defaults.search.reviewer, 'none');
});

test('none means no reviewers; namedReviewer; parseRoute keeps none', () => {
    const r = { searchers: ['a', 'b'], reviewer: 'none' };
    assert.deepEqual(reviewersOf(r), []);
    assert.deepEqual(['c', null, 'none'].map((reviewer) => namedReviewer({ searchers: ['a'], reviewer })), ['c', null, null]);
    assert.equal(parseRoute('{"searchers":["a","b"],"reviewer":"none"}').reviewer, 'none');
});

test('resolveRoute rejects bad routes', () => {
    const bad = [
        { searchers: ['zzz'] },
        { searchers: ['off'] },
        { searchers: ['claude', 'codex', 'off'] },
        { searchers: ['claude', 'claude'] },
        { searchers: [] },
        { searchers: ['claude'], reviewer: 'claude' },
    ];
    for (const r of bad) assert.throws(() => resolveRoute(reg, r), /unknown|disabled|at most two|duplicate|at least one|own finds/i);
});

test('resolveRoute allows a reviewer that is also one of two searchers', () => {
    assert.deepEqual(
        resolveRoute(reg, { searchers: ['claude', 'codex'], reviewer: 'claude' }),
        { searchers: ['claude', 'codex'], reviewer: 'claude' },
    );
});

test('reviewersOf', () => {
    assert.deepEqual(reviewersOf({ searchers: ['a', 'b'], reviewer: 'c' }), ['c']);
    assert.deepEqual(reviewersOf({ searchers: ['a', 'b'], reviewer: null }), ['a', 'b']);
    assert.deepEqual(reviewersOf({ searchers: ['a'], reviewer: null }), []);
});

test('readRoute returns legacy for missing or invalid, and a written route unchanged', () => {
    assert.deepEqual(readRoute(tmp()), LEGACY);
    const bad = tmp();
    writeFileSync(join(bad, 'route.json'), '{nope');
    assert.deepEqual(readRoute(bad), LEGACY);
    const ok = tmp();
    const route = { searchers: ['a'], reviewer: 'b', trimmed: { a: { dropped: 3 } } };
    // An old run's `advisory` is dropped on read.
    writeFileSync(join(ok, 'route.json'), JSON.stringify({ ...route, advisory: ['a'] }));
    assert.deepEqual(readRoute(ok), route);
});

test('readRoute falls back on unsafe or malformed routes', () => {
    const bads = [
        { searchers: ['../x'], reviewer: null },
        { searchers: ['a', 'b', 'c'], reviewer: null },
        { searchers: ['a', 'a'], reviewer: null },
        { searchers: ['a'], reviewer: 5 },
        { searchers: ['both'], reviewer: null },
    ];
    for (const route of bads) {
        const d = tmp();
        writeFileSync(join(d, 'route.json'), JSON.stringify(route));
        assert.deepEqual(readRoute(d), LEGACY, JSON.stringify(route));
    }
});

test('loadModels repairs malformed or dangling defaults', () => {
    for (const defaults of [
        { search: null },
        { search: { searchers: ['gone'], reviewer: null } },
        { search: { searchers: ['claude'], reviewer: 'gone' } },
        { ask: { model: 'gone' } },
        { fill: null },
    ]) {
        const r = loadModels(repoWith(JSON.stringify({
            models: [{ id: 'claude', label: 'C', runner: 'claude' }, { id: 'codex', label: 'X', runner: 'codex' }],
            defaults,
        })));
        assert.deepEqual(r.defaults, DEFAULT_MODELS.defaults, JSON.stringify(defaults));
        assert.doesNotThrow(() => resolveRoute(r, {}));
    }
});

const withModels = (models, defaults) => loadModels(repoWith(JSON.stringify({ models, defaults })));
const C = { id: 'claude', label: 'C', runner: 'claude' };
const X = { id: 'codex', label: 'X', runner: 'codex' };
const Q = { id: 'qwen', label: 'Q', runner: 'opencode', model: 'x/q' };

test('a disabled model is not a valid default; the fallback is used', () => {
    const r = withModels([C, X, { ...Q, enabled: false }], { search: { searchers: ['qwen'], reviewer: 'claude' }, ask: { model: 'qwen' }, fill: { model: 'qwen' } });
    assert.deepEqual(r.defaults, DEFAULT_MODELS.defaults);
    assert.deepEqual(resolveRoute(r, {}), { searchers: ['claude'], reviewer: 'none' });
    const rv = withModels([C, X, { ...Q, enabled: false }], { search: { searchers: ['claude', 'codex'], reviewer: 'qwen' } });
    assert.equal(rv.defaults.search.reviewer, 'none');
});

test('when the fallback names a disabled model too, the route error names it and says to edit defaults', () => {
    const r = withModels([{ ...C, enabled: false }, X, Q], { search: { searchers: ['claude'], reviewer: null } });
    assert.throws(() => resolveRoute(r, {}), (e) => /claude/.test(e.message) && /disabled/.test(e.message) && /defaults/.test(e.message) && /data\/models\.json/.test(e.message));
    // A searcher the owner picked is not a default: the plain message stays.
    assert.throws(() => resolveRoute(r, { searchers: ['claude'] }), (e) => /disabled model: claude$/.test(e.message));
    assert.deepEqual(resolveRoute(r, { searchers: ['qwen'] }), { searchers: ['qwen'], reviewer: 'none' });
});

const FIX = JSON.parse(readFileSync(new URL('./fixtures/models-searches.json', import.meta.url), 'utf8'));
test('defaults.searches keeps only valid entries', () => {
    assert.deepEqual(loadModels(repoWith(JSON.stringify(FIX.raw))).defaults, FIX.cleaned);
});
test('defaults.searches is omitted when no entry survives', () => {
    const raw = structuredClone(FIX.raw);
    raw.defaults.searches = { links: { searchers: ['off'], reviewer: null } };
    assert.ok(!('searches' in loadModels(repoWith(JSON.stringify(raw))).defaults));
});
test('resolveRoute uses the workflow default', () => {
    const r = loadModels(repoWith(JSON.stringify(FIX.raw)));
    assert.deepEqual(resolveRoute(r, { workflow: 'culture' }), { searchers: ['claude'], reviewer: 'none' });
    assert.deepEqual(resolveRoute(r, { workflow: 'daily' }), { searchers: ['claude', 'codex'], reviewer: null });
    assert.deepEqual(resolveRoute(r, { workflow: 'culture', searchers: ['codex'] }), { searchers: ['codex'], reviewer: 'none' });
    assert.deepEqual(resolveRoute(r, { workflow: 'culture', searchers: ['codex'], reviewer: 'claude' }), { searchers: ['codex'], reviewer: 'claude' });
    assert.deepEqual(resolveRoute(r), { searchers: ['claude', 'codex'], reviewer: null });
});

test('a model turned off leaves the defaults that named it: searcher dropped, reviewer none, ask both becomes claude', () => {
    const reg = loadModels(repoWith(JSON.stringify({
        models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex', enabled: false }],
        defaults: { search: { searchers: ['claude', 'codex'], reviewer: 'codex' }, ask: { model: 'both' }, fill: { model: 'claude' },
            searches: { daily: { searchers: ['codex', 'claude'], reviewer: 'claude' } } },
    })));
    assert.deepEqual(reg.defaults.search, { searchers: ['claude'], reviewer: 'none' });
    assert.deepEqual(reg.defaults.searches.daily, { searchers: ['claude'], reviewer: 'none' });
    assert.deepEqual(reg.defaults.ask, { model: 'claude' });
});
