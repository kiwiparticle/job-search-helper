#!/usr/bin/env node
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { loadAll, writeRows } from '../lib/store.js';
import { checkAll, prune } from '../lib/postingCheck.js';

// Checks postings, prunes on the 1st, writes only what changed. Redoes the whole pass when a row moved meanwhile.
export async function run(db, { today, fetchImpl = fetch, lookup: dns = lookup }) {
    for (let attempt = 1; ; attempt++) {
        const companies = (await loadAll(db, 'companies')).map((r) => r.record);
        const rows = await loadAll(db, 'postings');
        const before = new Map(rows.map((r) => [r.id, r]));
        let postings = await checkAll({ companies, postings: rows.map((r) => r.record) }, { today, fetchImpl, lookup: dns });
        if (today.slice(8, 10) === '01') postings = prune({ companies, postings }, today);
        const kept = new Set(postings.map((p) => p.id));
        const changes = [
            ...postings.flatMap((p) => {
                const old = before.get(p.id);
                return !old ? [{ id: p.id, version: null, record: p }]
                    : JSON.stringify(old.record) === JSON.stringify(p) ? [] : [{ id: p.id, version: old.version, record: p }];
            }),
            ...rows.filter((r) => !kept.has(r.id)).map((r) => ({ id: r.id, version: r.version, record: null })),
        ];
        try {
            await writeRows(db, { postings: changes });
        } catch (e) {
            if (e.stale && attempt < 3) continue;
            throw e;
        }
        const size = postings.reduce((n, p) => n + JSON.stringify(p).length, 0);
        console.log(`postings: ${postings.length} rows, ${size} bytes (${changes.length} written)`);
        return changes.length;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await run(fromEnv(), { today: new Date().toISOString().slice(0, 10) });
}
