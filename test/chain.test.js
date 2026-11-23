import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBatch } from '../lib/chain.js';

const route = { searchers: ['claude', 'codex'], reviewer: null };
test('chain continues only while roles were judged and some remain', () => {
    assert.deepEqual(nextBatch({ sweep: { judged: 30, left: 12 } }, route, '3'), { workflow: 'tracked', sweep_roles: '30', chain: '2', searchers: 'claude,codex', reviewer: 'each' });
    assert.equal(nextBatch({ sweep: { judged: 0, left: 12 } }, route, '3'), null);
    assert.equal(nextBatch({ sweep: { judged: 5, left: 0 } }, route, '3'), null);
    assert.equal(nextBatch({ sweep: { judged: 5, left: 5 } }, route, '0'), null);
    assert.equal(nextBatch({}, route, '3'), null);
    assert.equal(nextBatch({ sweep: { judged: 5, left: 5 } }, { searchers: ['qwen'], reviewer: 'none' }, '1').reviewer, 'none');
});
