import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankCompany } from '../lib/companies.js';
import { prepareFill, finishFill } from '../lib/fill.js';
import { writeRows, loadAll, finishedResult } from '../lib/store.js';
import { sqliteD1, applySchema } from './sqliteD1.js';

const setup = async (facts, { status = 'ok', record = {} } = {}) => {
    const db = sqliteD1();
    await applySchema(db);
    const co = { ...blankCompany('Quillfeather PBC'), aliases: ['Quillfeather'], ...record };
    await writeRows(db, { companies: [{ id: co.key, version: null, record: co }] });
    const dir = join(mkdtempSync(join(tmpdir(), 'fill-')), '.fill');
    await prepareFill(db, dir, 'Quillfeather');
    if (status) writeFileSync(join(dir, 'status.txt'), status);
    if (facts !== undefined) writeFileSync(join(dir, 'facts.json'), typeof facts === 'string' ? facts : JSON.stringify(facts));
    return { db, dir, read: async () => (await loadAll(db, 'companies'))[0].record };
};
const good = { website: 'https://quillfeather.co', size: '300 people', funding: 'Private', facts: 'Founded 2009 (quillfeather.co/about).' };
const run = { today: '2026-11-15', at: '2026-11-15T10:00:00Z' };

test('prepare writes the record exact name', async () => {
    const { dir } = await setup(good);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'context.json'), 'utf8')), { company: 'Quillfeather PBC' });
});

test('good facts without company land on the context company', async () => {
    const t = await setup(good);
    await finishFill(t.db, t.dir, run);
    const r = await t.read();
    assert.equal(r.website, 'https://quillfeather.co');
    assert.equal(r.size, '300 people');
    assert.equal(r.factsUpdated, '2026-11-15');
    assert.equal(r.factsSource, 'fill');
});

test('a different company is rejected and nothing is written', async () => {
    const t = await setup({ ...good, company: 'Other Co' });
    await assert.rejects(finishFill(t.db, t.dir, run), /Other Co/);
    assert.equal((await t.read()).size, '');
});

test('active application and empty size: size is written; a non-empty facts is left alone', async () => {
    const t = await setup({ ...good, company: 'Quillfeather PBC', status: 'Watching', applications: [{ outcome: 'rejected' }] }, { record: { facts: 'Mine.', applications: [{ outcome: 'applied', role: 'X' }] } });
    await finishFill(t.db, t.dir, run);
    const r = await t.read();
    assert.equal(r.size, '300 people');
    assert.equal(r.facts, 'Mine.');
    assert.deepEqual(r.applications, [{ outcome: 'applied', role: 'X' }]);
});

test('non-http website dropped, 5000-character facts stored at 1000', async () => {
    const t = await setup({ ...good, website: 'javascript:x', facts: 'x'.repeat(5000) });
    await finishFill(t.db, t.dir, run);
    assert.equal((await t.read()).website, '');
    assert.equal((await t.read()).facts.length, 1000);
});

test('missing or bad facts.json, or a non-ok status: no change, throws', async () => {
    for (const t of [await setup(undefined), await setup('{nope'), await setup(good, { status: 'failed' }), await setup(good, { status: '' })]) {
        await assert.rejects(finishFill(t.db, t.dir, run));
        assert.equal((await t.read()).size, '');
    }
});

test('an old status word in facts.json drops only the status, facts still land', async () => {
    const t = await setup({ ...good, status: 'Applied' });
    await finishFill(t.db, t.dir, run);
    assert.equal((await t.read()).size, '300 people');
});

test('a redo with the same at is skipped, and the finished run is recorded', async () => {
    const t = await setup(good);
    await finishFill(t.db, t.dir, run);
    assert.deepEqual(await finishedResult(t.db, 'fill:quillfeatherpbc:2026-11-15T10:00:00Z'), {});
    const [row] = await loadAll(t.db, 'companies');
    await finishFill(t.db, t.dir, run);
    assert.equal((await loadAll(t.db, 'companies'))[0].version, row.version);
});

test('fingerprint and awards are filled when empty, never overwritten', async () => {
    const t = await setup({ company: 'Quillfeather PBC', fingerprint: '4/5; Glassdoor 4.6, medium confidence', awards: 'Inc. Best Workplaces 2025' }, { record: { awards: 'Mine.' } });
    await finishFill(t.db, t.dir, run);
    const r = await t.read();
    assert.equal(r.fingerprint, '4/5; Glassdoor 4.6, medium confidence');
    assert.equal(r.awards, 'Mine.');
});

test('an unscored fingerprint counts as empty; a scored one or Pace fail stays', async () => {
    const facts = { company: 'Quillfeather PBC', fingerprint: '4/5; Glassdoor 4.6, medium confidence' };
    for (const [had, want] of [['Unscored — thin evidence', facts.fingerprint], ['Thin - no reviews', facts.fingerprint], ['3/5; ok', '3/5; ok'], ['Pace fail: 60h weeks', 'Pace fail: 60h weeks']]) {
        const t = await setup(facts, { record: { fingerprint: had } });
        await finishFill(t.db, t.dir, run);
        assert.equal((await t.read()).fingerprint, want, had);
    }
});
