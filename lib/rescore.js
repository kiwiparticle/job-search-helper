// Re-check: re-scores saved, applying and flagged jobs (fit) and their companies' fingerprints against today's rules, from stored
// notes only (docs/superpowers/plans/2026-11-23-rescore.md). The model never searches; it reads context.json.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAll, loadSome, writeRows, finishedResult } from './store.js';
import { loadModels, resolveRoute } from './models.js';
import { companyOf, inRescoreScope, isProtected } from './tags.js';
import { fingerprintScore } from './companies.js';
import { notesOf } from './notes.js';
import { CAPS } from './caps.js';

const WHY = 400;
const batches = (ids) => Array.from({ length: Math.ceil(ids.length / 90) }, (_, i) => ids.slice(i * 90, i * 90 + 90)); // D1 allows 100 variables a query
const loadMany = async (db, table, ids) => {
    const out = new Map();
    for (const b of batches(ids)) for (const [k, v] of await loadSome(db, table, b)) out.set(k, v);
    return out;
};

// Saved and flagged jobs that have a posting row, at companies not Ruled out and without an application for the posting.
export function pickJobs(companies, postings) {
    const jobs = [];
    const byCompany = new Map();
    const byKey = new Map(companies.map((c) => [c.key, c]));
    for (const p of postings) {
        const c = companyOf(companies, p);
        if (!c || !inRescoreScope(c, p)) continue;
        jobs.push({ postingId: p.id, companyKey: c.key, role: p.role, fit: p.fit ?? null,
            posting: { role: p.role, pay: p.pay ?? p.payEstimate ?? '', location: p.location ?? '', ...(p.overview && { overview: p.overview }), modelSays: p.modelSays ?? '' } });
        if (!byCompany.has(c.key)) byCompany.set(c.key, []);
        byCompany.get(c.key).push(p);
    }
    const out = [...byCompany].map(([key, ps]) => {
        const c = byKey.get(key);
        const notes = [...notesOf(c).map((n) => n.text), ...ps.flatMap((p) => notesOf(c, p.id).map((n) => `${p.role}: ${n.text}`))];
        return { key, name: c.name, fingerprint: c.fingerprint ?? '', culture: c.culture ?? '', domain: c.domain ?? '', size: c.size ?? '',
            founded: c.founded ?? '', funding: c.funding ?? '', stability: c.stability ?? '', verdict: c.verdict ?? '', notes };
    });
    return { jobs, companies: out };
}

// Writes context.json for the model. Returns { model, count }; count 0 skips the model.
export async function prepareRescore(db, dir, repoDir) {
    const companies = (await loadAll(db, 'companies')).map((r) => r.record);
    const postings = (await loadAll(db, 'postings')).map((r) => r.record);
    const ctx = pickJobs(companies, postings);
    const model = resolveRoute(loadModels(repoDir), { workflow: 'rescore' }).searchers[0];
    mkdirSync(dir, { recursive: true });
    const rubric = { instructions: 'instructions.md (the section whose heading contains "fingerprint")', fit: 'prompts/search.md (paragraph "`fit` is how much the owner would want this job")' };
    writeFileSync(join(dir, 'context.json'), JSON.stringify({ ...ctx, rubric }, null, 2) + '\n');
    return { model, count: ctx.jobs.length };
}

// Model output is untrusted: known ids only, fit 1-5, fingerprint 0-5 or null, text that agrees with its score.
export function cleanRescore(raw, ctx) {
    const jobIds = new Set(ctx.jobs.map((j) => j.postingId));
    const keys = new Set(ctx.companies.map((c) => c.key));
    const jobs = new Map();
    const companies = new Map();
    let dropped = 0;
    for (const j of Array.isArray(raw?.jobs) ? raw.jobs : []) {
        if (!j || !jobIds.has(j.postingId) || jobs.has(j.postingId) || !Number.isInteger(j.fit) || j.fit < 1 || j.fit > 5) { dropped++; continue; }
        jobs.set(j.postingId, { fit: j.fit, why: typeof j.why === 'string' ? j.why.trim().slice(0, WHY) : '' });
    }
    for (const c of Array.isArray(raw?.companies) ? raw.companies : []) {
        const fp = c?.fingerprint;
        if (!c || !keys.has(c.key) || companies.has(c.key) || !(fp === null || (Number.isInteger(fp) && fp >= 0 && fp <= 5))) { dropped++; continue; }
        const text = typeof c.fingerprintText === 'string' ? c.fingerprintText.trim().slice(0, CAPS.fingerprint) : '';
        const agrees = fp === null ? /^unscored/i.test(text) : new RegExp(`^${fp}\\s*/\\s*5`).test(text);
        companies.set(c.key, { fingerprint: fp, text: agrees ? text : null });
    }
    return { jobs, companies, dropped };
}

const day = (at) => String(at).slice(0, 10);
const arrow = (a, b) => `${a ?? '–'}→${b ?? '–'}`;

// Pure. The posting with its new fit and `rescore`, and a company event when fit or the fingerprint score moved.
export function applyRescore(posting, company, job, co, { by, at }) {
    const fitFrom = posting.fit ?? null;
    const fingerprintFrom = fingerprintScore(company.fingerprint);
    const fingerprintTo = co ? co.fingerprint : fingerprintFrom;
    const rescore = { at, by, fitFrom, fitTo: job.fit, fingerprintFrom, fingerprintTo, why: job.why };
    return { posting: { ...posting, fit: job.fit, rescore }, event: fitFrom !== job.fit ? `Re-check: ${posting.role}: fit ${arrow(fitFrom, job.fit)}` : null };
}

// Pure. The company with the model's new fingerprint text, or null when there is nothing safe to write.
export function applyFingerprint(company, co, sentText, { at }) {
    if (!co?.text || co.text === company.fingerprint || isProtected(company) || (company.fingerprint ?? '') !== sentText) return null;
    const event = `Re-check: fingerprint ${arrow(fingerprintScore(company.fingerprint), co.fingerprint)} (was: ${company.fingerprint || 'none'})`;
    return { company: { ...company, fingerprint: co.text, events: [...(company.events ?? []), { date: day(at), text: event }] }, event };
}

// Saves the model's scores once per run (`rescore:<at>`). Reads rows fresh; a concurrent page write retries once.
export async function finishRescore(db, dir, ctxDir, { at, model }) {
    const run = `rescore:${at}`;
    const done = await finishedResult(db, run);
    if (done) return done;
    let status = '';
    try { status = readFileSync(join(dir, 'status.txt'), 'utf8').trim(); } catch { /* none */ }
    if (status !== 'ok') throw new Error('Model run did not finish ok');
    const ctx = JSON.parse(readFileSync(join(ctxDir, 'context.json'), 'utf8'));
    let raw;
    try { raw = JSON.parse(readFileSync(join(dir, 'rescore.json'), 'utf8')); } catch { throw new Error('Model wrote no usable rescore.json'); }
    const { jobs, companies, dropped } = cleanRescore(raw, ctx);
    if (ctx.jobs.length && !jobs.size) throw new Error('Model wrote no usable rescore.json'); // nothing recorded, so a re-run works
    const keyOf = new Map(ctx.jobs.map((j) => [j.postingId, j.companyKey]));
    const sent = new Map(ctx.companies.map((c) => [c.key, c.fingerprint]));
    const attempt = async () => {
        const postingRows = await loadMany(db, 'postings', [...jobs.keys()]);
        const companyRows = await loadMany(db, 'companies', [...new Set([...jobs.keys()].map((id) => keyOf.get(id)))]);
        const next = new Map([...companyRows].map(([k, r]) => [k, { ...r.record }]));
        const touched = new Set();
        const postings = [];
        let changed = 0, rewritten = 0, skipped = 0;
        // Fingerprint text first: a posting records the new fingerprint score only when the text was written with it.
        const written = new Set();
        for (const key of new Set([...jobs.keys()].filter((id) => postingRows.has(id)).map((id) => keyOf.get(id)))) {
            const co = companies.get(key);
            if (!next.has(key)) continue;
            const fp = co && applyFingerprint(next.get(key), co, sent.get(key) ?? '', { at });
            if (fp) { next.set(key, fp.company); rewritten++; touched.add(key); written.add(key); }
            else if (co?.text && co.text !== next.get(key).fingerprint) skipped++;
        }
        for (const [id, job] of jobs) {
            const row = postingRows.get(id);
            const key = keyOf.get(id);
            const c = next.get(key);
            if (!row || !c) continue;
            const r = applyRescore(row.record, companyRows.get(key).record, job, written.has(key) ? companies.get(key) : null, { by: model, at });
            postings.push({ id, version: row.version, record: r.posting });
            if (r.event) { changed++; c.events = [...(c.events ?? []), { date: day(at), text: r.event }]; touched.add(key); }
        }
        const result = { changed, unchanged: postings.length - changed, rewritten, skipped, dropped };
        await writeRows(db, {
            postings,
            companies: [...touched].map((key) => ({ id: key, version: companyRows.get(key).version, record: next.get(key) })),
            finishedRun: { run, at, result },
        });
        return result;
    };
    try { return await attempt(); } catch (e) { if (!e.stale) throw e; return attempt(); }
}
