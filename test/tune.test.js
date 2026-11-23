import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows } from '../lib/store.js';
import { blankCompany } from '../lib/companies.js';
import { blobSha, cleanProposals, collectReasons, prepareTune, finishTune, applyEdit, markApplied } from '../lib/tune.js';
import { handleAction } from '../functions/lib/handlers.js';

const RULES = 'Line one.\nSkip on-site roles.\nLine three.\n';
const repo = () => {
    const d = mkdtempSync(join(tmpdir(), 'tune-'));
    mkdirSync(join(d, 'data'));
    writeFileSync(join(d, 'instructions.md'), RULES);
    writeFileSync(join(d, 'data', 'sweep-filter.json'), '{ "version": 1 }\n');
    return d;
};
const db0 = async () => { const db = sqliteD1(); await applySchema(db); return db; };
const tuneRows = async (db) => (await loadAll(db, 'tune')).map((r) => r.record);
const out = (proposals, status = 'ok') => {
    const d = mkdtempSync(join(tmpdir(), 'tune-out-'));
    writeFileSync(join(d, 'status.txt'), status);
    writeFileSync(join(d, 'proposals.json'), JSON.stringify(proposals));
    return d;
};

test('blobSha matches git hash-object', () => {
    const d = repo();
    assert.equal(blobSha(RULES), execFileSync('git', ['hash-object', join(d, 'instructions.md')], { encoding: 'utf8' }).trim());
});

test('collectReasons lists reasons on or after the last tune, with their job', () => {
    const c = { ...blankCompany('Acme'), jobs: { p1: { state: 'skipped', role: 'Staff', reasons: [{ state: 'skipped', reason: 'Not remote', at: '2026-11-20' }, { state: 'saved', reason: 'Old', at: '2026-11-01' }] } } };
    assert.deepEqual(collectReasons([c], '2026-11-15'), [{ company: 'Acme', role: 'Staff', postingId: 'p1', state: 'skipped', reason: 'Not remote', at: '2026-11-20' }]);
});

test('prepareTune counts reasons since the last finished tune and names the default model', async () => {
    const db = await db0();
    const c = { ...blankCompany('Acme'), jobs: { p1: { state: 'skipped', role: 'Staff', reasons: [{ state: 'skipped', reason: 'x', at: '2026-11-10' }] } } };
    await writeRows(db, { companies: [{ id: c.key, version: null, record: c }] });
    const d = repo();
    assert.deepEqual(await prepareTune(db, join(d, 'ctx'), d), { model: 'claude', count: 1 });
    await writeRows(db, { finishedRun: { run: 'tune:2026-11-12T13:00:00Z', at: '2026-11-12T13:00:00Z', result: {} } });
    assert.equal((await prepareTune(db, join(d, 'ctx'), d)).count, 0);
    assert.equal(JSON.parse(readFileSync(join(d, 'ctx', 'context.json'), 'utf8')).since, '2026-11-12');
});

test('cleanProposals keeps only allowed files with find, replace and why', () => {
    const ok = { file: 'instructions.md', find: 'a', replace: 'b', why: 'w' };
    assert.deepEqual(cleanProposals([ok, { ...ok, file: '../x' }, { ...ok, file: 'master-resume.md' }, { ...ok, why: '' }, { ...ok, replace: 'a' }, null]), [ok]);
    assert.equal(cleanProposals(Array(20).fill(ok)).length, 8);
});

test('finishTune saves proposals whose text occurs once, with the blob sha, and only once per run', async () => {
    const db = await db0();
    const d = repo();
    const o = out([{ file: 'instructions.md', find: 'Skip on-site roles.', replace: 'Skip on-site and hybrid roles.', why: '3 hybrid skips' }, { file: 'instructions.md', find: 'Line', replace: 'x', why: 'twice' }]);
    assert.deepEqual(await finishTune(db, o, d, '2026-11-21T13:00:00Z'), { saved: 1, dropped: ['instructions.md: the text to replace is not there exactly once'] });
    const [p] = await tuneRows(db);
    assert.deepEqual([p.id, p.status, p.baseSha], ['tune:2026-11-21T13:00:00Z:1', 'open', blobSha(RULES)]);
    assert.deepEqual(await finishTune(db, o, d, '2026-11-21T13:00:00Z'), { saved: 0, dropped: [] });
    await assert.rejects(finishTune(db, out([], 'failed'), d, '2026-11-22T13:00:00Z'), /did not finish ok/);
});

test('apply: Apply needs a yes, then the edit lands once; a changed file makes it stale', async () => {
    const db = await db0();
    const d = repo();
    await finishTune(db, out([{ file: 'instructions.md', find: 'Skip on-site roles.', replace: 'Skip on-site and hybrid roles.', why: 'w' }]), d, 'T1');
    const id = 'tune:T1:1';
    const calls = [];
    const gh = { dispatch: async (workflow, inputs) => calls.push({ workflow, inputs }) };
    const act = (body) => handleAction(body, { gh, db, today: () => '2026-11-21' }).then(async (r) => [r.status, await r.json()]);
    assert.equal((await act({ type: 'applyTune', id }))[1].needsConfirm, true);
    assert.equal((await act({ type: 'applyTune', id, confirmed: true }))[0], 202);
    assert.deepEqual(calls, [{ workflow: 'tune-apply.yml', inputs: { id } }]);
    assert.equal(await applyEdit(db, id, d), 'edited');
    assert.equal(readFileSync(join(d, 'instructions.md'), 'utf8'), 'Line one.\nSkip on-site and hybrid roles.\nLine three.\n');
    // Pushed, then the run stopped before marking: a retry sees the edit already there.
    assert.equal(await applyEdit(db, id, d), 'done');
    await markApplied(db, id);
    assert.equal((await tuneRows(db))[0].status, 'applied');
    assert.equal(await applyEdit(db, id, d), 'done');

    await finishTune(db, out([{ file: 'instructions.md', find: 'Line three.', replace: 'Line 3.', why: 'w' }]), d, 'T2');
    writeFileSync(join(d, 'instructions.md'), 'Owner edit.\nLine three.\n');
    await act({ type: 'applyTune', id: 'tune:T2:1', confirmed: true });
    await assert.rejects(applyEdit(db, 'tune:T2:1', d), /changed since/);
    assert.equal((await tuneRows(db)).find((p) => p.id === 'tune:T2:1').status, 'stale');
    assert.equal(readFileSync(join(d, 'instructions.md'), 'utf8'), 'Owner edit.\nLine three.\n');
});

test('dismissTune drops a proposal; run dispatches tune.yml', async () => {
    const db = await db0();
    const d = repo();
    await finishTune(db, out([{ file: 'instructions.md', find: 'Line one.', replace: 'Line 1.', why: 'w' }]), d, 'T3');
    const calls = [];
    const deps = { gh: { dispatch: async (workflow) => calls.push(workflow) }, db };
    assert.equal((await handleAction({ type: 'dismissTune', id: 'tune:T3:1' }, deps)).status, 200);
    assert.equal((await tuneRows(db))[0].status, 'dismissed');
    assert.equal((await handleAction({ type: 'run', workflow: 'tune' }, deps)).status, 202);
    assert.deepEqual(calls, ['tune.yml']);
});
