import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReview, mergeReviews } from '../lib/kitReview.js';

test('readReview drops bad states and non-strings, and caps', () => {
    const r = readReview(JSON.stringify({ keywords: [{ term: 'A', state: 'used' }, { term: 'B', state: 'bogus' }, { state: 'used' }], truth: ['x', 5, ''] }));
    assert.deepEqual(r, { keywords: [{ term: 'A', state: 'used' }], truth: ['x'], questions: [] });
    assert.equal(readReview('not json'), null);
});

test('mergeReviews: worse state wins, truth unions, same model replaces its entry, other kit fields stay', () => {
    const kit = { drafter: 'codex', reviewer: 'claude', rounds: 2, reviews: [{ model: 'claude', at: 'old' }, { model: 'codex', at: 'old' }] };
    const out = mergeReviews(kit, [
        { model: 'claude', keywords: [{ term: 'React', state: 'used' }, { term: 'Go', state: 'missing' }], truth: ['a'] },
        { model: 'codex', keywords: [{ term: 'react', state: 'missing' }, { term: 'Go', state: 'not-in-master' }], truth: ['a', 'b'] },
    ], 'now');
    assert.deepEqual(out.keywords, [{ term: 'react', state: 'missing' }, { term: 'Go', state: 'not-in-master' }]);
    assert.deepEqual(out.truth, ['a', 'b']);
    assert.deepEqual(out.reviews, [{ model: 'claude', at: 'now' }, { model: 'codex', at: 'now' }]);
    assert.equal(out.drafter, 'codex');
    const one = mergeReviews(out, [{ model: 'claude', keywords: [], truth: [] }], 'later');
    assert.deepEqual(one.reviews, [{ model: 'codex', at: 'now' }, { model: 'claude', at: 'later' }]);
});
