#!/usr/bin/env node
// Rollback: D1 companies and postings -> ledger.md (keeps the current ledger.md's header and footer if present).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { parseLedger, exportLedger } from '../lib/ledger.js';
import { loadAll } from '../lib/store.js';

export async function exportToFile(db, repo) {
    const path = join(repo, 'ledger.md');
    const old = existsSync(path) ? parseLedger(readFileSync(path, 'utf8')) : {};
    const [companies, postings] = await Promise.all([loadAll(db, 'companies'), loadAll(db, 'postings')]);
    writeFileSync(path, exportLedger(companies.map((r) => r.record), postings.map((r) => r.record), { before: old.before, after: old.after }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    await exportToFile(fromEnv(), args.includes('--repo') ? args[args.indexOf('--repo') + 1] : process.cwd());
}
