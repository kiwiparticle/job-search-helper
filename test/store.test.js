import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, loadSome, jsonLines, loadHistory, historyLines, writeRows, finishedResult, currentSeq, deltaJson } from '../lib/store.js';

async function fresh() {
    const db = sqliteD1();
    await applySchema(db);
    return db;
}
const ins = (db, id, record = { n: 1 }) => writeRows(db, { companies: [{ id, version: null, record }] });
const stale = { stale: true, status: 409 };

test('insert then update with the right version', async () => {
    const db = await fresh();
    await ins(db, 'a');
    await writeRows(db, { companies: [{ id: 'a', version: 1, record: { n: 2 } }] });
    assert.deepEqual(await loadAll(db, 'companies'), [{ id: 'a', version: 2, record: { n: 2 } }]);
});

test('stale update throws and leaves another row in the same call unchanged', async () => {
    const db = await fresh();
    await ins(db, 'a');
    await ins(db, 'b');
    await writeRows(db, { companies: [{ id: 'a', version: 1, record: { n: 2 } }] });
    await assert.rejects(writeRows(db, { companies: [{ id: 'b', version: 1, record: { n: 9 } }, { id: 'a', version: 1, record: { n: 9 } }] }), stale);
    const rows = await loadSome(db, 'companies', ['a', 'b']);
    assert.deepEqual(rows.get('a'), { version: 2, record: { n: 2 } });
    assert.deepEqual(rows.get('b'), { version: 1, record: { n: 1 } });
});

test('stale delete throws and keeps the row; right-version delete removes it', async () => {
    const db = await fresh();
    await ins(db, 'a');
    await writeRows(db, { companies: [{ id: 'a', version: 1, record: { n: 2 } }] });
    await assert.rejects(writeRows(db, { companies: [{ id: 'a', version: 1, record: null }] }), stale);
    assert.equal((await loadAll(db, 'companies')).length, 1);
    await writeRows(db, { companies: [{ id: 'a', version: 2, record: null }] });
    assert.equal((await loadAll(db, 'companies')).length, 0);
});

test('update of a row deleted meanwhile throws', async () => {
    const db = await fresh();
    await ins(db, 'a');
    await writeRows(db, { companies: [{ id: 'a', version: 1, record: null }] });
    await assert.rejects(writeRows(db, { companies: [{ id: 'a', version: 1, record: { n: 2 } }] }), stale);
});

test('insert of an existing id throws', async () => {
    const db = await fresh();
    await ins(db, 'a');
    await assert.rejects(ins(db, 'a'), stale);
});

test('jsonLines returns stored text byte for byte, sorted, and pages', async () => {
    const db = await fresh();
    assert.deepEqual(await jsonLines(db, 'companies', {}), { text: '', next: null });
    for (const id of ['c', 'a', 'e', 'b', 'd']) await db.prepare('INSERT INTO companies (key, version, data) VALUES (?, 1, ?)').bind(id, `{"k":"${id}",  "x": 1}`).run();
    const all = await jsonLines(db, 'companies', {});
    assert.equal(all.text, ['a', 'b', 'c', 'd', 'e'].map((id) => `{"k":"${id}",  "x": 1}\n`).join(''));
    assert.equal(all.next, null);
    let text = '';
    let after = '';
    let pages = 0;
    do {
        const page = await jsonLines(db, 'companies', { after, limit: 2 });
        text += page.text;
        after = page.next;
        pages++;
    } while (after);
    assert.equal(pages, 3);
    assert.equal(text, all.text);
});

test('finishedRun with a stale company row writes nothing', async () => {
    const db = await fresh();
    await ins(db, 'a');
    await assert.rejects(writeRows(db, { companies: [{ id: 'a', version: 7, record: {} }], finishedRun: { run: 'r1', at: 't', result: {} } }), stale);
    assert.equal(await finishedResult(db, 'r1'), null);
});

test('finishedRun result is stored and returned', async () => {
    const db = await fresh();
    await writeRows(db, { finishedRun: { run: 'r1', at: 't', result: { changes: [1] } } });
    assert.deepEqual(await finishedResult(db, 'r1'), { changes: [1] });
});

test('history replaces one company only; loadHistory orders by company then n', async () => {
    const db = await fresh();
    const rows = (t) => [{ heading: 'h1', text: `${t}1` }, { heading: 'h2', text: `${t}2` }];
    await writeRows(db, { history: [{ companyKey: 'b', rows: rows('b') }, { companyKey: 'a', rows: rows('a') }] });
    assert.deepEqual((await loadHistory(db)).map((r) => `${r.companyKey}:${r.text}`), ['a:a1', 'a:a2', 'b:b1', 'b:b2']);
    await writeRows(db, { history: [{ companyKey: 'a', rows: [{ heading: 'x', text: 'new' }] }] });
    assert.deepEqual((await loadHistory(db, 'a')).map((r) => r.text), ['new']);
    assert.equal((await loadHistory(db, 'b')).length, 2);
    assert.equal((await historyLines(db, 'b')).split('\n').length, 3);
});

test('real errors are not reported as stale', async () => {
    const db = await fresh();
    const notStale = (e) => !e.stale && e.status !== 409;
    await assert.rejects(writeRows(db, { finishedRun: { run: 'r1', at: null, result: {} } }), notStale);
    await writeRows(db, { finishedRun: { run: 'r2', at: 't', result: {} } });
    await assert.rejects(writeRows(db, { finishedRun: { run: 'r2', at: 't', result: {} } }), notStale);
});

test('delta: rows written and ids deleted after a seq; a stale batch leaves the counter alone', async () => {
    const db = sqliteD1();
    await applySchema(db);
    await writeRows(db, { companies: [{ id: 'a', version: null, record: { key: 'a' } }, { id: 'b', version: null, record: { key: 'b' } }] });
    const since = await currentSeq(db);
    assert.equal(since, 1);
    assert.deepEqual(JSON.parse(await deltaJson(db, 'companies', since)), { seq: 1, deleted: [], rows: [] });
    await writeRows(db, { companies: [{ id: 'a', version: 1, record: { key: 'a', n: 2 } }, { id: 'b', version: 1, record: null }], postings: [{ id: 'p', version: null, record: { id: 'p' } }] });
    assert.deepEqual(JSON.parse(await deltaJson(db, 'companies', since)), { seq: 2, deleted: ['b'], rows: [{ key: 'a', n: 2 }] });
    assert.deepEqual(JSON.parse(await deltaJson(db, 'postings', since)), { seq: 2, deleted: [], rows: [{ id: 'p' }] });
    await assert.rejects(writeRows(db, { companies: [{ id: 'a', version: 1, record: {} }] }), stale);
    assert.equal(await currentSeq(db), 2);
    // Supplement and tune writes don't move the counter.
    await writeRows(db, { supplement: [{ id: 's', version: null, record: {} }] });
    assert.equal(await currentSeq(db), 2);
    await writeRows(db, { companies: [{ id: 'c', version: null, record: { key: 'c' } }] });
    assert.deepEqual(JSON.parse(await deltaJson(db, 'companies', 0, { limit: 1 })), { full: true }); // a and c changed
});
