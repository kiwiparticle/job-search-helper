import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findCompany } from './companies.js';
import { sameCompany } from './keys.js';
import { loadAll, writeRows, finishedResult } from './store.js';
import { CAPS, MODEL_FIELDS, capText } from './caps.js';
import { cleanPatch, readPatchFile } from './readModelOutput.js';
import { fnv1a } from './postingId.js';
import { threadPath, appendAskMany, contextMessages } from './ask.js';

const MAX_TRIES = 3;
const readJson = (p, fallback) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};
const read = (p) => {
    try { return readFileSync(p, 'utf8'); } catch { return ''; }
};

const loadThread = (repoDir, company) => readJson(join(repoDir, threadPath(company)), { company, messages: [] });

// The newest run that screened this company, lead or near miss.
export function findLead(repoDir, company) {
    for (const { run } of readJson(join(repoDir, 'runs', 'index.json'), [])) {
        const r = readJson(join(repoDir, 'runs', run, 'report.json'), null);
        const hit = [...(r?.leads ?? []), ...(r?.nearMisses ?? [])].find((l) => sameCompany(l.company, company));
        if (hit) return { ...hit, run };
    }
    return null;
}

const slim = ({ id, role, url, firstSeen, firstRun, lastRun, posted, wasLead, pay }) => ({ id, role, url, firstSeen, firstRun, lastRun, posted, wasLead, pay });

// Writes everything the model needs for one ask, and clears the previous ask's outputs.
export async function prepareAsk(db, repoDir, askDir, { company, question }) {
    mkdirSync(askDir, { recursive: true });
    for (const f of ['answer.md', 'ledger-patch.json', 'status.txt']) rmSync(join(askDir, f), { force: true });
    const rec = findCompany((await loadAll(db, 'companies')).map((r) => r.record), company);
    const { events, ...row } = rec ?? {};
    const postings = rec ? (await loadAll(db, 'postings')).map((r) => r.record).filter((p) => p.companyKey === rec.key).map(slim) : [];
    const context = {
        company,
        question,
        thread: contextMessages(loadThread(repoDir, company)),
        row: rec ? row : null,
        postings,
        lead: findLead(repoDir, company),
    };
    writeFileSync(join(askDir, 'context.json'), JSON.stringify(context, null, 2) + '\n');
}

// A reply's patch for this company, cleaned to MODEL_FIELDS. Null when nothing is left.
function makeProposal(rec, { model, answer, patch }, at) {
    const [clean] = cleanPatch((patch ?? []).filter((p) => p.company && sameCompany(p.company, rec.name)));
    if (!clean) return null;
    const { company: _name, ...changes } = clean;
    const fields = Object.keys(changes).filter((f) => MODEL_FIELDS.includes(f));
    if (!fields.length) return null;
    const kept = Object.fromEntries(fields.map((f) => [f, changes[f]]));
    const base = Object.fromEntries(fields.map((f) => [f, rec[f] ?? (f === 'rolesSkipped' ? [] : '')]));
    const text = capText((answer ?? '').trim().split('\n')[0], CAPS.verdict) ?? '';
    return { id: fnv1a(model + at + JSON.stringify(kept)), by: model, at, text, base, changes: kept };
}

// Pushes one reply's proposal onto the company, with its finished-run marker in the same batch.
// A stale write reloads and redoes; an already-finished id writes nothing.
async function saveProposal(db, company, reply, at) {
    const run = `ask:${company.key}:${at}:${reply.model}`;
    for (let attempt = 1; ; attempt++) {
        if (await finishedResult(db, run)) return;
        const row = (await loadAll(db, 'companies')).find((r) => r.id === company.key);
        const proposal = row && makeProposal(row.record, reply, at);
        if (!proposal) return;
        const record = { ...row.record, proposals: [...(row.record.proposals ?? []).filter((p) => p.id !== proposal.id), proposal] };
        try {
            await writeRows(db, { companies: [{ id: row.id, version: row.version, record }], finishedRun: { run, at, result: {} } });
            return;
        } catch (e) {
            if (!e.stale || attempt >= MAX_TRIES) throw e;
        }
    }
}

// targets: [{ askDir, model }], one per model asked. They share one question, so it's saved once.
// `at` is fixed at dispatch (never now), so a redo after a failed push matches the first try.
export async function finishAskMany(db, repoDir, targets, { at }) {
    if (!at) throw new Error('missing at');
    const ctx = readJson(join(targets[0].askDir, 'context.json'), null);
    if (!ctx) throw new Error('no ask context');
    const rec = findCompany((await loadAll(db, 'companies')).map((r) => r.record), ctx.company);
    const replies = targets.map(({ askDir, model }) => {
        const status = read(join(askDir, 'status.txt')).trim() || 'failed';
        return { model, status, answer: status === 'ok' ? read(join(askDir, 'answer.md')) : '', patch: readPatchFile(join(askDir, 'ledger-patch.json')).patch };
    });
    if (rec) for (const r of replies) if (r.status === 'ok') await saveProposal(db, rec, r, at);
    const thread = appendAskMany(loadThread(repoDir, ctx.company), { question: ctx.question, replies, at });
    const out = join(repoDir, threadPath(ctx.company));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(thread, null, 2) + '\n');
    return thread;
}

export const finishAsk = (db, repoDir, askDir, { model, at }) => finishAskMany(db, repoDir, [{ askDir, model }], { at });
