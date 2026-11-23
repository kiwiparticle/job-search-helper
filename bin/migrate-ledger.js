#!/usr/bin/env node
// One-time: ledger.md + history.md + runs/*/report.json + asks/*.json -> D1 (or --sqlite <path>).
// Writes only when the gate passes; exits 1 and prints each problem otherwise. Run from the repo root.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { migrate, problems, oldPending } from '../lib/migrate.js';
import { loadAll, loadHistory, writeRows, jsonLines } from '../lib/store.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = opt('--repo') ?? process.cwd();
const read = (p, dflt) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), 'utf8') : dflt);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const hashOf = (bytes) => execFileSync('git', ['hash-object', '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
const hash = () => hashOf(readFileSync(join(repo, 'ledger.md')));
// The old page writes ledger.md on GitHub's main, so the local file is not enough: compare with origin/main too.
const remote = !args.includes('--no-remote');
const remoteSha = () => { git('fetch', '-q', 'origin', 'main'); return git('rev-parse', 'origin/main:ledger.md'); };
const fail = (lines) => { console.error(lines.map((l) => `- ${l}`).join('\n')); process.exit(1); };

const ledgerBytes = readFileSync(join(repo, 'ledger.md'));
const hashBefore = hashOf(ledgerBytes);
if (remote) {
    const sha = remoteSha();
    if (sha !== hashBefore) fail([`ledger.md here (${hashBefore}) is not origin/main's (${sha}); pull first`]);
}
const ledgerMd = ledgerBytes.toString('utf8');
const dir = (d) => (existsSync(join(repo, d)) ? readdirSync(join(repo, d)) : []);
const reports = dir('runs').filter((d) => existsSync(join(repo, 'runs', d, 'report.json'))).map((run) => ({ run, report: json(join(repo, 'runs', run, 'report.json')) }));
const threads = dir('asks').filter((f) => f.endsWith('.json')).map((f) => json(join(repo, 'asks', f)));
const aliases = JSON.parse(read('data/aliases.json', '{}'));

const result = migrate({ ledgerMd, historyMd: read('history.md', ''), reports, aliases, threads });
const bad = problems(result, { ledgerMd, oldPending: oldPending({ ledgerMd, reports, threads }), hashBefore, hashAfter: hash() });
if (remote) { const sha = remoteSha(); if (sha !== hashBefore) bad.push(`ledger.md on origin/main changed during the migration (${hashBefore} -> ${sha})`); }
if (bad.length) fail(bad);

let db;
if (opt('--sqlite')) {
    const { sqliteD1, applySchema } = await import('../test/sqliteD1.js');
    db = sqliteD1(opt('--sqlite'));
    await applySchema(db);
} else {
    db = (await import('./d1rest.js')).fromEnv();
}
if (remote) { const sha = remoteSha(); if (sha !== hashBefore) fail([`ledger.md on origin/main changed before writing (${hashBefore} -> ${sha})`]); }
for (const t of ['companies', 'postings', 'history']) {
    const { n } = await db.prepare(`SELECT count(*) AS n FROM ${t}`).first();
    if (n) fail([`refusing to migrate: table ${t} already has ${n} row(s)`]);
}

const rows = (list, k) => list.map((record) => ({ id: record[k], version: null, record }));
await writeRows(db, { companies: rows(result.companies, 'key'), postings: rows(result.postings, 'id'), history: result.history });

// Read back and compare with what was meant to be written.
const mismatches = [];
const compare = (what, want, got) => { if (JSON.stringify(want) !== JSON.stringify(got)) mismatches.push(`${what} read back differently`); };
const sorted = (list, k) => [...list].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0));
compare('companies', sorted(result.companies, 'key'), (await loadAll(db, 'companies')).map((r) => r.record));
compare('postings', sorted(result.postings, 'id'), (await loadAll(db, 'postings')).map((r) => r.record));
compare('history', sorted(result.history, 'companyKey').flatMap((h) => h.rows.map((r) => ({ companyKey: h.companyKey, ...r }))), await loadHistory(db));
if (mismatches.length) fail(mismatches);

const size = async (t) => { let n = 0; for (let after = ''; ;) { const p = await jsonLines(db, t, { after }); n += Buffer.byteLength(p.text); if (!p.next) return n; after = p.next; } };
const [companyBytes, postingBytes] = [await size('companies'), await size('postings')];

const { report: r } = result;
const list = (items) => (items.length ? items.map((n) => `- ${n}`).join('\n') : 'None');
const md = `# Migration report

## Summary
- Ledger rows: ${r.rows.in} in, ${r.rows.out} out (${r.rows.merges.length} merged by alias)
- Companies: ${r.counts.companies}; applications: ${r.counts.applied} applied, ${r.counts.rejected} rejected
- Finds: ${r.finds.in} in, ${r.finds.postings} postings, ${r.finds.merged.length} merged into one, ${r.finds.companyOnly.length} company-only
- Postings: ${r.counts.postings} (${r.counts.activeLeadStubs} migration stubs for Active lead rows)
- Jobs: ${r.counts.skippedJobs} skipped from Roles skipped, ${r.counts.savedJobs} saved from older leads
- Pending carried over: ${r.counts.held} held changes, ${r.counts.proposals} Ask proposals
- History: ${r.history.sections} sections, ${r.history.filed} filed (${r.history.rows} excerpts), ${r.history.unfiled} unfiled
- Size: companies ${companyBytes} bytes, postings ${postingBytes} bytes
- Gate: passed

## Merged by alias
${list(r.rows.merges)}

## Approximated dates
${list(r.approxDates)}

## "Role not recorded" applications
${list(r.notRecorded)}

## Active lead stubs
${list(r.stubs)}

## Watching with an open lead
${list(r.openLeads)}

## Check: possibly the applied role
${list(r.possiblyApplied)}

## Finds turned company-only
${list(r.finds.companyOnly)}

## Postings merged into one
${list(r.finds.merged)}

## Differing values when merging aliases
${list(r.diffs)}

## Rows with a wrong cell count (kept anyway)
${list(r.badRows)}

## Unfiled history
${list(result.unfiled.map((s) => s.heading))}
`;
mkdirSync(join(repo, 'data'), { recursive: true });
mkdirSync(join(repo, 'docs'), { recursive: true });
writeFileSync(join(repo, 'data/unfiled-history.jsonl'), result.unfiled.map((s) => `${JSON.stringify(s)}\n`).join(''));
writeFileSync(join(repo, 'docs/migration-report.md'), md);
console.log(md.split('\n## Merged by alias')[0]);
