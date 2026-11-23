import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, loadSome, writeRows } from '../lib/store.js';
import { updateCompanies } from '../functions/lib/companiesWrite.js';
import { handleCompanies, handleHistory } from '../functions/lib/handlers.js';

async function fresh(keys = ['a', 'b', 'c']) {
    const db = sqliteD1();
    await applySchema(db);
    await writeRows(db, { companies: keys.map((id) => ({ id, version: null, record: { key: id, n: 1 } })) });
    return db;
}
const versions = async (db) => Object.fromEntries((await loadAll(db, 'companies')).map((r) => [r.id, r.version]));
const MSG = 'Someone else changed the data at the same moment. Nothing was saved. Try again.';

// Runs `before` once, right before the first batch, to simulate another writer landing between load and write.
const racing = (db, times, before) => ({
    ...db,
    batch: async (s) => { if (times-- > 0) await before(); return db.batch(s); },
});

test('an edit to one of three companies moves only that row', async () => {
    const db = await fresh();
    await updateCompanies(db, ['a', 'b', 'c'], (r) => { r.b.n = 2; });
    assert.deepEqual(await versions(db), { a: 1, b: 2, c: 1 });
});

test('an edit that adds a key creates it at version 1', async () => {
    const db = await fresh(['a']);
    await updateCompanies(db, ['a'], (r) => { r.z = { key: 'z' }; });
    assert.deepEqual((await loadSome(db, 'companies', ['z'])).get('z'), { version: 1, record: { key: 'z' } });
});

test('null deletes one key while another changes, in one batch', async () => {
    const db = await fresh(['a', 'b']);
    let batches = 0;
    await updateCompanies({ ...db, batch: (s) => { batches++; return db.batch(s); } }, ['a', 'b'], (r) => { r.a = null; r.b.n = 5; });
    assert.equal(batches, 1);
    const rows = await loadSome(db, 'companies', ['a', 'b']);
    assert.equal(rows.has('a'), false);
    assert.equal(rows.get('b').record.n, 5);
});

test('returning null skips the write', async () => {
    const db = await fresh(['a']);
    await updateCompanies(db, ['a'], (r) => { r.a.n = 9; return null; });
    assert.deepEqual(await versions(db), { a: 1 });
});

test('a write landing between load and write is retried on top', async () => {
    const db = await fresh(['a']);
    const other = () => writeRows(db, { companies: [{ id: 'a', version: 1, record: { key: 'a', n: 1, other: true } }] });
    await updateCompanies(racing(db, 1, other), ['a'], (r) => { r.a.mine = true; });
    assert.deepEqual((await loadSome(db, 'companies', ['a'])).get('a'), { version: 3, record: { key: 'a', n: 1, other: true, mine: true } });
});

test('two stale attempts reject with 409 and write nothing', async () => {
    const db = await fresh(['a']);
    let v = 1;
    const other = async () => { await writeRows(db, { companies: [{ id: 'a', version: v, record: { key: 'a', n: ++v } }] }); };
    await assert.rejects(updateCompanies(racing(db, 2, other), ['a'], (r) => { r.a.mine = true; }), (e) => e.status === 409 && e.message === MSG);
    assert.equal((await loadSome(db, 'companies', ['a'])).get('a').record.mine, undefined);
});

test('GET companies pages through every row byte for byte', async () => {
    const keys = Array.from({ length: 1500 }, (_, i) => `k${String(i).padStart(4, '0')}`);
    const db = await fresh(keys);
    let text = '';
    let after = '';
    let pages = 0;
    for (;;) {
        const res = await handleCompanies({ db, after });
        assert.equal(res.headers.get('content-type'), 'application/x-ndjson');
        text += await res.text();
        pages++;
        after = res.headers.get('x-next-after');
        if (after === null) break;
    }
    assert.equal(pages, 3);
    assert.equal(text, keys.map((k) => `${JSON.stringify({ key: k, n: 1 })}\n`).join(''));
});

test('GET history for an unknown company is 200 and empty', async () => {
    const db = await fresh();
    const res = await handleHistory({ db, company: 'nope' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
});
