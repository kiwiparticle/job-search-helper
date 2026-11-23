// The weekly tune run: reads the owner's Skip/Save reasons and proposes small edits to the search rules.
// A proposal is one find/replace in one allowed file, tied to that file's git blob sha. Applying it
// (bin/tune-apply.js) refuses when the file changed since, so an edit never lands on text it wasn't written for.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadAll, loadSome, writeRows, finishedResult } from './store.js';
import { loadModels, resolveRoute } from './models.js';

export const TUNE_FILES = ['instructions.md', 'instructions-local.md', 'data/sweep-filter.json'];
const MAX = { proposals: 8, find: 2000, replace: 4000, why: 600 };
const readIfThere = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// Git's blob id for a file's text: what `git hash-object` prints.
export const blobSha = (text) => {
    const body = Buffer.from(text, 'utf8');
    return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
};

// Every reason given on or after `since` (a day), with the job it was given on.
export function collectReasons(companies, since = '') {
    return companies.flatMap((c) => Object.entries(c.jobs ?? {}).flatMap(([postingId, j]) => (j.reasons ?? [])
        .filter((r) => r.at >= since)
        .map((r) => ({ company: c.name, role: j.role, postingId, state: r.state, reason: r.reason, at: r.at }))));
}

// The last tune's day, from its finished_runs row (`tune:<at>`), or '' when none ran.
async function lastTune(db) {
    const row = await db.prepare("SELECT max(at) AS at FROM finished_runs WHERE run LIKE 'tune:%'").first();
    return row?.at ? String(row.at).slice(0, 10) : '';
}

// Writes context.json for the model. Returns the model id and the reason count (0: nothing to tune, skip the model).
export async function prepareTune(db, dir, repoDir) {
    const companies = (await loadAll(db, 'companies')).map((r) => r.record);
    const since = await lastTune(db);
    const reasons = collectReasons(companies, since);
    const model = resolveRoute(loadModels(repoDir), { workflow: 'tune' }).searchers[0];
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'context.json'), JSON.stringify({ since, reasons, files: TUNE_FILES }, null, 2) + '\n');
    return { model, count: reasons.length };
}

// Model output is untrusted: keep at most 8 proposals, each naming an allowed file with text it can find.
export function cleanProposals(raw) {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.proposals) ? raw.proposals : [];
    const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v : null);
    return list.flatMap((p) => {
        const file = TUNE_FILES.includes(p?.file) ? p.file : null;
        const find = str(p?.find, MAX.find);
        const replace = typeof p?.replace === 'string' && p.replace.length <= MAX.replace ? p.replace : null;
        const why = str(p?.why, MAX.why);
        return file && find && replace !== null && why && find !== replace ? [{ file, find, replace, why: why.trim() }] : [];
    }).slice(0, MAX.proposals);
}

const occurrences = (text, find) => text.split(find).length - 1;

// Saves the proposals whose `find` text occurs exactly once in the current file, each with the file's blob sha.
// `at` (fixed when the run was set up) names the run, so a retried finish records nothing twice.
export async function finishTune(db, dir, repoDir, at) {
    const run = `tune:${at}`;
    if (await finishedResult(db, run)) return { saved: 0, dropped: [] };
    if (readIfThere(join(dir, 'status.txt')).trim() !== 'ok') throw new Error('Model run did not finish ok');
    let raw;
    try { raw = JSON.parse(readFileSync(join(dir, 'proposals.json'), 'utf8')); } catch { raw = []; }
    const dropped = [];
    const rows = cleanProposals(raw).flatMap((p, i) => {
        const text = readIfThere(join(repoDir, p.file));
        if (occurrences(text, p.find) !== 1) { dropped.push(`${p.file}: the text to replace is not there exactly once`); return []; }
        const id = `${run}:${i + 1}`;
        return [{ id, version: null, record: { id, ...p, baseSha: blobSha(text), at, status: 'open' } }];
    });
    await writeRows(db, { tune: rows, finishedRun: { run, at, result: { saved: rows.length, dropped } } });
    return { saved: rows.length, dropped };
}

// tune-apply.yml, step 1: make the one edit in the working tree. Refuses (status `stale`) when the file changed
// since the proposal was written. Returns 'edited', or 'done' when it was applied already.
export async function applyEdit(db, id, repoDir) {
    const row = (await loadSome(db, 'tune', [id])).get(id);
    if (!row) throw new Error(`No proposal ${id}`);
    const p = row.record;
    if (p.status === 'applied') return 'done';
    if (p.status !== 'applying' || !TUNE_FILES.includes(p.file)) throw new Error('That proposal is not waiting to be applied.');
    const path = join(repoDir, p.file);
    const text = readIfThere(path);
    // An earlier try pushed the edit but stopped before marking it: the file already has it.
    if (occurrences(text, p.find) === 0 && p.replace && occurrences(text, p.replace) === 1) return 'done';
    if (blobSha(text) !== p.baseSha || occurrences(text, p.find) !== 1) {
        await writeRows(db, { tune: [{ id, version: row.version, record: { ...p, status: 'stale', error: `${p.file} changed since this was proposed.` } }] });
        throw new Error(`${p.file} changed since this was proposed`);
    }
    writeFileSync(path, text.replace(p.find, () => p.replace));
    return 'edited';
}

// Step 2, after the commit is pushed.
export async function markApplied(db, id) {
    const row = (await loadSome(db, 'tune', [id])).get(id);
    if (!row || row.record.status === 'applied') return;
    await writeRows(db, { tune: [{ id, version: row.version, record: { ...row.record, status: 'applied' } }] });
}
