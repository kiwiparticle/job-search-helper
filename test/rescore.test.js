import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickJobs, cleanRescore, applyRescore, applyFingerprint, finishRescore, prepareRescore } from '../lib/rescore.js';
import { handleAction } from '../functions/lib/handlers.js';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { writeRows, loadSome, loadAll, finishedResult } from '../lib/store.js';

const co = (key, over = {}) => ({ key, name: key, stance: 'Watching', jobs: {}, applications: [], ...over });
const post = (id, over = {}) => ({ id, companyKey: 'a', leadKey: id, role: 'Senior Engineer ' + id, url: 'https://x.com/' + id, modelSays: 'lead', source: 'search', firstRun: '2026-11-20', lastRun: '2026-11-20', posted: 'yes', ...over });
const saved = (id) => ({ [id]: { state: 'saved', leadKey: id } });

test('pickJobs takes saved, applying and flagged jobs with a posting, not ruled out, not applied', () => {
    const cs = [
        co('a', { jobs: { ...saved('s1'), ...saved('nopost'), ap2: { ...saved('ap2').ap2, state: 'applying' } }, jobFlags: { f1: { at: '2026-11-01', role: 'x', leadKey: 'f1' } }, notes: [{ at: '2026-11-02', text: 'likes it' }], jobNotes: { s1: [{ at: '2026-11-03', text: 'async' }] } }),
        co('b', { stance: 'Ruled out', jobs: saved('r1') }),
        co('c', { jobs: saved('ap1'), applications: [{ postingId: 'ap1', leadKey: 'ap1', outcome: 'applied' }] }),
    ];
    const ps = [post('s1'), post('ap2'), post('f1'), post('r1', { companyKey: 'b' }), post('ap1', { companyKey: 'c' })];
    const out = pickJobs(cs, ps);
    assert.deepEqual(out.jobs.map((j) => j.postingId).sort(), ['ap2', 'f1', 's1']);
    assert.deepEqual(out.companies.map((c) => c.key), ['a']);
    assert.deepEqual(out.companies[0].notes, ['likes it', 'Senior Engineer s1: async']);
});

test('cleanRescore keeps known ids and valid scores', () => {
    const ctx = { jobs: [{ postingId: 'p1', companyKey: 'a' }, { postingId: 'p2', companyKey: 'a' }], companies: [{ key: 'a' }, { key: 'b' }] };
    const out = cleanRescore({
        jobs: [{ postingId: 'p1', fit: 4, why: ' ' + 'w'.repeat(500) }, { postingId: 'zz', fit: 3 }, { postingId: 'p2', fit: 7 }],
        companies: [{ key: 'a', fingerprint: 4, fingerprintText: '4/5; async' }, { key: 'b', fingerprint: 9 }, { key: 'nope', fingerprint: 1 }],
    }, ctx);
    assert.deepEqual([...out.jobs.keys()], ['p1']);
    assert.equal(out.jobs.get('p1').why.length, 400);
    assert.deepEqual([...out.companies], [['a', { fingerprint: 4, text: '4/5; async' }]]);
    assert.equal(out.dropped, 4);
    const mismatch = cleanRescore({ jobs: [], companies: [{ key: 'a', fingerprint: 4, fingerprintText: '5/5; great' }, { key: 'b', fingerprint: null, fingerprintText: 'Unscored — thin evidence' }] }, ctx);
    assert.equal(cleanRescore({ jobs: [], companies: [{ key: 'a', fingerprint: 4, fingerprintText: '4 great' }] }, ctx).companies.get('a').text, null);
    assert.deepEqual([...mismatch.companies], [['a', { fingerprint: 4, text: null }], ['b', { fingerprint: null, text: 'Unscored — thin evidence' }]]);
});

test('applyRescore writes fit, rescore and an event naming what moved', () => {
    const p = post('p1', { fit: 3 });
    const c = co('a', { fingerprint: '2/5; thin' });
    const r = applyRescore(p, c, { fit: 4, why: 'async counts' }, { fingerprint: 4 }, { by: 'claude', at: 'T' });
    assert.equal(r.posting.fit, 4);
    assert.deepEqual(r.posting.rescore, { at: 'T', by: 'claude', fitFrom: 3, fitTo: 4, fingerprintFrom: 2, fingerprintTo: 4, why: 'async counts' });
    assert.equal(r.event, 'Re-check: Senior Engineer p1: fit 3→4');
    const same = applyRescore(p, c, { fit: 3, why: 'same' }, { fingerprint: 2 }, { by: 'claude', at: 'T' });
    assert.equal(same.event, null);
    assert.equal(same.posting.rescore.fitTo, 3);
    const fpOnly = applyRescore(p, c, { fit: 3, why: 'x' }, { fingerprint: 4 }, { by: 'claude', at: 'T' });
    assert.equal(fpOnly.event, null);
    assert.equal(fpOnly.posting.rescore.fingerprintTo, 4);
});

test('applyFingerprint rewrites the text with its guards', () => {
    const c = co('a', { fingerprint: '2/5; thin' });
    const r = applyFingerprint(c, { fingerprint: 4, text: '4/5; async' }, '2/5; thin', { at: '2026-11-23T05:00:00Z' });
    assert.equal(r.company.fingerprint, '4/5; async');
    assert.equal(r.event, 'Re-check: fingerprint 2→4 (was: 2/5; thin)');
    assert.deepEqual(r.company.events.at(-1), { date: '2026-11-23', text: r.event });
    const co4 = { fingerprint: 4, text: '4/5; async' };
    assert.equal(applyFingerprint({ ...c, applications: [{ outcome: 'applied' }] }, co4, '2/5; thin', { at: 'T' }), null);
    assert.equal(applyFingerprint({ ...c, stance: 'Ruled out' }, co4, '2/5; thin', { at: 'T' }), null);
    assert.equal(applyFingerprint(c, co4, 'older text', { at: 'T' }), null);
    assert.equal(applyFingerprint(c, { fingerprint: 4, text: null }, '2/5; thin', { at: 'T' }), null);
    assert.equal(applyFingerprint(c, { fingerprint: 2, text: '2/5; thin' }, '2/5; thin', { at: 'T' }), null);
});

async function seed() {
    const db = sqliteD1();
    await applySchema(db);
    const c = co('a', { fingerprint: '2/5; thin', jobs: { ...saved('p1'), ...saved('p2') } });
    await writeRows(db, { companies: [{ id: 'a', version: null, record: c }], postings: [post('p1', { fit: 3 }), post('p2')].map((record) => ({ id: record.id, version: null, record })) });
    const dir = mkdtempSync(join(tmpdir(), 'rescore-'));
    const repo = new URL('..', import.meta.url).pathname;
    return { db, dir, repo };
}

test('finishRescore writes once per run and syncs the fingerprint text', async () => {
    const { db, dir, repo } = await seed();
    const out = await prepareRescore(db, dir, repo);
    assert.equal(out.count, 2);
    writeFileSync(join(dir, 'status.txt'), 'ok\n');
    writeFileSync(join(dir, 'rescore.json'), JSON.stringify({
        jobs: [{ postingId: 'p1', fit: 4, why: 'async' }, { postingId: 'p2', fit: 2, why: 'meh' }, { postingId: 'bad', fit: 9 }],
        companies: [{ key: 'a', fingerprint: 4, fingerprintText: '4/5; async team' }],
    }));
    const r = await finishRescore(db, dir, dir, { at: 'T1', model: 'claude' });
    assert.deepEqual(r, { changed: 2, unchanged: 0, rewritten: 1, skipped: 0, dropped: 1 });
    const again = await finishRescore(db, dir, dir, { at: 'T1', model: 'claude' });
    assert.deepEqual(again, r);
    const p1 = (await loadSome(db, 'postings', ['p1'])).get('p1');
    assert.equal(p1.version, 2);
    assert.deepEqual([p1.record.fit, p1.record.rescore.fingerprintFrom, p1.record.rescore.fingerprintTo], [4, 2, 4]);
    const a = (await loadSome(db, 'companies', ['a'])).get('a');
    assert.equal(a.record.fingerprint, '4/5; async team');
    assert.equal(a.record.events.filter((e) => e.text.startsWith('Re-check: fingerprint')).length, 1);
    assert.equal(a.record.events.filter((e) => e.text.startsWith('Re-check: Senior')).length, 2);
    assert.ok((await db.prepare("SELECT run FROM finished_runs WHERE run = 'rescore:T1'").first()));
    assert.equal((await loadAll(db, 'postings')).length, 2);
});

test('finishRescore skips the text when the company changed since prepare', async () => {
    const { db, dir, repo } = await seed();
    await prepareRescore(db, dir, repo);
    const a = (await loadSome(db, 'companies', ['a'])).get('a');
    await writeRows(db, { companies: [{ id: 'a', version: a.version, record: { ...a.record, fingerprint: '3/5; owner edit' } }] });
    writeFileSync(join(dir, 'status.txt'), 'ok\n');
    writeFileSync(join(dir, 'rescore.json'), JSON.stringify({ jobs: [{ postingId: 'p1', fit: 4, why: 'x' }], companies: [{ key: 'a', fingerprint: 4, fingerprintText: '4/5; async team' }] }));
    const r = await finishRescore(db, dir, dir, { at: 'T2', model: 'claude' });
    assert.deepEqual([r.rewritten, r.skipped], [0, 1]);
    assert.equal((await loadSome(db, 'companies', ['a'])).get('a').record.fingerprint, '3/5; owner edit');
    const p1 = (await loadSome(db, 'postings', ['p1'])).get('p1').record;
    assert.equal(p1.fit, 4);
    // The text wasn't written, so the posting keeps the old fingerprint score.
    assert.equal(p1.rescore.fingerprintTo, p1.rescore.fingerprintFrom);
});

test('finishRescore refuses when the model did not finish ok', async () => {
    const { db, dir, repo } = await seed();
    await prepareRescore(db, dir, repo);
    writeFileSync(join(dir, 'status.txt'), 'failed\n');
    await assert.rejects(finishRescore(db, dir, dir, { at: 'T3', model: 'claude' }), /Model run did not finish ok/);
});

test('finishRescore throws and records nothing when rescore.json is missing or has no usable job', async () => {
    const { db, dir, repo } = await seed();
    await prepareRescore(db, dir, repo);
    writeFileSync(join(dir, 'status.txt'), 'ok\n');
    await assert.rejects(finishRescore(db, dir, dir, { at: 'T4', model: 'claude' }), /no usable rescore\.json/);
    writeFileSync(join(dir, 'rescore.json'), JSON.stringify({ jobs: [{ postingId: 'nope', fit: 3 }], companies: [] }));
    await assert.rejects(finishRescore(db, dir, dir, { at: 'T4', model: 'claude' }), /no usable rescore\.json/);
    assert.equal(await finishedResult(db, 'rescore:T4'), null);
});

test('runSearch dispatches rescore.yml with no inputs', async () => {
    const calls = [];
    const deps = { gh: { dispatch: async (w, i) => calls.push([w, i]) }, db: sqliteD1() };
    assert.equal((await handleAction({ type: 'run', workflow: 'rescore' }, deps)).status, 202);
    assert.deepEqual(calls, [['rescore.yml', {}]]);
});
