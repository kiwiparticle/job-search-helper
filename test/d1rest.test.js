import { test } from 'node:test';
import assert from 'node:assert/strict';
import { d1rest, fromEnv } from '../bin/d1rest.js';

const fake = (reply, status = 200) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return { ok: status < 400, status, json: async () => reply };
    };
    return { calls, db: d1rest({ accountId: 'acc', databaseId: 'dbid', token: 'tok', fetchImpl }) };
};

test('single statement request shape', async () => {
    const { calls, db } = fake({ success: true, result: [{ results: [{ a: 1 }], meta: { changes: 0 } }] });
    assert.deepEqual(await db.prepare('SELECT ? AS a').bind(1).all(), { results: [{ a: 1 }] });
    assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc/d1/database/dbid/query');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(calls[0].init.body), { sql: 'SELECT ? AS a', params: [1] });
});

test('batch sends {batch:[{sql,params}]} and returns per-statement results', async () => {
    const { calls, db } = fake({ success: true, result: [{ results: [], meta: { changes: 1 } }, { results: [], meta: { changes: 1 } }] });
    const out = await db.batch([db.prepare('INSERT INTO t VALUES (?)').bind(1), db.prepare('DELETE FROM t')]);
    assert.deepEqual(JSON.parse(calls[0].init.body), { batch: [{ sql: 'INSERT INTO t VALUES (?)', params: [1] }, { sql: 'DELETE FROM t', params: [] }] });
    assert.equal(out.length, 2);
});

test('first and run read the first result', async () => {
    const { db } = fake({ success: true, result: [{ results: [{ x: 1 }], meta: { changes: 3 } }] });
    assert.deepEqual(await db.prepare('s').first(), { x: 1 });
    assert.deepEqual(await db.prepare('s').run(), { meta: { changes: 3 } });
});

test('API error rejects with the API message', async () => {
    const { db } = fake({ success: false, errors: [{ code: 7500, message: 'CHECK constraint failed: ok' }] }, 400);
    await assert.rejects(db.prepare('x').all(), /CHECK constraint failed: ok/);
});

test('fromEnv names every missing variable', () => {
    assert.throws(() => fromEnv({}), (e) => ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'].every((n) => e.message.includes(n)));
});

test('API error carries status and the D1 code', async () => {
    const { db } = fake({ success: false, errors: [{ code: 7500, message: 'boom' }] }, 400);
    await assert.rejects(db.prepare('x').all(), (e) => e.status === 400 && e.code === 7500);
});
