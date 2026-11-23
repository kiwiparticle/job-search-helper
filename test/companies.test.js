import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanies, renderCompanies, findCompany, possibleDuplicate, blankCompany } from '../lib/companies.js';

const rec = (name, extra = {}) => ({ ...blankCompany(name), ...extra });

test('round-trips: records render sorted by key, one JSON object per line', () => {
    const zed = rec('Zed Labs');
    const acme = rec('Acme Corp');
    const x = [zed, acme].map((r) => JSON.stringify(r)).join('\n') + '\n';
    const sorted = [acme, zed].map((r) => JSON.stringify(r)).join('\n') + '\n';
    assert.equal(renderCompanies(parseCompanies(x)), sorted);
    assert.equal(renderCompanies(parseCompanies(sorted)), sorted);
});

test('parseCompanies skips blank lines and throws naming the bad line', () => {
    const good = JSON.stringify(rec('Acme'));
    assert.equal(parseCompanies(`${good}\n\n`).length, 1);
    assert.throws(() => parseCompanies(`${good}\n{not json\n`), /line 2/);
});

test('findCompany matches a parenthetical name by its base name', () => {
    const list = [rec('Lanternby Software (Holdco subsidiary)')];
    assert.equal(findCompany(list, 'Lanternby Software'), list[0]);
});

test('findCompany misses "Quillfeather" for "Quillfeather PBC", but possibleDuplicate finds it', () => {
    const list = [rec('Quillfeather PBC')];
    assert.equal(findCompany(list, 'Quillfeather'), undefined);
    assert.equal(possibleDuplicate(list, 'Quillfeather'), list[0]);
});

test('an alias makes findCompany match', () => {
    const list = [rec('Quillfeather PBC', { aliases: ['Quillfeather'] })];
    assert.equal(findCompany(list, 'Quillfeather'), list[0]);
});

test('a distinctFrom key silences possibleDuplicate', () => {
    const list = [rec('Quillfeather PBC', { distinctFrom: ['quillfeather'] })];
    assert.equal(possibleDuplicate(list, 'Quillfeather'), undefined);
});

test('names under 4 characters are never possible duplicates', () => {
    const list = [rec('Pos PBC')];
    assert.equal(possibleDuplicate(list, 'Pos'), undefined);
});

test('parseCompanies rejects a line that is not an object', () => {
    for (const bad of ['null', '[1]', '5']) assert.throws(() => parseCompanies(`{"a":1}\n${bad}\n`), /companies\.jsonl line 2: not an object/);
});

test('renderCompanies lines start with the key', () => {
    const text = renderCompanies([rec('Zed'), rec('Acme')]);
    assert.ok(text.split('\n').filter(Boolean).every((l) => l.startsWith('{"key":')));
    assert.ok(text.indexOf('"acme"') < text.indexOf('"zed"'));
});

test('blankCompany has the new shape', () => {
    const c = blankCompany('Acme Inc');
    assert.equal(c.key, 'acme');
    assert.equal(c.stance, '');
    assert.deepEqual([c.jobs, c.applications, c.proposals, c.events], [{}, [], [], []]);
    assert.equal(c.status, undefined);
});

test('a blank company has empty link fields', () => {
    const c = blankCompany('Acme');
    assert.equal(c.careersUrl, '');
    assert.equal(c.jobsUrl, '');
});
