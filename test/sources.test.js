import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickSources, checkedSources } from '../lib/sources.js';

test('least recently checked sources go first; checked list keeps only assigned, finished sources', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'sources-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'data')); mkdirSync(join(root, 'runs/r1'), { recursive: true });
    writeFileSync(join(root, 'data/sources.json'), JSON.stringify([{ name: 'A' }, { name: 'B' }, { name: 'C' }]));
    writeFileSync(join(root, 'runs/index.json'), JSON.stringify([
        { run: 'r1', workflow: 'culture', finishedAt: '2026-11-10T00:00:00Z' },
        { run: 'x', workflow: 'daily', finishedAt: '2026-11-17T00:00:00Z' },
    ]));
    writeFileSync(join(root, 'runs/r1/report.json'), JSON.stringify({ sourcesChecked: ['A'] }));
    assert.deepEqual(pickSources(root, 2).map((s) => s.name), ['B', 'C']);
    assert.equal(pickSources(root, 3)[2].lastChecked, '2026-11-10');
    const out = [{ coverage: [{ source: 'B', status: 'completed' }, { source: 'Z', status: 'completed' }, { source: 'C', status: 'unfinished' }] }, { coverage: [{ source: 'B', status: 'partial' }] }];
    assert.deepEqual(checkedSources(out, [{ name: 'B' }, { name: 'C' }]), ['B']);
});
