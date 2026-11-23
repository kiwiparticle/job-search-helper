#!/usr/bin/env node
// find-boards.yml finish: for each page the browser opened, the one job board its requests and links point at; a board
// whose API answers becomes the company's jobsUrl (like resolve-links.js). Usage: find-boards-finish.js <targets dir> <observed dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { loadAll, writeRows } from '../lib/store.js';
import { pickBoard, boardUrl, applyResolutions } from '../lib/boardResolve.js';
import { knownBoard, fetchRoles } from '../lib/boardSweep.js';
import { pool } from '../lib/postingCheck.js';

export async function run(db, { targets, observed, today, deps }) {
    const asked = new Set(targets.map((t) => t.key));
    const found = new Map();
    const list = (Array.isArray(observed) ? observed : []).filter((o) => o && asked.has(o.key) && Array.isArray(o.seen));
    await pool(list.map((o) => ({ o })), 6, async ({ o }) => {
        const board = pickBoard(o.seen.filter((u) => typeof u === 'string').slice(0, 400));
        if (board && (await fetchRoles(board, deps)) !== null) found.set(o.key, { ...board, url: boardUrl(board) });
    });
    for (let attempt = 1; ; attempt++) {
        const rows = await loadAll(db, 'companies');
        const postings = (await loadAll(db, 'postings')).map((r) => r.record);
        const changes = rows.flatMap((row) => {
            const board = found.get(row.record.key);
            return board && !knownBoard(row.record, postings) && applyResolutions(row.record, board, today) ? [{ id: row.id, version: row.version, record: row.record }] : [];
        });
        try {
            await writeRows(db, { companies: changes });
        } catch (e) {
            if (e.stale && attempt < 3) continue;
            throw e;
        }
        console.log(`browser board finder: ${list.length} pages, ${found.size} boards found, ${changes.length} written`);
        for (const [key, b] of found) console.log(`${key} -> ${b.url}`);
        return changes.length;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [tDir, oDir] = process.argv.slice(2);
    const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; } };
    await run(fromEnv(), { targets: read(join(tDir, 'targets.json')), observed: read(join(oDir, 'observed.json')), today: new Date().toISOString().slice(0, 10), deps: { fetchImpl: fetch, lookup } });
}
