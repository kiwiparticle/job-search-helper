import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, problems, oldPending, splitRoles, appliedDate, rejectedDate } from '../lib/migrate.js';
import { COLUMNS } from '../lib/ledger.js';
import { hasActiveLead } from '../lib/tags.js';
import { newQueue } from '../lib/newQueue.js';
import { sqliteD1, applySchema } from './sqliteD1.js';

const HEAD = `# L\n\n| ${COLUMNS.join(' | ')} |\n| ${COLUMNS.map(() => '---').join(' | ')} |\n`;
const row = (name, status, o = {}) => `| ${[name, status, o.verdict ?? '', '', '', '', o.skipped ?? '', o.reason ?? '', '', o.checked ?? '2026-11-01'].join(' | ')} |\n`;
const ledger = (...rows) => HEAD + rows.join('');
const gh = (n) => `https://boards.greenhouse.io/acme/jobs/${n}`;
const rep = (run, finishedAt, leads = [], nearMisses = [], extra = {}) => ({ run, report: { run, finishedAt, leads, nearMisses, held: [], ...extra } });
const lead = (o = {}) => ({ key: 'acme::staff', company: 'Acme', role: 'Staff', url: gh(1), ...o });
const by = (r, name) => r.companies.find((c) => c.name === name);

test('one row per status maps to the stance and applications', () => {
    const md = ledger(
        row('A', 'Applied', { verdict: 'Applied 2026-10-01' }), row('B', 'Rejected', { reason: 'Rejected 2026-10-05' }),
        row('C', 'Ruled out (company)'), row('D', 'Active lead'), row('E', 'Skip current role'),
        row('F', 'Watching'), row('G', 'Dormant'), row('H', 'To review'),
    );
    const r = migrate({ ledgerMd: md });
    assert.deepEqual(r.companies.map((c) => c.stance), ['Watching', 'Watching', 'Ruled out', 'Watching', 'Watching', 'Watching', 'Dormant', 'To review']);
    assert.deepEqual(by(r, 'A').applications.map((a) => [a.outcome, a.appliedOn, a.role]), [['applied', '2026-10-01', 'Role not recorded']]);
    assert.deepEqual(by(r, 'B').applications.map((a) => [a.outcome, a.outcomeOn]), [['rejected', '2026-10-05']]);
    assert.equal(by(r, 'C').applications.length, 0);
});

test('application dates: explicit, "around", and Last checked fallback', () => {
    assert.deepEqual(appliedDate({ Verdict: 'Applied around 2026-10-12', Reason: '', 'Last checked': '2026-11-01' }), { date: '2026-10-12', approx: true });
    assert.deepEqual(appliedDate({ Verdict: 'x', Reason: 'Applied 2026-10-13.', 'Last checked': '2026-11-01' }), { date: '2026-10-13', approx: false });
    assert.deepEqual(appliedDate({ Verdict: 'Applied (user-confirmed)', Reason: '', 'Last checked': '2026-10-30 (approx.)' }), { date: '2026-10-30', approx: true });
    assert.deepEqual(rejectedDate({ Verdict: 'Rejected 2026-10-20', Reason: '', 'Last checked': '' }), { date: '2026-10-20', approx: false });
    const r = migrate({ ledgerMd: ledger(row('A', 'Applied', { verdict: 'Applied (user-confirmed)', checked: '2026-10-30 (approx.)' })) });
    assert.equal(by(r, 'A').lastChecked, '2026-10-30');
    assert.equal(by(r, 'A').applications[0].approx, true);
    assert.deepEqual(r.report.approxDates.length, 1);
});

test('splitRoles ignores semicolons inside parentheses', () => {
    assert.deepEqual(splitRoles('A (x; y); ; B'), ['A (x; y)', 'B']);
});

test('applied role comes from the "(applied" entry and is not marked skipped', () => {
    const md = ledger(row('Colloquy', 'Applied', { skipped: 'Staff Software Engineer (applied 2026-11-03); Data Engineer (too junior; no remote)', checked: '2026-11-03' }));
    const c = by(migrate({ ledgerMd: md }), 'Colloquy');
    assert.equal(c.applications[0].role, 'Staff Software Engineer');
    assert.deepEqual(c.rolesSkipped, ['Data Engineer (too junior; no remote)']);
    assert.equal(c.applications[0].url, undefined);
});

test('an Active lead row with no posting gets a saved job and a stub posting', () => {
    const r = migrate({ ledgerMd: ledger(row('Zelvi', 'Active lead')) });
    const c = by(r, 'Zelvi');
    const [p] = r.postings;
    assert.equal(r.postings.length, 1);
    assert.deepEqual([p.source, p.wasLead, p.posted, p.role], ['migration', true, 'unknown', 'Role not recorded']);
    assert.equal(c.jobs[p.id].state, 'saved');
    assert.equal(hasActiveLead(c, r.postings), true);
    assert.deepEqual(problems(r, { ledgerMd: ledger(row('Zelvi', 'Active lead')) }), []);
});

test('roles skipped: a matching posting becomes a skipped job; a near name stays text', () => {
    const md = ledger(row('Acme', 'Watching', { skipped: 'Staff (remote only in EU); Senior SWE, Applied AI' }));
    const reports = [rep('2026-11-01-daily', '2026-11-01T10:00:00Z', [lead(), lead({ key: 'acme::ai', role: 'Senior Software Engineer, Applied AI', url: gh(2) })])];
    const r = migrate({ ledgerMd: md, reports });
    const c = by(r, 'Acme');
    assert.deepEqual(Object.values(c.jobs).map((j) => [j.state, j.role]), [['skipped', 'Staff']]);
    assert.deepEqual(c.rolesSkipped, ['Senior SWE, Applied AI']);
});

test('postings come from every report; the three newest runs stay new, older undisputed leads are saved', () => {
    const runs = ['01', '02', '03', '04'].map((d, i) => rep(`2026-11-${d}-daily`, `2026-11-${d}T10:00:00Z`, [lead({ key: `acme::r${i}`, role: `Role ${i}`, url: gh(10 + i), disputed: i === 1 })]));
    const r = migrate({ ledgerMd: ledger(row('Acme', 'Watching')), reports: runs });
    const c = by(r, 'Acme');
    assert.equal(r.postings.length, 4);
    const state = (role) => c.jobs[r.postings.find((p) => p.role === role).id]?.state;
    assert.deepEqual([0, 1, 2, 3].map((i) => state(`Role ${i}`)), ['saved', undefined, undefined, undefined]);
    assert.equal(r.report.finds.in, 4);
});

test('pending held changes and Ask proposals become field-level shapes with base from the row', () => {
    const before = { Company: 'Acme', Status: 'Watching', Verdict: 'Skip', Fingerprint: '', Domain: '', Awards: '', 'Roles skipped': '', Reason: 'old', 'Re-check trigger': '', 'Last checked': '2026-10-01' };
    const held = { company: 'Acme', before, after: { ...before, Status: 'Dormant', Reason: 'new' }, by: 'codex', codex: { ...before, Status: 'Dormant', Reason: 'new' }, reason: 'Only one model finished this run' };
    const threads = [{ company: 'Acme', messages: [{ by: 'owner', text: 'q', at: 't' }, { by: 'claude', text: 'Try this.\nmore', at: 't1', proposal: { patch: { company: 'Acme', status: 'Ruled out (company)', roles_skipped: 'Staff' }, before: null, status: 'open' } }, { by: 'codex', text: 'done', at: 't2', proposal: { patch: { company: 'Acme', reason: 'x' }, status: 'applied' } }] }];
    const md = ledger(row('Acme', 'Watching', { verdict: 'Skip', reason: 'old', checked: '2026-10-01' }));
    const reports = [rep('2026-11-01-daily', '2026-11-01T10:00:00Z', [], [], { held: [held] })];
    const r = migrate({ ledgerMd: md, reports, threads });
    const c = by(r, 'Acme');
    assert.deepEqual(c.heldUpdate, { run: '2026-11-01-daily', reason: 'Only one model finished this run', base: { stance: 'Watching', reason: 'old' }, proposed: { codex: { stance: 'Dormant', reason: 'new' } } });
    assert.equal(c.proposals.length, 1);
    assert.deepEqual(c.proposals[0].changes, { stance: 'Ruled out', rolesSkipped: ['Staff'] });
    assert.deepEqual(c.proposals[0].base, { stance: 'Watching', rolesSkipped: [] });
    assert.equal(c.proposals[0].text, 'Try this.');
    const q = newQueue(r.companies, r.postings);
    assert.deepEqual(q.map((i) => i.kind).sort(), ['proposal']);
    assert.deepEqual(problems(r, { ledgerMd: md, oldPending: oldPending({ ledgerMd: md, reports, threads }) }), []);
});

test('a held change whose before no longer matches the row is not pending', () => {
    const md = ledger(row('Acme', 'Watching', { reason: 'now' }));
    const held = { company: 'Acme', before: { Company: 'Acme', Status: 'Watching', Reason: 'then' }, after: { Status: 'Dormant' }, by: 'codex' };
    const reports = [rep('2026-11-01-daily', '2026-11-01T10:00:00Z', [], [], { held: [held] })];
    assert.equal(oldPending({ ledgerMd: md, reports }).held.length, 0);
});

const quillfeather = ledger(row('Quillfeather PBC', 'Watching'), row('Quillfeather', 'Watching'));
test('Quillfeather vs Quillfeather PBC: unresolved without aliases, one record with them', () => {
    const bad = migrate({ ledgerMd: quillfeather });
    assert.deepEqual(bad.report.unresolved, ['Quillfeather', 'Quillfeather PBC']);
    assert.ok(problems(bad, { ledgerMd: quillfeather }).some((p) => /unresolved/.test(p)));
    const ok = migrate({ ledgerMd: quillfeather, aliases: { same: [['Quillfeather PBC', 'Quillfeather']] } });
    assert.equal(ok.companies.length, 1);
    assert.deepEqual(ok.companies[0].aliases, ['Quillfeather']);
    assert.deepEqual(problems(ok, { ledgerMd: quillfeather }), []);
});

test('history is filed by whole-word company name under capped excerpts; the rest is unfiled', () => {
    const md = ledger(row('Lanternby Software (Holdco subsidiary)', 'Watching'));
    const r = migrate({ ledgerMd: md, historyMd: '## Daily — 2026-11-01\nLooked at Lanternby Software today.\n\n## Other — 2026-11-02\nNothing.\n' });
    assert.equal(r.history.length, 1);
    assert.equal(r.history[0].companyKey, by(r, 'Lanternby Software (Holdco subsidiary)').key);
    assert.match(r.history[0].rows[0].text, /Lanternby Software today/);
    assert.deepEqual(r.unfiled.map((s) => s.heading), ['Other — 2026-11-02']);
});

test('gate fails when a ledger row has no record', () => {
    const md = ledger(row('Acme', 'Watching'), row('Beta', 'Watching'));
    const r = migrate({ ledgerMd: md });
    r.companies = r.companies.filter((c) => c.name !== 'Beta');
    assert.ok(problems(r, { ledgerMd: md }).some((p) => /no record: Beta/.test(p)));
});

test('gate fails when the export status differs, and when the ledger hash changed', () => {
    const md = ledger(row('Acme', 'Watching'));
    const r = migrate({ ledgerMd: md });
    r.companies[0].stance = 'Dormant';
    assert.ok(problems(r, { ledgerMd: md }).some((p) => /export Status differs for Acme/.test(p)));
    r.companies[0].stance = 'Watching';
    assert.ok(problems(r, { ledgerMd: md, hashBefore: 'a', hashAfter: 'b' }).some((p) => /ledger.md changed/.test(p)));
    assert.deepEqual(problems(r, { ledgerMd: md, hashBefore: 'a', hashAfter: 'a' }), []);
});

test('gate fails when an application has no date', () => {
    const md = ledger(row('Acme', 'Applied', { checked: 'sometime' }));
    assert.ok(problems(migrate({ ledgerMd: md }), { ledgerMd: md }).some((p) => /application without a date: Acme/.test(p)));
});

const script = new URL('../bin/migrate-ledger.js', import.meta.url).pathname;
const fakeRepo = () => {
    const d = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(d, 'ledger.md'), quillfeather);
    writeFileSync(join(d, 'history.md'), '## X\nQuillfeather PBC news\n\n## Y\nnothing\n');
    mkdirSync(join(d, 'runs/2026-11-14-daily'), { recursive: true });
    writeFileSync(join(d, 'runs/2026-11-14-daily/report.json'), JSON.stringify({ run: 'r1', finishedAt: '2026-11-14T10:00:00Z', leads: [], nearMisses: [] }));
    mkdirSync(join(d, 'data'));
    writeFileSync(join(d, 'data/aliases.json'), JSON.stringify({ same: [['Quillfeather PBC', 'Quillfeather']] }));
    return d;
};
const cli = (cwd, ...a) => spawnSync('node', [script, ...(a.includes('--remote') ? a.filter((x) => x !== '--remote') : [...a, '--no-remote'])], { cwd, encoding: 'utf8' });

test('script: writes to a local SQLite file, reads back, writes the report; a second run refuses', async () => {
    const d = fakeRepo();
    const db = join(d, 'x.db');
    const ok = cli(d, '--sqlite', db);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(readFileSync(join(d, 'docs/migration-report.md'), 'utf8'), /Gate: passed/);
    assert.equal(readFileSync(join(d, 'data/unfiled-history.jsonl'), 'utf8').trim().split('\n').length, 1);
    const again = cli(d, '--sqlite', db);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /table companies already has 1 row/);
});

test('script: refuses a database whose companies table has a row, and writes nothing else', async () => {
    const d = fakeRepo();
    const path = join(d, 'full.db');
    const db = sqliteD1(path);
    await applySchema(db);
    await db.prepare("INSERT INTO companies (key, version, data) VALUES ('x', 1, '{}')").run();
    const r = cli(d, '--sqlite', path);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to migrate: table companies already has 1 row/);
    assert.equal(existsSync(join(d, 'docs/migration-report.md')), false);
});

test('script: exits 1 and prints the problem when the gate fails', () => {
    const d = fakeRepo();
    writeFileSync(join(d, 'data/aliases.json'), '{}');
    const r = cli(d, '--sqlite', join(d, 'y.db'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unresolved name pairs: Quillfeather, Quillfeather PBC/);
    assert.equal(existsSync(join(d, 'y.db')), false);
});

test('gate: a dispute shown as a lead passes; a Watching row with an open lead may export as Active lead and is listed', () => {
    const md = ledger(row('Acme', 'Watching'), row('Beta', 'Watching'));
    const reports = [rep('2026-11-01-daily', '2026-11-01T10:00:00Z', [lead()])];
    const r = migrate({ ledgerMd: md, reports });
    const pending = { disputed: [{ company: 'Acme', key: 'acme::staff', role: 'Staff', url: gh(1) }], held: [], proposals: [] };
    assert.deepEqual(problems(r, { ledgerMd: md, oldPending: pending }), []);
    assert.deepEqual(r.report.openLeads, ['Acme']);
    r.companies.find((c) => c.name === 'Beta').stance = 'Dormant';
    assert.ok(problems(r, { ledgerMd: md }).some((p) => /Beta/.test(p)));
});

test('applied company with no recorded role lists its remaining skipped entries for the owner', () => {
    const r = migrate({ ledgerMd: ledger(row('Colloquy', 'Applied', { skipped: 'Staff Software Engineer', checked: '2026-11-06' })) });
    assert.deepEqual(r.report.possiblyApplied, ['Colloquy: Staff Software Engineer']);
});

test('rollback.sh --yes: reverts, exports, moves post-tag run folders and updates the index', () => {
    const d = mkdtempSync(join(tmpdir(), 'rb-'));
    const sh = (cmd) => spawnSync('bash', ['-c', cmd], { cwd: d, encoding: 'utf8' });
    mkdirSync(join(d, 'bin'));
    mkdirSync(join(d, 'runs/old'), { recursive: true });
    writeFileSync(join(d, 'runs/old/report.json'), '{}');
    writeFileSync(join(d, 'runs/index.json'), JSON.stringify([{ run: 'old' }]));
    writeFileSync(join(d, 'app.txt'), 'v1\n');
    writeFileSync(join(d, 'package.json'), '{"type":"commonjs"}');
    copyFileSync(new URL('../bin/rollback.sh', import.meta.url).pathname, join(d, 'bin/rollback.sh'));
    assert.equal(sh('git init -q && git config user.email a@b && git config user.name n && git add -A && git commit -qm base && git tag pre-redesign').status, 0);
    writeFileSync(join(d, 'app.txt'), 'v2\n');
    writeFileSync(join(d, 'bin/export-ledger.js'), "const fs = require('node:fs'); const r = process.argv[process.argv.indexOf('--repo') + 1]; fs.writeFileSync(r + '/ledger.md', 'exported\\n');\n");
    assert.equal(sh('git add -A && git commit -qm cutover').status, 0);
    mkdirSync(join(d, 'runs/new'));
    writeFileSync(join(d, 'runs/new/report.json'), '{}');
    writeFileSync(join(d, 'runs/index.json'), JSON.stringify([{ run: 'new' }, { run: 'old' }]));
    assert.equal(sh('git add -A && git commit -qm run').status, 0);
    const dry = sh('bash bin/rollback.sh');
    assert.match(dry.stdout, /Nothing was run/);
    assert.equal(readFileSync(join(d, 'app.txt'), 'utf8'), 'v2\n');
    const r = sh('bash bin/rollback.sh --yes');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(join(d, 'app.txt'), 'utf8'), 'v1\n');
    assert.equal(readFileSync(join(d, 'ledger.md'), 'utf8'), 'exported\n');
    assert.ok(!existsSync(join(d, 'bin/export-ledger.js')), 'the revert removed the v2 export script, which ran before it');
    assert.ok(existsSync(join(d, 'runs-v2/new/report.json')) && !existsSync(join(d, 'runs/new')));
    assert.deepEqual(JSON.parse(readFileSync(join(d, 'runs/index.json'), 'utf8')), [{ run: 'old' }]);
});

test('a posting the old board showed as an open dispute is never auto-saved, even when old', () => {
    const runs = ['01', '02', '03', '04', '05'].map((d, i) => rep(`2026-11-${d}-daily`, `2026-11-${d}T10:00:00Z`, i === 0 ? [lead({ disputed: true })] : i === 1 ? [lead()] : []));
    const md = ledger(row('Acme', 'Watching'));
    const r = migrate({ ledgerMd: md, reports: runs });
    assert.deepEqual(by(r, 'Acme').jobs, {});
    assert.ok(newQueue(r.companies, r.postings).some((q) => q.kind === 'lead'));
    assert.deepEqual(problems(r, { ledgerMd: md, oldPending: oldPending({ ledgerMd: md, reports: runs }) }), []);
});

const rolesFor = (skipped, leads) => {
    const r = migrate({ ledgerMd: ledger(row('Acme', 'Watching', { skipped })), reports: [rep('2026-11-01-daily', '2026-11-01T10:00:00Z', leads)] });
    return { c: by(r, 'Acme'), r };
};
const wd = (n, role) => lead({ key: `acme::${role}`, role, url: `https://acme.wd1.myworkdayjobs.com/en/job/Remote/${role.replace(/\W+/g, '-')}_REQ${n}` });

test('roles skipped: a requisition id picks only the posting with that id (Lyceum Board)', () => {
    const { c, r } = rolesFor('Lead Full Stack Engineer, Create (REQ002909, closed 2026-11-14); Other (x)', [wd('002407', 'Full Stack Engineer (REQ002407)'), wd('002909', 'Lead Full Stack Engineer, Create')]);
    const skipped = Object.entries(c.jobs).filter(([, j]) => j.state === 'skipped').map(([id]) => id);
    assert.deepEqual(skipped, ['workday:REQ002909']);
    assert.deepEqual(c.rolesSkipped, ['Other (x)']);
    assert.ok(r.postings.some((p) => p.id === 'workday:REQ002407'));
});

test('roles skipped: exact role wins over a longer one (Sailcloth Health)', () => {
    const { c } = rolesFor('Staff Software Engineer, Eligibility & Benefits', [lead({ key: 'a', role: 'Staff Software Engineer', url: gh(1) }), lead({ key: 'b', role: 'Staff Software Engineer, Eligibility & Benefits', url: gh(2) })]);
    assert.deepEqual(Object.keys(c.jobs), ['greenhouse:2']);
});

test('roles skipped: an ambiguous entry stays text, and a non-senior entry does not hide the senior posting (Patchly)', () => {
    const amb = rolesFor('Software Engineer', [lead({ key: 'a', role: 'Senior Software Engineer', url: gh(1) }), lead({ key: 'b', role: 'Staff Software Engineer', url: gh(2) })]);
    assert.deepEqual(amb.c.jobs, {});
    assert.deepEqual(amb.c.rolesSkipped, ['Software Engineer']);
    const one = rolesFor('Software Engineer - Agent Team (non-senior; $122k-$160k max below $170k floor)', [lead({ key: 'a', role: 'Senior Software Engineer – Agent Team', url: gh(1) })]);
    assert.deepEqual(one.c.jobs, {});
    assert.deepEqual(one.c.rolesSkipped, ['Software Engineer - Agent Team (non-senior; $122k-$160k max below $170k floor)']);
    const sr = rolesFor('Sr. Software Engineer', [lead({ key: 'a', role: 'Senior Software Engineer', url: gh(1) })]);
    assert.equal(sr.c.jobs['greenhouse:1']?.state, 'skipped');
});

test('a converted entry keeps its reason text and the export gives it back unchanged', async () => {
    const entry = 'Staff (remote only in EU; $98k)';
    const { c, r } = rolesFor(entry, [lead()]);
    assert.equal(Object.values(c.jobs)[0].note, entry);
    const { exportLedger } = await import('../lib/ledger.js');
    const { parseLedger } = await import('../lib/ledger.js');
    assert.equal(parseLedger(exportLedger(r.companies, r.postings)).rows[0]['Roles skipped'], entry);
});

import { execFileSync } from 'node:child_process';
test('ledger sha: origin/main must match at the start; a change on origin makes the script exit 1', () => {
    const d = fakeRepo();
    const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
    const origin = mkdtempSync(join(tmpdir(), 'origin-'));
    g(origin, 'init', '-q', '--bare', '-b', 'main');
    g(d, 'init', '-q', '-b', 'main');
    g(d, 'config', 'user.email', 'a@b'); g(d, 'config', 'user.name', 'n');
    g(d, 'add', '-A'); g(d, 'commit', '-qm', 'base');
    g(d, 'remote', 'add', 'origin', origin); g(d, 'push', '-q', 'origin', 'main');
    const ok = cli(d, '--remote', '--sqlite', join(d, 'a.db'));
    assert.equal(ok.status, 0, ok.stderr);
    // Another clone edits ledger.md on origin (the old page does this).
    const other = mkdtempSync(join(tmpdir(), 'other-'));
    g(other, 'clone', '-q', origin, 'c');
    const c = join(other, 'c');
    g(c, 'config', 'user.email', 'a@b'); g(c, 'config', 'user.name', 'n');
    writeFileSync(join(c, 'ledger.md'), `${quillfeather}| Zed | Watching | | | | | | | | 2026-11-02 |\n`);
    g(c, 'commit', '-qam', 'edit'); g(c, 'push', '-q', 'origin', 'main');
    const bad = cli(d, '--remote', '--sqlite', join(d, 'b.db'));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /is not origin\/main's/);
});
