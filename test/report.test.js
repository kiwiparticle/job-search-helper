import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findCompany, blankCompany, renderCompanies } from '../lib/companies.js';
import { loadAll, writeRows } from '../lib/store.js';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { blankPosting } from '../lib/postingsFile.js';
import { dueTargets } from '../lib/monitoring.js';
import { buildReport, renderReportMd } from '../lib/report.js';
import { readRoute } from '../lib/models.js';
const LEGACY = readRoute('/nonexistent');
import { prepareRun as actualPrepareRun, finishRun, reviewInput, readBase, recoverDropped } from '../lib/run.js';

const prepareRun = (...args) => { args[5] ??= `${args[4]}T06:00:00.000Z`; args[6] = {executionId:'fixture', ...args[6]}; return actualPrepareRun(...args); };
const co = (name, stance, lastChecked, over = {}) => ({ ...blankCompany(name), stance, lastChecked, ...over });
const APPLIED = { id: 'a1', role: 'Tutor', appliedOn: '2026-01-01', outcome: 'applied' };
const COMPANIES = [
    co('Classgrove.world', 'Watching', '2025-01-01', { domain: 'Education', applications: [APPLIED] }),
    co('Ostrander', 'Watching', '2026-11-09', { domain: 'Landscaping', reason: 'Low pay.' }),
    co('Brindle Health', 'Watching', '2026-10-29'),
    co('Aimwell', 'Watching', '2026-10-31'),
];
let db;
const rowsOf = (list, table) => list.map((record) => ({ id: table === 'companies' ? record.key : record.id, version: null, record }));
const seed = (list) => writeRows(db, { companies: rowsOf(list, 'companies') });
const readList = async () => (await loadAll(db, 'companies')).map((r) => r.record);
const readPostings = async () => (await loadAll(db, 'postings')).map((r) => r.record);
const get = async (name) => findCompany(await readList(), name);
const versions = async () => Object.fromEntries((await loadAll(db, 'companies')).map((r) => [r.id, r.version]));

const lead = (over) => ({ key: over.company, company: 'X', role: 'Staff', foundBy: 'both', finalVerdict: 'Worth interviewing', disputed: false, reviewed: true, claude: null, codex: null, questions: [], ...over });

const daysBefore = (n) => new Date(Date.UTC(2026, 10, 17) - n * 864e5).toISOString().slice(0, 10);

test('a Skip lead goes to nearMisses, ordered leads otherwise', async () => {
    const r = buildReport({
        run: 'r', workflow: 'daily', models: {}, changes: [], held: [], refused: [],
        leads: [lead({ company: 'A', finalVerdict: 'Skip' }), lead({ company: 'B', finalVerdict: 'Human review needed', disputed: true }), lead({ company: 'C', finalVerdict: 'Strong apply' })],
    });
    assert.deepEqual(r.leads.map((l) => l.company), ['C', 'B']);
    assert.deepEqual(r.nearMisses.map((l) => l.company), ['A']);
    assert.equal(r.counts.nearMisses, 1);
});

test('report md lists refused protected rows', async () => {
    const r = buildReport({ run: 'r', workflow: 'daily', models: {}, leads: [], changes: [], held: [], refused: [{ company: 'Classgrove.world', by: 'claude', reason: 'active application' }] });
    assert.match(renderReportMd(r), /## Not changed[\s\S]*Classgrove\.world/);
});

const repo = async () => {
    db = sqliteD1();
    await applySchema(db);
    await seed(COMPANIES);
    return mkdtempSync(join(tmpdir(), 'jsrepo-'));
};
const model = (runDir, name, files) => {
    mkdirSync(join(runDir, name), { recursive: true });
    for (const [f, body] of Object.entries(files)) writeFileSync(join(runDir, name, f), body);
};

const none = { fetchImpl: async () => new Response('', { status: 404 }), lookup: async () => [{ address: '93.184.216.34' }] };

test('prepare daily: no rotation, no sweep', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const ctx = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8'));
    assert.deepEqual(ctx.rotation, []);
    assert.deepEqual(ctx.sweep, []);
    assert.deepEqual(ctx.swept, []);
});

const sweepNet = {
    lookup: none.lookup,
    fetchImpl: async () => new Response(JSON.stringify({ jobs: [{ id: 7, title: 'Senior Software Engineer', absolute_url: 'https://boards.greenhouse.io/ostrander/jobs/7' }] })),
};
const withBoard = async () => {
    const r = await repo();
    await writeRows(db, { postings: [{ id: 'greenhouse:1', version: null, record: { id: 'greenhouse:1', companyKey: findCompany(COMPANIES, 'Ostrander').key, company: 'Ostrander', url: 'https://boards.greenhouse.io/ostrander/jobs/1' } }] });
    return r;
};

test('prepare vertical: a topic lands in context.json; without one there is no topic key', async () => {
    const r = await repo();
    const withTopic = join(r, 'runs', '2026-11-13-vertical');
    await prepareRun(db, r, withTopic, 'vertical', '2026-11-13', undefined, { topic: 'K-12 and ed-tech vendors' });
    assert.equal(JSON.parse(readFileSync(join(withTopic, 'context.json'), 'utf8')).topic, 'K-12 and ed-tech vendors');
    const without = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, without, 'daily', '2026-11-13');
    assert.ok(!('topic' in JSON.parse(readFileSync(join(without, 'context.json'), 'utf8'))));
});

test('prepare tracked: swept companies leave the model pool', async () => {
    const r = await withBoard();
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, sweepNet);
    const ctx = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8'));
    assert.deepEqual(ctx.sweep.map((s) => s.company), ['Ostrander']);
    assert.deepEqual(ctx.swept, ['Ostrander']);
    assert.deepEqual(ctx.rotation, ['Classgrove.world', 'Aimwell', 'Brindle Health']);
});

test('prepare tracked: a company with over 30 roles is queued with 30 assigned and the remainder retained', async () => {
    const r = await withBoard();
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    const jobs = Array.from({ length: 31 }, (_, i) => ({ id: 100 + i, title: `Senior Engineer ${i}`, absolute_url: `https://boards.greenhouse.io/ostrander/jobs/${100 + i}` }));
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, { ...sweepNet, fetchImpl: async () => new Response(JSON.stringify({ jobs })) });
    const ctx = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8'));
    assert.equal(ctx.sweep.flatMap(e => e.roles).length,30);
    assert.equal(ctx.queuedRoles,31);
    assert.deepEqual(ctx.skippedLarge, []);
    assert.deepEqual(ctx.swept, ['Ostrander']);
    assert.ok(!ctx.rotation.includes('Ostrander'));
});

test('finish: successful API boards get verified dates without changing legacy lastChecked', async () => {
    const r = await withBoard();
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, { ...sweepNet, fetchImpl: async () => new Response(JSON.stringify({ jobs: [] })) });
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await get('Ostrander')).lastChecked, '2026-11-09');
    assert.equal((await get('Ostrander')).monitoring.lastBoardVerifiedAt, '2026-11-13T06:00:00.000Z');
});

test('finish: swept roles omitted by either failed or successful models remain unjudged', async () => {
    const r = await withBoard();
    const jobs = [{ id: 7, title: 'Senior Engineer', absolute_url: 'https://boards.greenhouse.io/ostrander/jobs/7' }];
    const net = { ...sweepNet, fetchImpl: async () => new Response(JSON.stringify({ jobs })) };
    const unjudged = { ...blankPosting({ id: 'greenhouse:7', companyKey: 'ostrander', leadKey: 'ostrander::seniorengineer', role: 'Senior Engineer', url: jobs[0].absolute_url, source: 'sweep' }), modelSays: '' };
    await writeRows(db, { postings: [{ id: unjudged.id, version: null, record: unjudged }] });
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, net);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8')).sweep[0].roles.map((x) => x.id), ['greenhouse:7']);
    model(runDir, 'claude', { 'status.txt': 'failed', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'failed', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await readPostings()).find((p) => p.id === 'greenhouse:7').modelSays, '');
    await db.prepare('DELETE FROM finished_runs').run();
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:20:00Z');
    assert.equal((await readPostings()).find((p) => p.id === 'greenhouse:7').modelSays, '');
});

test('finish: legacy assignment-only context does not stamp a successful check', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, none);
    writeFileSync(join(runDir, 'context.json'), JSON.stringify({ workflow: 'tracked', runDate: '2026-11-13', rotation: ['Ostrander'] }));
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await get('Ostrander')).lastChecked, '2026-11-09');
});

test('prepare writes context with rotation, protected names and base.jsonl', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, none);
    const ctx = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8'));
    assert.equal(ctx.workflow, 'tracked');
    assert.deepEqual(ctx.rotation, ['Classgrove.world', 'Aimwell', 'Brindle Health', 'Ostrander']);
    assert.deepEqual(ctx.protected, ['Classgrove.world']);
    assert.deepEqual(ctx.activeLeads, []);
    assert.equal(readFileSync(join(runDir, 'base.jsonl'), 'utf8'), renderCompanies(COMPANIES));
    assert.deepEqual(readBase(runDir).map((c) => c.name).sort(), COMPANIES.map((c) => c.name).sort());
});

test('readBase with no base.jsonl returns null', () => {
    assert.equal(readBase(mkdtempSync(join(tmpdir(), 'jsrun-'))), null);
});

test('finish twice → patches applied once, rows and versions unchanged the second time, same changes', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const c = { company: 'Ostrander', role: 'Staff Engineer', url: 'https://jobs.lever.co/ostrander/2b1f1e2a-1111-4222-8333-444455556666', verdict: 'Worth interviewing' };
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([c]), 'ledger-patch.json': JSON.stringify([{ company: 'Ostrander', reason: 'Rechecked.' }]) });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([c]), 'ledger-patch.json': JSON.stringify([{ company: 'Ostrander', rolesSkipped: ['Principal'] }]) });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    const first = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    const v1 = await versions();
    await finishRun(db, r, runDir, '2026-11-13T06:13:00Z');
    assert.deepEqual(await versions(), v1);
    const ostrander = await get('Ostrander');
    assert.deepEqual(ostrander.rolesSkipped, ['Principal']);
    assert.equal(ostrander.reason, 'Rechecked.');
    assert.equal((await readPostings()).length, 1);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.changes.length, 1);
    assert.deepEqual(report.changes, first.changes);
    assert.equal(existsSync(join(r, 'history.md')), false);
    const index = JSON.parse(readFileSync(join(r, 'runs', 'index.json'), 'utf8'));
    assert.equal(index.length, 1);
    assert.equal(index[0].run, '2026-11-13-daily');
});

test('finish: rotation companies get attempts only, protected facts stay, postings are rows not company fields', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-tracked');
    await prepareRun(db, r, runDir, 'tracked', '2026-11-13', undefined, none);
    const c = { company: 'Ostrander', role: 'Staff Engineer', url: 'https://jobs.lever.co/ostrander/2b1f1e2a-1111-4222-8333-444455556666', verdict: 'Worth interviewing', facts: 'x' };
    const sw = { company: 'Classgrove.world', role: 'Tutor', verdict: 'Worth interviewing', facts: 'new facts', size: '9' };
    const patch = JSON.stringify([{ company: 'Classgrove.world', domain: 'Hacked', reason: 'X.' }]);
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([c, sw]), 'ledger-patch.json': patch });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([c, sw]), 'ledger-patch.json': patch });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    const list = await readList();
    for (const n of ['Brindle Health', 'Aimwell', 'Ostrander']) {
        assert.equal(findCompany(list,n).monitoring.lastBoardTriedAt,'2026-11-13T06:00:00.000Z');
        assert.equal(findCompany(list,n).monitoring.lastBoardReportedAt,undefined);
    }
    const school = findCompany(list, 'Classgrove.world');
    assert.deepEqual(school, { ...COMPANIES[0], monitoring:{lastBoardTriedAt:'2026-11-13T06:00:00.000Z'} });
    assert.ok(report.refused.some((x) => x.company === 'Classgrove.world'));
    const posts = await readPostings();
    assert.equal(posts.length, 2);
    assert.ok(posts.some((p) => p.id === 'lever:2b1f1e2a-1111-4222-8333-444455556666' && p.companyKey === 'ostrander' && p.wasLead));
    assert.ok(posts.every((p) => p.companyKey));
    assert.ok(list.every((c) => !('postings' in c)));
});

test('finish with codex auth failure → claude\'s patch still applies, leads unreviewed', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'Cartwheel Engine', role: 'Staff', verdict: 'Human review needed' }]), 'ledger-patch.json': JSON.stringify([{ company: 'Ostrander', reason: 'X.' }]) });
    model(runDir, 'codex', { 'status.txt': 'auth' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await get('Ostrander')).reason, 'X.');
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.models.codex.status, 'auth');
    assert.equal(report.leads[0].reviewed, false);
    assert.deepEqual(report.held, []);
});

test('a run never changes a stance the owner set; a new company takes the model\'s stance, marked', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const patch = [{ company: 'Ostrander', stance: 'Dormant', reason: 'Gone quiet.' }, { company: 'Brand New Co', stance: 'Watching', reason: 'Fresh.' }];
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': JSON.stringify(patch) });
    model(runDir, 'codex', { 'status.txt': 'auth' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    const ostrander = await get('Ostrander');
    assert.equal(ostrander.stance, 'Watching');
    assert.equal(ostrander.reason, 'Gone quiet.');
    assert.equal(ostrander.heldUpdate, undefined);
    const fresh = await get('Brand New Co');
    assert.equal(fresh.stance, 'Watching');
    assert.equal(fresh.stanceBy, 'claude');
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.ok(report.refused.some((x) => x.company === 'Ostrander' && /stance set by you/.test(x.reason)));
});

test('a row another writer changed between load and write: the redo keeps it and skips the run\'s patch', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const patch = JSON.stringify([{ company: 'Ostrander', reason: 'Run reason.' }]);
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': patch });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': patch });
    let raced = 0;
    const racing = { ...db, batch: async (stmts) => {
        if (!raced++) {
            const g = await get('Ostrander');
            await writeRows(db, { companies: [{ id: g.key, version: (await versions())[g.key], record: { ...g, reason: 'Owner edit.' } }] });
        }
        return db.batch(stmts);
    } };
    const report = await finishRun(racing, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal(raced, 2);
    const ostrander = await get('Ostrander');
    assert.equal(ostrander.reason, 'Owner edit.');
    assert.equal(ostrander.heldUpdate, undefined);
    assert.ok(report.refused.some((x) => x.company === 'Ostrander' && /changed since the run started/.test(x.reason)));
});

test('junk patch rows are refused in the report, never a crash', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const junk = [5, null, { company: 'Ostrander', status: 'Bogus', reason: 'ok', website: 'javascript:alert(1)' }, { company: 'Ostrander', application: { state: 'passed' } }];
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': JSON.stringify(junk) });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    const reasons = report.refused.filter((x) => x.by === 'claude').map((x) => x.reason).join('|');
    assert.match(reasons, /Unknown status "Bogus"/);
    assert.match(reasons, /Website dropped/);
    assert.match(reasons, /Ignored fields: application/);
    assert.match(reasons, /no usable company name/);
    assert.match(renderReportMd(report), /## Not changed/);
});

test('a finish on top of a row changed since prepare keeps the other change', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    // The owner edits Brindle Health after prepare (as finish-push's redo sees on a moved main).
    const cur = await get('Brindle Health');
    await writeRows(db, { companies: [{ id: cur.key, version: (await versions())[cur.key], record: { ...cur, reason: 'Owner note.' } }] });
    const patch = JSON.stringify([{ company: 'Ostrander', reason: 'Rechecked.' }]);
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': patch });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': patch });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await get('Brindle Health')).reason, 'Owner note.');
    assert.equal((await get('Ostrander')).reason, 'Rechecked.');
});

test('reviewInput lists only the other model\'s solo finds, with keys', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const both = { company: 'Brindle Health', role: 'Senior SWE', verdict: 'Worth interviewing' };
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([both, { company: 'Cartwheel Engine', role: 'Staff', verdict: 'Human review needed' }]) });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ ...both, company: 'Brindle' }, { company: 'Zelvi', role: 'SWE III', verdict: 'Human review needed' }]) });
    assert.deepEqual(reviewInput(runDir, 'codex', LEGACY).map((i) => i.key), ['cartwheelengine::staff']);
    assert.deepEqual(reviewInput(runDir, 'claude', LEGACY).map((i) => i.key), ['zelvi::sweiii']);
});

test('reviewInput is empty when the other model failed', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    model(runDir, 'claude', { 'status.txt': 'failed' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    assert.deepEqual(reviewInput(runDir, 'codex', LEGACY), []);
});

test('a company-to-watch row is not shown as a lead', async () => {
    const r = buildReport({ run: 'r', workflow: 'daily', models: {}, changes: [], held: [], refused: [],
        leads: [lead({ company: 'Wow!', finalVerdict: 'Company worth watching (internal)' }), lead({ company: 'B', finalVerdict: 'Worth interviewing' })] });
    assert.deepEqual(r.leads.map((l) => l.company), ['B']);
    assert.deepEqual(r.nearMisses.map((l) => l.company), ['Wow!']);
});

test('reviewInput gives the reviewer a different role it did not find at the same company', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'Cooperative Assay Labs', role: 'Senior Frontend Engineer', verdict: 'Skip' }]) });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'Cooperative Assay Labs', role: 'Senior Frontend Engineer; Senior SWE', verdict: 'Interesting but concerning' }]) });
    assert.deepEqual(reviewInput(runDir, 'claude', LEGACY).map((i) => i.role), ['Senior Frontend Engineer; Senior SWE']);
});

test('a review-stage login failure shows in the report', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'review', { 'status-codex.txt': 'auth\n' });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal(report.models.codex.review, 'auth');
    assert.equal(report.models.claude.review, undefined);
});

test('a reviewer that had work but delivered no review is flagged', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'Lyceum Board', role: 'Lead', verdict: 'Human review needed' }]) });
    const report = await finishRun(db, r, runDir);
    assert.equal(report.models.claude.review, 'missing');
    assert.equal(report.models.codex.review, undefined);
});

test('rotation includes To review companies', async () => {
    assert.ok(dueTargets(COMPANIES.map(c => c.name === 'Ostrander' ? {...c,stance:'To review'} : c),[],'2026-11-13T06:00:00Z').some(t => t.company === 'Ostrander'));
});

test('a run records how long it took, and a sendback re-merge keeps that duration', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13', '2026-11-13T06:00:00Z');
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:13:30Z');
    await finishRun(db, r, runDir, '2026-11-14T09:00:00Z');
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.startedAt, '2026-11-13T06:00:00Z');
    assert.equal(report.durationMs, 13.5 * 60000);
    assert.equal(JSON.parse(readFileSync(join(r, 'runs', 'index.json'), 'utf8'))[0].durationMs, 13.5 * 60000);
});

test('a run with no recorded start has no duration', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'context.json'), '{"workflow":"daily","runDate":"2026-11-13"}');
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': '[]' });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:13:30Z');
    assert.equal(JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')).durationMs, undefined);
});

test('finish-push.sh puts context.json and base.jsonl from the artifacts into the run folder', () => {
    const d = mkdtempSync(join(tmpdir(), 'fp-'));
    const a = join(d, 'a');
    mkdirSync(join(a, 'context'), { recursive: true });
    writeFileSync(join(a, 'context', 'context.json'), '{"workflow":"daily"}');
    mkdirSync(join(a, 'run-base'));
    writeFileSync(join(a, 'run-base', 'base.jsonl'), '{"key":"x"}\n');
    mkdirSync(join(a, 'out-claude'));
    writeFileSync(join(a, 'out-claude', 'candidates.json'), '[]');
    writeFileSync(join(a, 'out-claude', 'junk.txt'), 'not named');
    // A stub node and git: the script only has to assemble, call finish.js and commit.
    const bin = join(d, 'bin');
    mkdirSync(bin);
    copyFileSync(new URL('../bin/collect-output.sh', import.meta.url).pathname, join(d, 'bin', 'collect-output.sh'));
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "git $*" >> "$GIT_LOG"\n[ "$1" = commit ] && exit 1\nexit 0\n', { mode: 0o755 });
    const runDir = join(d, 'runs', 'r1');
    const out = spawnSync('bash', [new URL('../bin/finish-push.sh', import.meta.url).pathname, runDir, a, 'msg'], { cwd: d, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_LOG: join(d, 'git.log'), GH_TOKEN: 'tok', GITHUB_REPOSITORY: 'o/r' } });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(join(runDir, 'claude', 'candidates.json'), 'utf8'), '[]');
    assert.equal(existsSync(join(runDir, 'claude', 'junk.txt')), false);
    assert.equal(readFileSync(join(runDir, 'context.json'), 'utf8'), '{"workflow":"daily"}');
    assert.equal(readFileSync(join(runDir, 'base.jsonl'), 'utf8'), '{"key":"x"}\n');
    assert.match(readFileSync(join(d, 'git.log'), 'utf8'), /git add runs\n/);
});

test('25 unknown companies between patches and finds: exactly 20 created, the rest listed once, none refused that was created', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const name = (n) => `Newco ${String.fromCharCode(64 + n)}`;
    const patch = JSON.stringify(Array.from({ length: 22 }, (_, i) => ({ company: name(i + 1), reason: 'Seen.' })));
    // Finds: one for a company the patches refused (V), three more unknown ones (W, X, Y).
    const finds = ['V', 'W', 'X', 'Y'].map((c, i) => ({ company: `Newco ${c}`, role: 'Staff', url: `https://boards.greenhouse.io/n/jobs/${100 + i}`, verdict: 'Worth interviewing' }));
    // One searcher: the allowance is 20 per searcher (see patches.test.js for two).
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify(finds), 'ledger-patch.json': patch });
    model(runDir, 'codex', { 'status.txt': 'failed' });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    const fresh = (await readList()).filter((c) => /^Newco /.test(c.name)).map((c) => c.name);
    assert.equal(fresh.length, 20);
    const listed = [...new Set(report.refused.map((x) => x.company))];
    assert.deepEqual(listed.filter((n) => fresh.includes(n)), []);
    assert.deepEqual(listed.sort(), [name(21), name(22)]);
    assert.deepEqual(report.notes.map((n) => n.split(':')[0]).sort(), ['Newco W', 'Newco X', 'Newco Y'].sort());
    assert.equal((await readPostings()).length, 0);
    const v = await versions();
    await finishRun(db, r, runDir, '2026-11-13T06:20:00Z');
    assert.equal((await readList()).filter((c) => /^Newco /.test(c.name)).length, 20);
    assert.deepEqual(await versions(), v);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')).notes, report.notes);
});

test('recoverDropped adds what the limit dropped, once, and leaves companies a later run made alone', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-culture');
    await prepareRun(db, r, runDir, 'culture', '2026-11-13');
    const name = (n) => `Newco ${String.fromCharCode(64 + n)}`;
    const patch = Array.from({ length: 23 }, (_, i) => ({ company: name(i + 1), stance: 'Watching', reason: 'Seen.' }));
    const finds = ['U', 'V'].map((c, i) => ({ company: `Newco ${c}`, role: 'Staff', url: `https://boards.greenhouse.io/n/jobs/${200 + i}`, verdict: 'Worth interviewing', fit: 4 }));
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify(finds), 'ledger-patch.json': JSON.stringify(patch) });
    model(runDir, 'codex', { 'status.txt': 'failed' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await readList()).filter((c) => /^Newco /.test(c.name)).length, 20);
    // A later run made one of the dropped companies meanwhile: it keeps its own fields.
    const later = { ...blankCompany('Newco W'), stance: 'Dormant', reason: 'Later run.' };
    await writeRows(db, { companies: [{ id: later.key, version: null, record: later }] });

    const out = await recoverDropped(db, runDir, '2026-11-22T00:00:00Z');
    assert.deepEqual(out, { run: '2026-11-13-culture', dropped: 3, created: 2, postings: 2 });
    const list = await readList();
    assert.equal(list.filter((c) => /^Newco /.test(c.name)).length, 23);
    assert.equal(findCompany(list, 'Newco U').stance, 'Watching');
    assert.equal(findCompany(list, 'Newco W').reason, 'Later run.');
    const posts = (await readPostings()).filter((p) => p.firstRun === '2026-11-13-culture');
    assert.deepEqual(posts.map((p) => [p.modelSays, p.fit]), [['lead', 4], ['lead', 4]]);
    assert.deepEqual(await recoverDropped(db, runDir), { run: '2026-11-13-culture', skipped: 'already recovered', marked: 0 });
    // An older recovery left its companies unflagged: a repeat flags the ones still only model-placed.
    const u = (await loadAll(db, 'companies')).find((r) => r.record.name === 'Newco U');
    await writeRows(db, { companies: [{ id: u.id, version: u.version, record: { ...u.record, newFromRun: undefined } }] });
    assert.deepEqual(await recoverDropped(db, runDir), { run: '2026-11-13-culture', skipped: 'already recovered', marked: 1 });
    assert.equal(findCompany(await readList(), 'Newco U').newFromRun, true);
});

test('prepare links: linkTargets filled, rotation/sweep/swept empty; other workflows write none', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-links');
    await prepareRun(db, r, runDir, 'links', '2026-11-13', undefined, none);
    const ctx = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8'));
    assert.deepEqual(ctx.linkTargets, ['Aimwell', 'Brindle Health', 'Ostrander']);
    assert.deepEqual([ctx.rotation, ctx.sweep, ctx.swept], [[], [], []]);
    const daily = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, daily, 'daily', '2026-11-13');
    assert.deepEqual(JSON.parse(readFileSync(join(daily, 'context.json'), 'utf8')).linkTargets, []);
});

test('finish: a links run leaves lastChecked unchanged', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-links');
    await prepareRun(db, r, runDir, 'links', '2026-11-13', undefined, none);
    const c = JSON.stringify([{ company: 'Ostrander', role: 'Staff Engineer', url: 'https://jobs.lever.co/ostrander/2b1f1e2a-1111-4222-8333-444455556666', verdict: 'Worth interviewing' }]);
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': c });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': '[]' });
    await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal((await get('Ostrander')).lastChecked, '2026-11-09');
});

test('prepare vertical: no owner pick sweeps every Top vertical; an owner pick wins', async () => {
    const r = await repo();
    mkdirSync(join(r, 'data'), { recursive: true });
    writeFileSync(join(r, 'data/verticals.json'), JSON.stringify([{ name: 'A', group: 'Top' }, { name: 'B', group: 'Preferred' }, { name: 'C', group: 'Top' }]));
    const read = async (topic) => {
        const runDir = join(r, 'runs', `2026-11-18-vertical-${topic || 'none'}`);
        await prepareRun(db, r, runDir, 'vertical', '2026-11-18', undefined, { ...sweepNet, topic });
        return JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf8')).topic;
    };
    assert.equal(await read(''), 'A;C');
    assert.equal(await read('B'), 'B');
});

test('both searchers failed: finish completes with no leads and no company changed', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    for (const m of ['claude', 'codex']) model(runDir, m, { 'status.txt': 'failed', 'ledger-patch.json': JSON.stringify([{ company: 'Ostrander', reason: 'X.' }]) });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.equal(report.counts.leads, 0);
    assert.equal(report.counts.changes, 0);
    assert.equal(report.models.claude.status, 'failed');
    assert.equal(report.models.codex.status, 'failed');
    const list = await readList();
    for (const orig of COMPANIES) {
        const { heldUpdate, lastChecked, ...now } = findCompany(list, orig.name);
        const { lastChecked: _l, ...was } = orig;
        assert.deepEqual(now, was);
    }
});

test('legacy run folder without route.json finishes and renders', async () => {
    const r = await repo();
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    const a = { company: 'Alpha', role: 'Staff', verdict: 'Worth interviewing', note: 'Good.' };
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([a]) });
    model(runDir, 'codex', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([a]) });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.deepEqual(Object.keys(report.models), ['claude', 'codex']);
    assert.equal(report.leads[0].opinions.claude.verdict, 'Worth interviewing');
    const md = readFileSync(join(runDir, 'report.md'), 'utf8');
    assert.match(md, /- Claude: Worth interviewing/);
    assert.match(md, /- Codex: Worth interviewing/);
});

test('qwen + claude route with codex reviewing finishes; leads carry opinions and labels', async () => {
    const r = await repo();
    mkdirSync(join(r, 'data'), { recursive: true });
    writeFileSync(join(r, 'data', 'models.json'), JSON.stringify({ models: [
        { id: 'claude', label: 'Claude', runner: 'claude' },
        { id: 'codex', label: 'Codex', runner: 'codex' },
        { id: 'qwen', label: 'Qwen', runner: 'opencode', model: 'llama-local/qwen' },
    ] }));
    const runDir = join(r, 'runs', '2026-11-13-daily');
    await prepareRun(db, r, runDir, 'daily', '2026-11-13');
    writeFileSync(join(runDir, 'route.json'), JSON.stringify({ searchers: ['qwen', 'claude'], reviewer: 'codex', advisory: ['qwen'], trimmed: { qwen: { dropped: 3 } } }));
    model(runDir, 'qwen', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'Alpha', role: 'Staff', verdict: 'Worth interviewing', note: 'Q.' }]),
        'ledger-patch.json': JSON.stringify([{ company: 'Ostrander', verdict: 'Skip' }]) });
    model(runDir, 'claude', { 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'Beta', role: 'Staff', verdict: 'Worth interviewing', note: 'C.' }]) });
    model(runDir, 'review', { 'codex.json': JSON.stringify({ reviewer: 'codex', items: [
        { key: 'alpha::staff', agree: true, verdict: 'Worth interviewing', note: 'Agree A.' },
        { key: 'beta::staff', agree: true, verdict: 'Worth interviewing', note: 'Agree B.' },
    ] }) });
    const report = await finishRun(db, r, runDir, '2026-11-13T06:12:00Z');
    assert.deepEqual(report.models, { qwen: { status: 'ok' }, claude: { status: 'ok' }, codex: {} });
    const alpha = report.leads.find((l) => l.company === 'Alpha');
    assert.deepEqual(Object.keys(alpha.opinions).sort(), ['codex', 'qwen']);
    assert.equal(alpha.reviewed, true);
    assert.equal(report.labels.qwen, 'Qwen');
    assert.ok(report.notes.includes('Qwen ran a lighter pass: 3 assignments dropped to fit its context'));
    assert.deepEqual(report.held, []);
    assert.deepEqual(report.changes.find((c) => c.company === 'Ostrander').fields.verdict.to, 'Skip');
    const md = readFileSync(join(runDir, 'report.md'), 'utf8');
    assert.match(md, /- Qwen: Worth interviewing\. Q\./);
    assert.match(md, /- Codex: Worth interviewing\. Agree A\./);
    assert.match(md, /Models: Qwen ok, Claude ok/);
});
