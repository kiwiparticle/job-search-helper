#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { loadAll, loadHistory } from '../lib/store.js';
import { renderCompanies } from '../lib/companies.js';
import { renderPostings } from '../lib/postingsFile.js';

// The daily backup: D1 rows to data/*.jsonl, one record per line.
export async function exportData(db, repoDir) {
    const dir = join(repoDir, 'data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'companies.jsonl'), renderCompanies((await loadAll(db, 'companies')).map((r) => r.record)));
    writeFileSync(join(dir, 'postings.jsonl'), renderPostings((await loadAll(db, 'postings')).map((r) => r.record)));
    writeFileSync(join(dir, 'supplement.jsonl'), (await loadAll(db, 'supplement')).map((r) => `${JSON.stringify(r.record)}\n`).join(''));
    writeFileSync(join(dir, 'history.jsonl'), (await loadHistory(db)).map((h) => `${JSON.stringify(h)}\n`).join(''));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (!process.argv[2]) { console.error('usage: export-data.js <repoDir>'); process.exit(2); }
    await exportData(fromEnv(), process.argv[2]);
}
