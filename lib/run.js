import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseCompanies, renderCompanies, findCompany } from './companies.js';
import { loadAll, writeRows, finishedResult } from './store.js';
import { CAPS } from './caps.js';
import { isProtected, hasActiveLead, jobEntry, applicationFor } from './tags.js';
import { attachRun } from './postings.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import { dueTargets, manualTargets, selectRoles, mergeDate, cleanCoverage, tracked } from './monitoring.js';
import { sweepPostings } from './sweepPostings.js';
import { postingId, sameLink } from './postingId.js';
import { leadKey, sameCompany } from './keys.js';
import { blankPosting } from './postingsFile.js';
import { sweepBoards, pickLinkTargets } from './boardSweep.js';
import { payFor, pool } from './postingCheck.js';
import { readModelOutput, readReview } from './readModelOutput.js';
import { readRoute, reviewersOf, loadModels, getModel } from './models.js';
import { mergeCandidates, pairCandidates } from './mergeCandidates.js';
import { applyPatches } from './applyPatches.js';
import { pickSources, checkedSources } from './sources.js';
import { loadFilter, rejectReason, dropWords } from './sweepFilter.js';
import { buildReport, renderReportMd, splitLeads } from './report.js';

// Both models cap their finds at 40 per run, so a run screens at most this many sweep roles; the rest wait for the next one.
export const SWEEP_ROLES_PER_RUN = 30;
const readJson = (p, fallback) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};

// Discovery workflows whose searchers list their queries under "## Queries" in report.md.
const QUERY_WORKFLOWS = ['daily', 'vertical', 'culture'];

// The queries the last few runs of this workflow tried, so the next run can pick new angles.
// Model text: capped per line, per run and in total.
export function recentQueries(repoDir, workflow, runs = 5) {
    if (!QUERY_WORKFLOWS.includes(workflow)) return [];
    const dir = join(repoDir, 'runs');
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir).filter((n) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${workflow}(-\\d{6})?$`).test(n)).sort().slice(-runs);
    const out = new Set();
    for (const name of names) {
        const runDir = join(dir, name);
        for (const model of readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
            const md = join(runDir, model, 'report.md');
            if (!existsSync(md)) continue;
            const section = readFileSync(md, 'utf8').split(/^## Queries[^\n]*$/m)[1]?.split(/^## /m)[0] ?? '';
            for (const line of section.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 40)) out.add(line.slice(0, 200));
        }
    }
    return [...out].slice(-150);
}

export async function prepareRun(db, repoDir, runDir, workflow, runDate, startedAt = new Date().toISOString(), { fetchImpl = fetch, lookup = dnsLookup, topic = '', job, executionId = '', retry = false, sweepRoles = SWEEP_ROLES_PER_RUN } = {}) {
    mkdirSync(runDir, { recursive: true });
    // A scheduled vertical run (no owner pick) sweeps every Top vertical in data/verticals.json.
    if (workflow === 'vertical' && !topic) topic = readJson(join(repoDir, 'data/verticals.json'), []).filter((v) => v.group === 'Top').map((v) => v.name).join(';');
    const prior = readJson(join(runDir, 'context.json'), null);
    const done = await finishedResult(db, basename(runDir));
    if (prior) {
        if (prior.executionId !== executionId) throw new Error('execution collision: choose a new run folder');
        if (!done && (!existsSync(join(runDir,'base.jsonl')) || !existsSync(join(runDir,'company-state.jsonl')))) throw new Error('missing preparation artifacts; start a new run');
        return;
    }
    if (retry || done) throw new Error('missing preparation artifacts or execution collision; start a new run');
    const companies = (await loadAll(db, 'companies')).map(r => r.record);
    const postings = (await loadAll(db, 'postings')).map(r => r.record);
    const due = workflow === 'tracked' ? dueTargets(companies, postings, startedAt) : [];
    const boardResults = workflow === 'tracked' ? await sweepBoards({ companies, postings, judge:true, drop:dropWords(repoDir), targets:due.filter(t => t.api).map(t => t.company) }, { fetchImpl, lookup }) : [];
    const swept = boardResults.filter(s => s.status === 'ok');
    const manual = manualTargets(due.filter(t => !swept.some(s => s.company === t.company)));
    // Preserve all discovered roles; only the selected 30 consume model screening slots.
    const queued = new Map(companies.filter(c => tracked(c,postings) && !c.sweepOff).map(c => [c.name,{company:c.name,roles:[]} ]));
    for (const p of postings) {
        const c = companies.find(c => c.key === p.companyKey);
        if (c && queued.has(c.name) && p.modelSays === '' && p.posted !== 'no' && !jobEntry(c,p) && !applicationFor(c,p)) queued.get(c.name).roles.push({id:p.id,title:p.role,url:p.url});
    }
    // Roles the owner's sweep filter rejects never reach a model; finish saves them as filtered passes.
    const filter = loadFilter(repoDir);
    for (const e of swept) for (const r of e.roles) if (!rejectReason(filter, { title: r.title, location: r.location }) && !queued.get(e.company).roles.some(x => x.id === r.id)) queued.get(e.company).roles.push(r);
    const sweep = workflow === 'tracked' ? selectRoles([...queued.values()],companies,postings,Math.min(SWEEP_ROLES_PER_RUN,sweepRoles)) : [];
    // Script-found pay rides along so a model can't say "not posted" about a page that shows it.
    const jobs = [...sweep.flatMap(e => e.roles), ...(workflow === 'job' && job?.url ? [job] : [])];
    await pool(jobs, 4, async j => { const pay = await payFor(j.url, { fetchImpl, lookup }); if (pay) j.payFound = pay; });
    const ctx = {
        workflow, runDate, startedAt, executionId,
        ...(topic && {topic}), ...(workflow === 'job' && {job}),
        rotation: manual.map(t => t.company), manualTargets:manual, dueTargets:due,
        linkTargets:workflow === 'links' ? pickLinkTargets(companies,postings) : [],
        ...(workflow === 'culture' && {sources:pickSources(repoDir)}),
        ...(QUERY_WORKFLOWS.includes(workflow) && {recentQueries:recentQueries(repoDir, workflow)}),
        boardResults, sweep, swept:swept.map(s => s.company), skippedLarge:[],
        queuedRoles:[...queued.values()].reduce((n,e) => n+e.roles.length,0),
        activeLeads:companies.filter(c => c.stance !== 'Ruled out' && hasActiveLead(c,postings)).map(c => c.name),
        protected:companies.filter(isProtected).map(c => c.name),
    };
    writeFileSync(join(runDir,'context.json'), JSON.stringify(ctx,null,2)+'\n');
    const snapshot = renderCompanies(companies);
    writeFileSync(join(runDir,'base.jsonl'),snapshot);
    writeFileSync(join(runDir,'company-state.jsonl'),snapshot);
}

// The companies as the run started, or null when the file is missing or unreadable (no company field is then written).
export function readBase(runDir) {
    try { return parseCompanies(readFileSync(join(runDir, 'base.jsonl'), 'utf8')); } catch { return null; }
}

// What `reviewer` must check: every find it did not make itself.
export function reviewInput(runDir, reviewer, route) {
    const lists = Object.fromEntries(route.searchers.map((id) => [id, readModelOutput(join(runDir, id)).candidates]));
    return pairCandidates(lists)
        .filter((p) => !p[reviewer])
        .map((p) => ({ ...p[route.searchers.find((id) => p[id])], key: p.key }));
}

const loadReview = (runDir, reviewer) => {
    const r = readReview(join(runDir, 'review', `${reviewer}.json`));
    return r?.items.length ? r : null;
};

const reviewStatus = (runDir, m) => {
    try { return readFileSync(join(runDir, 'review', `status-${m}.txt`), 'utf8').trim(); } catch { return null; }
};

const MAX_TRIES = 3;

// Loads current rows, applies the run's patches and finds as pure functions, writes only the rows that changed.
// A stale write (someone else changed a row meanwhile) reloads and redoes everything from scratch.
async function applyRun(db, runDir, { run, runDate, now, outputs, route, models, leads, filter }) {
    const { shown, nearMisses } = splitLeads(leads);
    const ctx0 = readJson(join(runDir, 'context.json'), {});
    for (let attempt = 1; ; attempt++) {
        const done = await finishedResult(db, run);
        if (done?.executionId && done.executionId !== ctx0.executionId) throw new Error('execution collision: start a new run');
        const cRows = await loadAll(db, 'companies');
        const pRows = await loadAll(db, 'postings');
        const before = new Map([...cRows.map((r) => [`c:${r.id}`, JSON.stringify(r.record)]), ...pRows.map((r) => [`p:${r.id}`, JSON.stringify(r.record)])]);
        // A finished run keeps its stored outcome; only the finds and lastChecked are redone .
        let result = done;
        let companies = cRows.map((r) => r.record);
        // A finished run's new companies already exist; a rerun may not create more.
        // A searcher that did not finish contributes nothing.
        const ok = route.searchers.filter((id) => outputs[id].status === 'ok');
        let newAllowance = done ? 0 : CAPS.newCompanies * Math.max(1, ok.length);
        let blocked = [];
        if (!done) {
            const patches = Object.fromEntries(ok.map((id) => [id, outputs[id].patch]));
            const patched = applyPatches({ companies, base: readBase(runDir), patches, order: ok });
            // Rows the model output cleaner dropped or stripped show up as refused.
            const rejected = route.searchers.flatMap((by) => outputs[by].rejected.map((x) => ({ ...x, by })));
            newAllowance -= patched.companies.length - companies.length;
            blocked = patched.refused.filter((x) => /new-companies limit/.test(x.reason)).map((x) => x.company);
            companies = patched.companies;
            result = { changes: patched.changes, held: [], refused: [...patched.refused, ...rejected] };
        }
        const att = attachRun({ companies, postings: pRows.map((r) => r.record) }, { run, leads: shown, nearMisses, models: Object.keys(models), newAllowance, blocked });
        if (done) att.companies = companies;
        else result.changes = [...result.changes, ...att.changes];

        const coverageNotes = [];
        let sweepStat;
        if (!done) {
            const at = ctx0.startedAt;
            // An assignment every searcher dropped to fit its context was never looked at: no stamps, it stays due.
            const droppedBy = (field) => (route.searchers.length ? route.searchers : []).map(id => new Set(route.trimmed?.[id]?.[field] ?? []));
            const lost = (field, name) => { const d = droppedBy(field); return d.length > 0 && d.every(x => x.has(name)); };
            const rotation = (ctx0.rotation ?? []).filter(n => !lost('manualTargets',n));
            const sweepKept = (ctx0.sweep ?? []).filter(e => !lost('sweep',e.company));
            const stamp = (name,field) => {
                const c = findCompany(att.companies,name);
                if (c && c.stance !== 'Ruled out') mergeDate(c,'monitoring',field,at);
            };
            // API listing evidence belongs to trusted setup; model coverage has weaker provenance.
            const allowed = att.companies.filter(c => tracked(c,att.postings));
            const updates = sweepPostings({companies:allowed,postings:att.postings,results:ctx0.boardResults ?? [],run,filter});
            for (const p of updates) {
                const old = att.postings.find(x => x.id === p.id);
                if (old) Object.assign(old,p); else att.postings.push(p);
            }
            for (const target of ctx0.dueTargets ?? []) if (target.api) stamp(target.company,'lastBoardTriedAt');
            for (const e of ctx0.boardResults ?? []) if (e.status === 'ok') stamp(e.company,'lastBoardVerifiedAt');
            for (const name of rotation) stamp(name,'lastBoardTriedAt');
            for (const name of ctx0.linkTargets ?? []) stamp(name,'lastLinksTriedAt');
            for (const e of sweepKept) {
                const c = findCompany(att.companies,e.company);
                if (!c || c.stance === 'Ruled out') continue;
                stamp(e.company,'lastSweepScheduledAt');
                for (const role of e.roles) {
                    let p = att.postings.find(p => p.id === role.id) ?? sameLink(att.postings,c.key,role.url);
                    if (!p) {
                        p = {...blankPosting({id:role.id,companyKey:c.key,leadKey:leadKey(c.name,role.title),role:role.title,url:role.url,source:'sweep'}),modelSays:'',firstRun:run,lastRun:run};
                        att.postings.push(p);
                    }
                    mergeDate(p,'screening','lastTriedAt',at);
                }
            }
            const reports = Object.values(outputs).flatMap(o => cleanCoverage(o.coverage,ctx0.manualTargets ?? [],runDate));
            for (const r of reports) if (r.status === 'completed') stamp(r.company,'lastBoardReportedAt');
            for (const item of Object.values(outputs).flatMap(o => o.pending ?? [])) {
                const c = findCompany(att.companies,item.company);
                if (!c || c.stance === 'Ruled out' || !rotation.includes(c.name)) continue;
                const id = postingId(item);
                if (!att.postings.some(p => p.id === id) && !sameLink(att.postings,c.key,item.url)) att.postings.push({...blankPosting({id,companyKey:c.key,leadKey:leadKey(c.name,item.role),role:item.role,url:item.url,source:'run'}),modelSays:'',firstRun:run,lastRun:run});
            }
            if (ctx0.workflow === 'tracked') {
                const verified = (ctx0.boardResults ?? []).filter(e => e.status === 'ok').length;
                const reported = new Set(reports.filter(r => r.status === 'completed').map(r => r.company)).size;
                const manualCount = rotation.length;
                const overflow = Math.max(0,(ctx0.dueTargets ?? []).length-verified-manualCount);
                const unreviewed = att.postings.filter(p => p.modelSays === '' && allowed.some(c => c.key === p.companyKey)).length;
                coverageNotes.push(`Coverage: ${verified} script-verified boards, ${reported}/${manualCount} model-reported completed boards. ${overflow} due targets exceed capacity; ${manualCount-reported} manual checks blocked or unfinished. Daily/weekly targets remain due until covered.`);
                const errors = (ctx0.boardResults ?? []).filter(e => e.status !== 'ok').map(e => e.company);
                if (errors.length) coverageNotes.push(`API verification failed: ${errors.join(', ')}. Model fallback reports are informational; these boards remain due for script verification.`);
                for (const group of ['lead','application','watch']) {
                    const targets = (ctx0.dueTargets ?? []).filter(t => t.group === group);
                    const verifiedNames = new Set((ctx0.boardResults ?? []).filter(e => e.status === 'ok').map(e => e.company));
                    const reportedNames = new Set(reports.filter(r => r.status === 'completed').map(r => r.company));
                    const assigned = targets.filter(t => rotation.includes(t.company)).length;
                    const strong = targets.filter(t => verifiedNames.has(t.company)).length;
                    const weak = targets.filter(t => reportedNames.has(t.company)).length;
                    const stillDue = targets.filter(t => t.api ? !verifiedNames.has(t.company) : !reportedNames.has(t.company)).length;
                    coverageNotes.push(`${group}: ${targets.length} due, ${assigned} manual assigned, ${strong} script-verified, ${weak} model-reported, ${Math.max(0,targets.length-strong-assigned)} deferred by capacity, ${stillDue} still due (${group === 'lead' ? 'daily' : 'weekly'} commitment).`);
                }
                // For the judge-all chain: roles this run recorded a verdict for, and how many of the queue remain.
                const judged = sweepKept.flatMap(e => e.roles).filter(r => att.postings.find(p => p.id === r.id)?.modelSays).length;
                sweepStat = {judged,left:Math.max(0,(ctx0.queuedRoles ?? 0)-judged)};
                coverageNotes.push(`Screening: ${unreviewed} roles remain unreviewed; omitted roles are retried, never passed automatically.`);
            }
        }
        const rows = (list, versions, idOf, prefix) => list
            .filter((rec) => JSON.stringify(rec) !== before.get(`${prefix}:${idOf(rec)}`))
            .map((record) => ({ id: idOf(record), version: versions.get(idOf(record)) ?? null, record }));
        result = { executionId: done?.executionId ?? ctx0.executionId, changes: result.changes, held: result.held ?? [], refused: result.refused, notes: done ? done.notes : [...att.notes,...coverageNotes], ...((done ? done.sweep : sweepStat) && { sweep: done ? done.sweep : sweepStat }) };
        try {
            await writeRows(db, {
                companies: rows(att.companies, new Map(cRows.map((r) => [r.id, r.version])), (c) => c.key, 'c'),
                postings: rows(att.postings, new Map(pRows.map((r) => [r.id, r.version])), (p) => p.id, 'p'),
                ...(!done && { finishedRun: { run, at: now, result } }),
            });
            return result;
        } catch (e) {
            if (!e.stale || attempt >= MAX_TRIES) throw e;
        }
    }
}

export async function finishRun(db, repoDir, runDir, now = new Date().toISOString()) {
    const run = basename(runDir);
    const route = readRoute(runDir);
    const ctx = readJson(join(runDir, 'context.json'), {});
    const registry = loadModels(repoDir);
    const label = (id) => getModel(registry, id)?.label ?? id;
    const outputs = Object.fromEntries(route.searchers.map((id) => [id, readModelOutput(join(runDir, id))]));
    // Every searcher has a status; a reviewer that did not search gets an entry carrying only its review.
    const models = Object.fromEntries(route.searchers.map((id) => [id, { status: outputs[id].status, ...(outputs[id].reason && { reason: outputs[id].reason }) }]));
    const reviewers = reviewersOf(route);
    const reviews = Object.fromEntries(reviewers.map((id) => [id, loadReview(runDir, id)]));
    for (const m of reviewers) {
        models[m] ??= {};
        const rs = reviewStatus(runDir, m);
        if (rs && rs !== 'ok') models[m].review = rs;
        // Had finds to check but no review arrived: say so rather than quietly showing them unreviewed.
        else if (!reviews[m] && reviewInput(runDir, m, route).length) models[m].review = 'missing';
    }
    const leads = mergeCandidates({ outputs, route, reviews });

    // Patches apply once per run (finished_runs); a rerun (push redo) rebuilds the report from the stored result.
    const runDate = ctx.runDate ?? run.slice(0, 10);
    const outcome = await applyRun(db, runDir, { run, runDate, now, outputs, route, models, leads, filter: loadFilter(repoDir) });
    // A trimmed searcher saw fewer assignments; the report says so (also on a rebuild from the stored result).
    const lighter = Object.entries(route.trimmed ?? {}).map(([id, t]) => `${label(id)} ran a lighter pass: ${t.dropped} assignments dropped to fit its context`);

    // How long the run took, measured once on its first finish; a rerun keeps it.
    const prior = readJson(join(runDir, 'report.json'), null);
    const startedAt = prior?.startedAt ?? ctx.startedAt;
    const durationMs = prior?.durationMs ?? (startedAt ? Math.max(0, Date.parse(now) - Date.parse(startedAt)) : undefined);
    const ghUrl = process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : prior?.ghUrl;
    const report = {
        ...buildReport({ run, workflow: ctx.workflow, finishedAt: now, models, leads, ...outcome,
            labels: Object.fromEntries(Object.keys(models).map((id) => [id, label(id)])),
            notes: [...lighter, ...(outcome.notes ?? [])] }),
        reviewers,
        ...(outcome.sweep && { sweep: outcome.sweep }),
        ...(ctx.topic && { topic: ctx.topic }),
        ...(ctx.workflow === 'culture' && { sourcesChecked: checkedSources(Object.values(outputs), ctx.sources ?? []) }),
        ...(startedAt && { startedAt }),
        ...(ghUrl && { ghUrl }),
        ...(durationMs != null && !Number.isNaN(durationMs) && { durationMs }),
    };
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(runDir, 'report.md'), renderReportMd(report));

    const indexPath = join(repoDir, 'runs', 'index.json');
    const index = existsSync(indexPath) ? readJson(indexPath, []) : [];
    const row = { run, workflow: ctx.workflow, ...(ctx.topic && { topic: ctx.topic }), finishedAt: now, ...(ghUrl && { ghUrl }), ...(report.durationMs != null && { durationMs: report.durationMs }), counts: report.counts, models };
    writeFileSync(indexPath, JSON.stringify([row, ...index.filter((x) => x.run !== run)].sort((a, b) => b.run.localeCompare(a.run)), null, 2) + '\n');
    return report;
}

// Names a finished run dropped for the new-company limit, from its report (patch refusals and finds' notes).
export function droppedForLimit(report) {
    const limit = /new-companies limit/;
    return [...new Set([
        ...(report?.refused ?? []).filter((x) => limit.test(x.reason)).map((x) => x.company),
        ...(report?.notes ?? []).filter((n) => limit.test(n)).map((n) => n.slice(0, n.lastIndexOf(':'))),
    ])].filter(Boolean);
}

// Adds what a finished run dropped for the new-company limit: those companies' patches (only for ones that
// still don't exist; a later run may have made them) and their finds as postings under the original run.
// Once per run (`recover:<run>` in finished_runs). Returns what it did.
export async function recoverDropped(db, runDir, now = new Date().toISOString()) {
    const run = basename(runDir);
    const marker = `recover:${run}`;
    const names = droppedForLimit(readJson(join(runDir, 'report.json'), null));
    if (await finishedResult(db, marker)) return { run, skipped: 'already recovered', ...(await markRecovered(db, names)) };
    if (!names.length) return { run, skipped: 'nothing was dropped' };
    const route = readRoute(runDir);
    const outputs = Object.fromEntries(route.searchers.map((id) => [id, readModelOutput(join(runDir, id))]));
    const ok = route.searchers.filter((id) => outputs[id].status === 'ok');
    const dropped = (name) => names.some((n) => sameCompany(n, name));
    const { shown, nearMisses } = splitLeads(mergeCandidates({ outputs, route, reviews: {} }));
    for (let attempt = 1; ; attempt++) {
        const cRows = await loadAll(db, 'companies');
        const pRows = await loadAll(db, 'postings');
        const companies = cRows.map((r) => r.record);
        // Only companies still missing take patch fields: an existing record has moved on since the run.
        const missing = (name) => dropped(name) && !findCompany(companies, name);
        const patches = Object.fromEntries(ok.map((id) => [id, outputs[id].patch.filter((row) => missing(row.company))]));
        const patched = applyPatches({ companies, base: companies, patches, order: ok, limit: Infinity });
        const att = attachRun({ companies: patched.companies, postings: pRows.map((r) => r.record) }, {
            run, leads: shown.filter((l) => dropped(l.company)), nearMisses: nearMisses.filter((l) => dropped(l.company)),
            models: Object.keys(outputs), newAllowance: Infinity,
        });
        const before = new Map([...cRows.map((r) => [`c:${r.id}`, JSON.stringify(r.record)]), ...pRows.map((r) => [`p:${r.id}`, JSON.stringify(r.record)])]);
        const rows = (list, src, idOf, prefix) => {
            const versions = new Map(src.map((r) => [r.id, r.version]));
            return list.filter((rec) => JSON.stringify(rec) !== before.get(`${prefix}:${idOf(rec)}`)).map((record) => ({ id: idOf(record), version: versions.get(idOf(record)) ?? null, record }));
        };
        const created = att.companies.length - companies.length;
        const postings = att.postings.length - pRows.length;
        const result = { recovered: run, names, created, postings, changes: [...patched.changes, ...att.changes], refused: patched.refused };
        try {
            await writeRows(db, {
                companies: rows(att.companies, cRows, (c) => c.key, 'c'),
                postings: rows(att.postings, pRows, (p) => p.id, 'p'),
                finishedRun: { run: marker, at: now, result },
            });
            return { run, dropped: names.length, created, postings };
        } catch (e) {
            if (!e.stale || attempt >= MAX_TRIES) throw e;
        }
    }
}

// A recovery from before `newFromRun` existed left its companies unflagged, so New skipped the non-Top ones.
// Flags the dropped names that still carry only a model's stance. Safe to repeat.
async function markRecovered(db, names) {
    for (let attempt = 1; ; attempt++) {
        const rows = (await loadAll(db, 'companies')).filter((r) => r.record.stanceBy && !r.record.newFromRun && names.some((n) => sameCompany(n, r.record.name)));
        if (!rows.length) return { marked: 0 };
        try {
            await writeRows(db, { companies: rows.map((r) => ({ id: r.id, version: r.version, record: { ...r.record, newFromRun: true } })) });
            return { marked: rows.length };
        } catch (e) {
            if (!e.stale || attempt >= MAX_TRIES) throw e;
        }
    }
}
