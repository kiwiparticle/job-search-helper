#!/usr/bin/env node
// Script only, no model: lists new senior roles on tracked companies' own boards and saves them unjudged.
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { loadAll, writeRows } from '../lib/store.js';
import { sweepBoards } from '../lib/boardSweep.js';
import { sweepPostings } from '../lib/sweepPostings.js';
import { loadFilter, dropWords, roleTest } from '../lib/sweepFilter.js';

export async function run(db, { now, fetchImpl = fetch, lookup: dns = lookup, repoDir = fileURLToPath(new URL('..', import.meta.url)), filter = loadFilter(repoDir), drop = dropWords(repoDir), ghRun = process.env.GITHUB_RUN_ID }) {
    const run = `${now.slice(0, 10)}-sweep-${now.slice(11, 16).replace(':', '')}`;
    for (let attempt = 1; ; attempt++) {
        const companies = (await loadAll(db, 'companies')).map((r) => r.record);
        const rows = await loadAll(db, 'postings');
        const postings = rows.map((r) => r.record);
        const results = await sweepBoards({ companies, postings, dormant: now.slice(8, 10) === '01', drop, isRole: roleTest(filter) }, { fetchImpl, lookup: dns });
        const versions = new Map(rows.map((r) => [r.id, r.version]));
        const changes = sweepPostings({ companies, postings, results, run, filter }).map((record) => ({ id: record.id, version: versions.get(record.id) ?? null, record }));
        const added = changes.filter((c) => c.version === null).length;
        const summary = `${results.length} boards · ${added} new roles · ${changes.length - added} touched`;
        try {
            await writeRows(db, { postings: changes, finishedRun: { run: `sweep:${now}`, at: now, result: { ghRun, summary } } });
        } catch (e) {
            if (e.stale && attempt < 3) continue;
            throw e;
        }
        console.log(`sweep: ${summary}`);
        return changes;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await run(fromEnv(), { now: new Date().toISOString() });
}
