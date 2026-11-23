import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows } from '../lib/store.js';
import { blankCompany } from '../lib/companies.js';
import { run } from '../bin/resolve-links.js';

const pub = async () => [{ address: '93.184.216.34' }];
const res = (status, body) => ({ status, headers: new Headers(), text: async () => body, json: async () => JSON.parse(body) });
const GH = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';
const seed = async (pages) => {
    const db = sqliteD1();
    await applySchema(db);
    const companies = Object.entries(pages).map(([name]) => ({ id: blankCompany(name).key, version: null, record: { ...blankCompany(name), stance: 'Watching', careersUrl: `https://${name.toLowerCase()}.com/careers` } }));
    await writeRows(db, { companies });
    return db;
};
const fetchFor = (pages, hook = () => {}) => async (url) => {
    hook(url);
    if (url === GH) return res(200, '{"jobs":[]}');
    for (const [name, body] of Object.entries(pages)) if (url === `https://${name.toLowerCase()}.com/careers`) return res(200, body);
    return res(404, '');
};

test('run writes a found board once, skips ambiguous pages, and is idempotent', async () => {
    const pages = { Acme: '<a href="https://boards.greenhouse.io/acme">', Beta: 'boards.greenhouse.io/acme jobs.lever.co/beta' };
    const db = await seed(pages);
    const d = { today: '2026-11-17', fetchImpl: fetchFor(pages), lookup: pub };
    assert.equal(await run(db, d), 1);
    const rows = Object.fromEntries((await loadAll(db, 'companies')).map((r) => [r.id, r]));
    assert.equal(rows.acme.record.jobsUrl, 'https://boards.greenhouse.io/acme');
    assert.equal(rows.acme.record.events.length, 1);
    assert.equal(rows.beta.record.jobsUrl, '');
    const before = (await loadAll(db, 'companies')).map((r) => [r.id, r.version]);
    assert.equal(await run(db, d), 0);
    assert.deepEqual((await loadAll(db, 'companies')).map((r) => [r.id, r.version]), before);
});

test('run writes each of two nameless company records once', async () => {
    const pages = { Acme: '<a href="https://boards.greenhouse.io/acme">' };
    const db = await seed(pages);
    const nameless = (id) => ({ id, version: null, record: { key: id, stance: 'Watching', careersUrl: 'https://acme.com/careers' } });
    await writeRows(db, { companies: [nameless('nameless'), nameless('nameless2')] });
    await run(db, { today: '2026-11-17', fetchImpl: fetchFor(pages), lookup: pub });
    const rows = Object.fromEntries((await loadAll(db, 'companies')).map((r) => [r.id, r]));
    assert.equal(rows.acme.record.jobsUrl, 'https://boards.greenhouse.io/acme');
    for (const id of ['nameless', 'nameless2']) {
        assert.equal(rows[id].record.jobsUrl, 'https://boards.greenhouse.io/acme');
        assert.equal(rows[id].version, 2);
    }
});

test('run redoes the pass when a row moved between read and write', async () => {
    const pages = { Acme: '<a href="https://boards.greenhouse.io/acme">' };
    const db = await seed(pages);
    let bumped = false;
    const fetchImpl = fetchFor(pages, async (url) => {
        if (!bumped && url === GH) { bumped = true; await db.prepare("UPDATE companies SET version = version + 1, data = json_set(data, '$.verdict', 'moved') WHERE key = 'acme'").run(); }
    });
    assert.equal(await run(db, { today: '2026-11-17', fetchImpl, lookup: pub }), 1);
    const [r] = await loadAll(db, 'companies');
    assert.equal(r.record.jobsUrl, 'https://boards.greenhouse.io/acme');
    assert.equal(r.record.verdict, 'moved');
    assert.equal(r.version, 3);
});
