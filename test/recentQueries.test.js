import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recentQueries } from '../lib/run.js';

const report = (repo, run, model, md) => {
    mkdirSync(join(repo, 'runs', run, model), { recursive: true });
    writeFileSync(join(repo, 'runs', run, model, 'report.md'), md);
};

test('recentQueries reads the Queries section of the last runs of the same workflow', () => {
    const repo = mkdtempSync(join(tmpdir(), 'rq-'));
    report(repo, '2026-11-01-daily', 'claude', '## Leads\n- x\n\n## Queries\n- senior vue remote\n- staff typescript cad\n\n## Notes\nnot a query\n');
    report(repo, '2026-11-02-daily-101010', 'codex', '## Queries\n1. senior vue remote\n2. greenhouse javascript remote\n');
    report(repo, '2026-11-02-vertical-101010', 'claude', '## Queries\n- vertical only\n');
    report(repo, '2026-11-03-daily', 'claude', '## Leads\nnone\n');
    assert.deepEqual(recentQueries(repo, 'daily'), ['senior vue remote', 'staff typescript cad', 'greenhouse javascript remote']);
    assert.deepEqual(recentQueries(repo, 'daily', 1), []);
    assert.deepEqual(recentQueries(repo, 'tracked'), []);
});
