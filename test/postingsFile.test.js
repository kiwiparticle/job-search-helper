import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostings, renderPostings, blankPosting } from '../lib/postingsFile.js';

const p = (id) => blankPosting({ id, companyKey: 'acme', leadKey: 'acme::x', role: 'X', url: '', source: 'model' });

test('render sorts by id with id first, and parse round-trips', () => {
    const list = [p('lever:b'), p('greenhouse:1'), p('key:00000001')];
    const sorted = [list[1], list[2], list[0]];
    const text = renderPostings(list);
    assert.ok(text.split('\n').filter(Boolean).every((l) => l.startsWith('{"id":')));
    assert.deepEqual(parsePostings(text), sorted);
});

test('parsePostings skips blanks and names the bad line', () => {
    assert.equal(parsePostings(`${JSON.stringify(p('a'))}\n\n`).length, 1);
    assert.throws(() => parsePostings(`${JSON.stringify(p('a'))}\n[1]\n`), /line 2: not an object/);
});

test('blankPosting has the documented defaults', () => {
    assert.deepEqual(p('a'), { id: 'a', companyKey: 'acme', leadKey: 'acme::x', role: 'X', url: '', pay: '', modelSays: 'pass', wasLead: false, verdicts: {}, firstRun: '', lastRun: '', posted: 'unknown', postedCheckedAt: '', source: 'model' });
});
