import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySettings, shown } from '../lib/settings.js';
import { handleAction } from '../functions/lib/handlers.js';
import { DEFAULT_ROLE } from '../lib/titleWords.js';

const filterText = '{\n  "version": 3,\n  "titleMust": [],\n  "titleMustNot": ["QA"]\n}\n';

test('shown fills defaults for keys the file lacks', () => {
    assert.deepEqual(shown('titles', JSON.parse(filterText)).roleWords, DEFAULT_ROLE);
    assert.deepEqual(shown('reasons', null), { skip: [], save: [], ruleOut: [] });
});

test('applySettings writes the tab keys, keeps the rest, bumps the filter version and keeps the indent', () => {
    const before = shown('titles', JSON.parse(filterText));
    const out = applySettings('titles', filterText, before, { ...before, roleWords: ['sdet', ' qa ', 'qa'], titleMustNot: [] });
    const next = JSON.parse(out.text);
    assert.deepEqual(next.roleWords, ['sdet', 'qa']);
    assert.deepEqual(next.titleMust, []);
    assert.equal(next.version, 4);
    assert.match(out.text, /^\{\n {2}"version"/);
});

test('applySettings refuses a moved file, bad values and an empty role list', () => {
    const before = shown('titles', JSON.parse(filterText));
    assert.equal(applySettings('titles', filterText, { ...before, levels: ['Senior'] }, before).status, 409);
    assert.equal(applySettings('titles', filterText, before, { ...before, roleWords: [] }).error, 'bad roleWords');
    assert.equal(applySettings('profile', null, shown('profile', null), { ...shown('profile', null), who: 'x', payFloor: -1 }).error, 'bad payFloor');
    assert.equal(applySettings('nope', '{}', {}, {}).status, 400);
});

test('setSettings commits one file, creates a missing one, and turns a GitHub sha clash into a 409', async () => {
    const puts = [];
    const store = { 'data/sweep-filter.json': { text: filterText, sha: 's1' } };
    const gh = {
        async getFile(path) { if (!store[path]) { const e = new Error('nf'); e.status = 404; throw e; } return store[path]; },
        async putFile(path, text, sha, message) { if (sha === 'moved') { const e = new Error('GitHub 409'); e.status = 409; throw e; } puts.push({ path, sha, message, text }); },
    };
    const before = shown('titles', JSON.parse(filterText));
    let res = await handleAction({ type: 'setSettings', tab: 'titles', before, value: { ...before, levels: ['Senior'] } }, { gh });
    assert.equal(res.status, 200);
    assert.deepEqual(puts.map((p) => [p.path, p.sha, p.message]), [['data/sweep-filter.json', 's1', 'settings: titles (page)']]);
    res = await handleAction({ type: 'setSettings', tab: 'reasons', before: shown('reasons', null), value: { skip: ['Pay too low'], save: [], ruleOut: [] } }, { gh });
    assert.equal(res.status, 200);
    assert.equal(puts[1].sha, undefined);
    store['data/sweep-filter.json'].sha = 'moved';
    res = await handleAction({ type: 'setSettings', tab: 'titles', before, value: before }, { gh });
    assert.equal(res.status, 409);
    assert.equal((await handleAction({ type: 'setSettings', tab: 'constructor' }, { gh })).status, 400);
});
