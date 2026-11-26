// Title triage (docs/superpowers/specs/2026-11-23-title-triage-design.md): a short model pass that keeps or drops each
// swept role nobody judged yet, from its title, company and the posting's own text. Kept roles go to tracked judging first.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAll, loadSome, writeRows, finishedResult } from './store.js';
import { loadModels, resolveRoute } from './models.js';
import { pool, readPosting } from './postingCheck.js';
import { knownBoard } from './boardSweep.js';
import { companyOf, jobEntry, applicationFor, activeApplication } from './tags.js';
import { findPay } from './findPay.js';

export const TRIAGE_PER_RUN = 80;
export const FILTERED_PER_RUN = 250;
const MAX = { reason: 200 };

// Roles to triage, newest first. `filtered`: the roles the sweep filter dropped, for the model to rescue.
export function pickRoles(companies, postings, { filtered = false } = {}) {
    const limit = filtered ? FILTERED_PER_RUN : TRIAGE_PER_RUN;
    return postings.filter((p) => {
        if (p.triage || p.source !== 'sweep' || p.posted === 'no') return false;
        if (filtered ? !(p.modelSays === 'pass' && p.filteredBy != null) : p.modelSays !== '') return false;
        const c = companyOf(companies, p);
        return Boolean(c && c.stance !== 'Ruled out' && !c.sweepOff && !activeApplication(c) && !jobEntry(c, p) && !applicationFor(c, p));
    }).sort((a, b) => String(b.firstRun).localeCompare(String(a.firstRun))).slice(0, limit);
}

// Writes context.json for the model and marks dead postings gone. Returns { model, count, gone }; count 0 skips the model.
export async function prepareTriage(db, dir, repoDir, { filtered = false, now, deps }) {
    const companies = (await loadAll(db, 'companies')).map((r) => r.record);
    const rows = await loadAll(db, 'postings');
    const picked = pickRoles(companies, rows.map((r) => r.record), { filtered });
    const boards = new Map();
    const read = new Map();
    const all = rows.map((r) => r.record);
    await pool(picked.map((p) => ({ p })), 6, async ({ p }) => read.set(p.id, await readPosting(p, deps, { boards, board: knownBoard(companyOf(companies, p), all) })));
    const today = now.slice(0, 10);
    const gone = picked.filter((p) => read.get(p.id).state === 'gone');
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (gone.length) await writeRows(db, { postings: gone.map((p) => ({ id: p.id, version: byId.get(p.id).version, record: { ...p, posted: 'no', goneAt: today, postedCheckedAt: now } })) });
    const roles = picked.filter((p) => read.get(p.id).state !== 'gone').map((p) => {
        const c = companyOf(companies, p);
        const { state, text } = read.get(p.id);
        return {
            id: p.id, company: c.name, about: [c.domain, c.size].filter(Boolean).join(' · ').slice(0, 300), title: p.role,
            location: p.location ?? '', pay: findPay(text) ?? '', ...(p.filterReason && { filterReason: p.filterReason }),
            posting: state === 'ok' && text ? text : '(could not read the posting: judge from the title)',
        };
    });
    const model = resolveRoute(loadModels(repoDir), { workflow: 'triage' }).searchers[0];
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'context.json'), JSON.stringify({ filtered, roles }, null, 2) + '\n');
    return { model, count: roles.length, gone: gone.length };
}

// Model output is untrusted: one entry per known id, keep a boolean, fit 1-5 or none, a short reason.
export function cleanTriage(raw, ids) {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.roles) ? raw.roles : [];
    const known = new Set(ids);
    const out = new Map();
    for (const t of list) {
        if (!t || !known.has(t.id) || out.has(t.id) || typeof t.keep !== 'boolean') continue;
        const fit = Number.isInteger(t.fit) && t.fit >= 1 && t.fit <= 5 ? t.fit : undefined;
        const reason = typeof t.reason === 'string' ? t.reason.trim().slice(0, MAX.reason) : '';
        out.set(t.id, { keep: t.keep, ...(fit && { fit }), reason });
    }
    return out;
}

// Pure. The posting after triage, or null when it was judged or triaged since prepare.
export function applyTriage(p, t, by, at) {
    if (p.triage) return null;
    const isFiltered = p.modelSays === 'pass' && p.filteredBy != null;
    if (p.modelSays !== '' && !isFiltered) return null;
    const next = { ...p, triage: { by, at, ...t } };
    if (t.keep && isFiltered) { delete next.filteredBy; delete next.filterReason; next.modelSays = ''; }
    if (!t.keep && !isFiltered) next.modelSays = 'pass';
    return next;
}

// Saves the model's verdicts once per run (`triage:<at>`).
export async function finishTriage(db, dir, ctxDir, { at, model, ghRun }) {
    const run = `triage:${at}`;
    if (await finishedResult(db, run)) return { kept: 0, dropped: 0, missing: 0 };
    let status = '';
    try { status = readFileSync(join(dir, 'status.txt'), 'utf8').trim(); } catch { /* none */ }
    if (status !== 'ok') throw new Error('Model run did not finish ok');
    const ids = JSON.parse(readFileSync(join(ctxDir, 'context.json'), 'utf8')).roles.map((r) => r.id);
    let raw;
    try { raw = JSON.parse(readFileSync(join(dir, 'triage.json'), 'utf8')); } catch { raw = []; }
    const verdicts = cleanTriage(raw, ids);
    const rows = new Map();
    const asked = [...verdicts.keys()];
    for (let i = 0; i < asked.length; i += 90) for (const [k, v] of await loadSome(db, 'postings', asked.slice(i, i + 90))) rows.set(k, v); // D1 allows 100 variables a query
    const postings = [...verdicts].flatMap(([id, t]) => {
        const row = rows.get(id);
        const record = row && applyTriage(row.record, t, model, at);
        return record ? [{ id, version: row.version, record }] : [];
    });
    const kept = postings.filter((p) => p.record.triage.keep).length;
    const result = { kept, dropped: postings.length - kept, missing: ids.length - verdicts.size };
    const summary = `${ids.length} roles · kept ${kept} · dropped ${result.dropped}${result.missing ? ` · ${result.missing} not answered` : ''}`;
    await writeRows(db, { postings, finishedRun: { run, at, result: { ...result, ghRun, summary } } });
    return result;
}
