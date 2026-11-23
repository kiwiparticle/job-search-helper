// Versioned row storage on a D1-shaped db (prepare/bind/all/first/run, batch, exec). No node: imports.
export const TABLES = { companies: 'key', postings: 'id', supplement: 'id', tune: 'id' };
export const READ_PAGE_ROWS = 700;

const keyCol = (table) => {
    const col = TABLES[table];
    if (!col) throw new Error(`unknown table ${table}`);
    return col;
};

export async function loadAll(db, table) {
    const k = keyCol(table);
    const { results } = await db.prepare(`SELECT ${k} AS id, version, data FROM ${table} ORDER BY ${k}`).all();
    return results.map((r) => ({ id: r.id, version: r.version, record: JSON.parse(r.data) }));
}

export async function loadSome(db, table, ids) {
    const out = new Map();
    if (!ids.length) return out;
    const k = keyCol(table);
    const { results } = await db.prepare(`SELECT ${k} AS id, version, data FROM ${table} WHERE ${k} IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const r of results) out.set(r.id, { version: r.version, record: JSON.parse(r.data) });
    return out;
}

export async function jsonLines(db, table, { after = '', limit = READ_PAGE_ROWS } = {}) {
    const k = keyCol(table);
    const { results } = await db.prepare(`SELECT ${k} AS id, data FROM ${table} WHERE ${k} > ? ORDER BY ${k} LIMIT ?`).bind(after, Number(limit)).all();
    return {
        text: results.map((r) => `${r.data}\n`).join(''),
        next: results.length && results.length >= Number(limit) ? results[results.length - 1].id : null,
    };
}

// Tables the page reads by delta: rows carry `seq`, deletes leave a row in `deleted`.
const SEQ_TABLES = ['companies', 'postings'];

// The write counter now. The page keeps it with a full load and asks for rows past it next time.
export async function currentSeq(db) {
    return Number((await db.prepare('SELECT seq FROM meta WHERE id = 1').first())?.seq ?? 0);
}

// Rows written and ids deleted after `since`, as one JSON text { seq, deleted, rows }. Rows stay the stored JSON text, unparsed.
// More than `limit` changed rows gives { full: true }: the page reloads the table instead.
export async function deltaJson(db, table, since, { limit = READ_PAGE_ROWS } = {}) {
    const k = keyCol(table);
    if (!SEQ_TABLES.includes(table)) throw new Error(`no delta for ${table}`);
    const seq = await currentSeq(db); // read first: a write landing after it is fetched again next time, never missed
    const { results } = await db.prepare(`SELECT data FROM ${table} WHERE seq > ? LIMIT ?`).bind(since, limit + 1).all();
    if (results.length > limit) return JSON.stringify({ full: true });
    const gone = (await db.prepare('SELECT id FROM deleted WHERE tbl = ? AND seq > ?').bind(table, since).all()).results.map((r) => r.id);
    return `{"seq":${seq},"deleted":${JSON.stringify(gone)},"rows":[${results.map((r) => r.data).join(',')}]}`;
}

export async function loadHistory(db, companyKey) {
    const q = companyKey === undefined
        ? db.prepare('SELECT company_key, data FROM history ORDER BY company_key, n')
        : db.prepare('SELECT company_key, data FROM history WHERE company_key = ? ORDER BY company_key, n').bind(companyKey);
    const { results } = await q.all();
    return results.map((r) => ({ companyKey: r.company_key, ...JSON.parse(r.data) }));
}

export async function historyLines(db, companyKey) {
    const { results } = await db.prepare('SELECT data FROM history WHERE company_key = ? ORDER BY n').bind(companyKey).all();
    return results.map((r) => `${r.data}\n`).join('');
}

// Aborts the batch (CHECK failure) when the statement before it changed no row.
const GUARD = 'INSERT INTO guard (ok) SELECT 0 WHERE changes() = 0';

export async function writeRows(db, { companies = [], postings = [], supplement = [], tune = [], history = [], finishedRun } = {}) {
    const stmts = [];
    // Companies and postings rows get the batch's seq, one bump per batch (see deltaJson).
    if (companies.length || postings.length) stmts.push(db.prepare('UPDATE meta SET seq = seq + 1 WHERE id = 1'));
    for (const [table, rows] of [['companies', companies], ['postings', postings], ['supplement', supplement], ['tune', tune]]) {
        const k = keyCol(table);
        const seq = SEQ_TABLES.includes(table);
        for (const { id, version, record } of rows) {
            if (version === null) {
                stmts.push(db.prepare(seq
                    ? `INSERT INTO ${table} (${k}, version, data, seq) VALUES (?, 1, ?, (SELECT seq FROM meta WHERE id = 1))`
                    : `INSERT INTO ${table} (${k}, version, data) VALUES (?, 1, ?)`).bind(id, JSON.stringify(record)));
            } else if (record === null) {
                stmts.push(db.prepare(`DELETE FROM ${table} WHERE ${k} = ? AND version = ?`).bind(id, version), db.prepare(GUARD));
                if (seq) stmts.push(db.prepare('INSERT OR REPLACE INTO deleted (tbl, id, seq) VALUES (?, ?, (SELECT seq FROM meta WHERE id = 1))').bind(table, id));
            } else {
                stmts.push(db.prepare(`UPDATE ${table} SET version = version + 1, data = ?${seq ? ', seq = (SELECT seq FROM meta WHERE id = 1)' : ''} WHERE ${k} = ? AND version = ?`).bind(JSON.stringify(record), id, version), db.prepare(GUARD));
            }
        }
    }
    for (const { companyKey, rows } of history) {
        stmts.push(db.prepare('DELETE FROM history WHERE company_key = ?').bind(companyKey));
        rows.forEach((row, i) => stmts.push(db.prepare('INSERT INTO history (company_key, n, data) VALUES (?, ?, ?)').bind(companyKey, i + 1, JSON.stringify(row))));
    }
    if (finishedRun) {
        stmts.push(db.prepare('INSERT INTO finished_runs (run, at, result) VALUES (?, ?, ?)').bind(finishedRun.run, finishedRun.at, JSON.stringify(finishedRun.result)));
    }
    if (!stmts.length) return;
    try {
        await db.batch(stmts);
        // A page action's db carries `written`, so the reply can hand the page the rows it changed (handleAction).
        if (db.written) for (const [table, rows] of [['companies', companies], ['postings', postings]]) for (const { id, record } of rows) db.written.push({ table, id, record });
    } catch (e) {
        // Only the stale guard (CHECK on guard.ok) and a duplicate row id mean "stale"; any other failure is a real error.
        if (/CHECK constraint failed: ok\b|UNIQUE constraint failed: (companies\.key|postings\.id|supplement\.id|tune\.id)\b/.test(String(e?.message))) throw Object.assign(new Error('stale write'), { status: 409, stale: true });
        throw e;
    }
}

export async function finishedResult(db, run) {
    const row = await db.prepare('SELECT result FROM finished_runs WHERE run = ?').bind(run).first();
    return row ? JSON.parse(row.result) : null;
}
