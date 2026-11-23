#!/usr/bin/env node
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { loadAll, writeRows } from '../lib/store.js';
import { resolveAll, applyResolutions } from '../lib/boardResolve.js';

// Finds the job board behind each tracked company's careers page and writes it. Redoes the whole pass when a row moved meanwhile.
export async function run(db, { today, fetchImpl = fetch, lookup: dns = lookup }) {
    for (let attempt = 1; ; attempt++) {
        const rows = await loadAll(db, 'companies');
        const postings = (await loadAll(db, 'postings')).map((r) => r.record);
        const results = await resolveAll({ companies: rows.map((r) => r.record), postings }, { fetchImpl, lookup: dns });
        const byKey = new Map(rows.map((r) => [r.record.key, r]));
        const found = results.filter((r) => r.board);
        const changes = found.flatMap(({ key, board }) => {
            const row = byKey.get(key);
            return row && applyResolutions(row.record, board, today) ? [{ id: row.id, version: row.version, record: row.record }] : [];
        });
        try {
            await writeRows(db, { companies: changes });
        } catch (e) {
            if (e.stale && attempt < 3) continue;
            throw e;
        }
        console.log(`resolver: ${results.length} tried, ${found.length} found, ${changes.length} written`);
        for (const { key, board } of found) console.log(`${key} -> ${board.url}`);
        return changes.length;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await run(fromEnv(), { today: new Date().toISOString().slice(0, 10) });
}
