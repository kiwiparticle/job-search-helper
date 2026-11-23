import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows } from '../lib/store.js';
import { sweepBoards } from '../lib/boardSweep.js';
import { sweepPostings } from '../lib/sweepPostings.js';
import { newQueue } from '../lib/newQueue.js';
import { blankCompany } from '../lib/companies.js';
import { run as sweepRun } from '../bin/sweep.js';

const json = (body) => ({ status: 200, headers: new Headers(), json: async () => body });
const board = (...ids) => json({ jobs: ids.map((id) => ({ id, title: `Senior Engineer ${id}`, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}` })) });
const deps = (ids) => ({ fetchImpl: async (u) => (u.includes('/acme/') ? board(...ids) : { status: 404, headers: new Headers() }), lookup: async () => [{ address: '8.8.8.8' }] });
const acme = () => ({ ...blankCompany('Acme'), stance: 'Watching', jobsUrl: 'https://boards.greenhouse.io/acme' });

async function seeded(postings = []) {
    const db = sqliteD1();
    await applySchema(db);
    await writeRows(db, { companies: [{ id: 'acme', version: null, record: acme() }], postings: postings.map((p) => ({ id: p.id, version: null, record: p })) });
    return db;
}

test('sweep saves new roles unjudged, once', async () => {
    const db = await seeded();
    await sweepRun(db, { now: '2026-11-18T04:00:00Z', ...deps([1, 2]) });
    const rows = await loadAll(db, 'postings');
    assert.deepEqual(rows.map((r) => [r.id, r.record.modelSays, r.record.source]), [['greenhouse:1', '', 'sweep'], ['greenhouse:2', '', 'sweep']]);
    const same = await sweepRun(db, { now: '2026-11-18T16:00:00Z', ...deps([1, 2, 3]) });
    assert.deepEqual(same.map((c) => [c.id, c.version]), [['greenhouse:3', null]], 'same day: only the new role');
    const next = await sweepRun(db, { now: '2026-11-19T04:00:00Z', ...deps([1, 2, 3]) });
    assert.deepEqual(next.map((c) => c.id).sort(), ['greenhouse:1', 'greenhouse:2', 'greenhouse:3'], 'next day: roles still listed are touched for the prune');
});

test('unjudged roles show in New, until skipped or judged', async () => {
    const db = await seeded();
    await sweepRun(db, { now: '2026-11-18T04:00:00Z', ...deps([1, 2]) });
    const companies = (await loadAll(db, 'companies')).map((r) => r.record);
    const postings = (await loadAll(db, 'postings')).map((r) => r.record);
    assert.deepEqual(newQueue(companies, postings).map((i) => i.kind), ['unjudged', 'unjudged']);
    postings[0].modelSays = 'pass';
    companies[0].jobs = { 'greenhouse:2': { state: 'skipped', role: 'x', leadKey: postings[1].leadKey, at: '2026-11-18' } };
    assert.deepEqual(newQueue(companies, postings), []);
});

test('judge mode lists unjudged roles again, minus skipped and judged ones', async () => {
    const db = await seeded();
    await sweepRun(db, { now: '2026-11-18T04:00:00Z', ...deps([1, 2, 3]) });
    const companies = (await loadAll(db, 'companies')).map((r) => r.record);
    const postings = (await loadAll(db, 'postings')).map((r) => r.record);
    postings[0].modelSays = 'pass';
    companies[0].jobs = { 'greenhouse:2': { state: 'skipped', role: 'x', leadKey: postings[1].leadKey, at: '2026-11-18' } };
    const plain = await sweepBoards({ companies, postings }, deps([1, 2, 3]));
    assert.deepEqual(plain[0].roles, []);
    const judge = await sweepBoards({ companies, postings, judge: true }, deps([1, 2, 3]));
    assert.deepEqual(judge[0].roles.map((r) => r.id), ['greenhouse:3']);
});

test('a role already recorded under another id is not added twice', () => {
    const co = acme();
    const old = { id: 'key:abc', companyKey: co.key, leadKey: 'acme::seniorengineer1', wasLead: true, modelSays: 'lead', lastRun: '2026-11-01' };
    const results = [{ company: 'Acme', status: 'ok', roles: [{ id: 'greenhouse:1', title: 'Senior Engineer 1', url: 'https://boards.greenhouse.io/acme/jobs/1' }], seen: ['greenhouse:1'] }];
    assert.deepEqual(sweepPostings({ companies: [co], postings: [old], results, run: '2026-11-18-sweep-0400' }), []);
});

test('sweepOff company: not swept, existing roles hidden from New', async () => {
    const db = await seeded();
    await sweepRun(db, { now: '2026-11-18T04:00:00Z', ...deps([1]) });
    const companies = (await loadAll(db, 'companies')).map((r) => r.record);
    const postings = (await loadAll(db, 'postings')).map((r) => r.record);
    companies[0].sweepOff = true;
    assert.deepEqual(newQueue(companies, postings), []);
    const results = await sweepBoards({ companies, postings }, deps([1, 2]));
    assert.deepEqual(results, []);
});
