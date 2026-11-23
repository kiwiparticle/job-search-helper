import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChecks } from '../lib/checks.js';

test('cleanChecks reads the old Remote / ZZ label as Location', () => {
    assert.deepEqual(cleanChecks([{ label: 'Remote / ZZ', value: 'v', mark: 'good' }]), [{ label: 'Location', value: 'v', mark: 'good' }]);
});

test('cleanChecks keeps one Location when old and new both appear, first wins', () => {
    const out = cleanChecks([{ label: 'Remote / ZZ', value: 'old', mark: 'good' }, { label: 'Location', value: 'new', mark: 'concern' }]);
    assert.deepEqual(out, [{ label: 'Location', value: 'old', mark: 'good' }]);
});
