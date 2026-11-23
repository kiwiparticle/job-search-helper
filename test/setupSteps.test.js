import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { missingOwnerFiles, setD1Id, d1IdByName } from '../lib/setupSteps.js';

test('missingOwnerFiles lists examples whose owner path is absent', () => {
    const d = mkdtempSync(join(tmpdir(), 's-'));
    mkdirSync(join(d, 'examples/data'), { recursive: true });
    writeFileSync(join(d, 'examples/a.md'), 'x');
    writeFileSync(join(d, 'a.md'), 'x');
    writeFileSync(join(d, 'examples/data/b.json'), '{}');
    assert.deepEqual(missingOwnerFiles(d), ['data/b.json']);
});
test('setD1Id replaces only the database_id line', () => {
    const t = 'name = "x"\ndatabase_name = "job-search"\ndatabase_id = "REPLACE_WITH_D1_ID"\n';
    assert.equal(setD1Id(t, 'abc-1'), 'name = "x"\ndatabase_name = "job-search"\ndatabase_id = "abc-1"\n');
});
test('d1IdByName picks by name, null when absent', () => {
    const j = JSON.stringify([{ uuid: 'u1', name: 'other' }, { uuid: 'u2', name: 'job-search' }]);
    assert.equal(d1IdByName(j, 'job-search'), 'u2');
    assert.equal(d1IdByName(j, 'nope'), null);
    assert.equal(d1IdByName('not json', 'x'), null);
});

import { hasPagesProject } from '../lib/setupSteps.js';
test('hasPagesProject matches the exact name only', () => {
    const row = (n, d = '') => ({ 'Project Name': n, 'Project Domains': d });
    assert.equal(hasPagesProject(JSON.stringify([row('other'), row('job-search')]), 'job-search'), true);
    assert.equal(hasPagesProject(JSON.stringify([row('job-search-old')]), 'job-search'), false);
    assert.equal(hasPagesProject(JSON.stringify([row('x', 'job-search.pages.dev')]), 'job-search'), false);
    assert.equal(hasPagesProject('garbage', 'job-search'), false);
});
