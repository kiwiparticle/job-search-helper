import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findCompany, fingerprintEmpty } from './companies.js';
import { sameCompany } from './keys.js';
import { loadAll, writeRows, finishedResult } from './store.js';
import { cleanPatch } from './readModelOutput.js';

const FIELDS = ['website', 'size', 'founded', 'funding', 'stability', 'culture', 'facts', 'fingerprint', 'awards'];
const MAX_TRIES = 3;
const readIfThere = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

export async function prepareFill(db, dir, company) {
    const record = findCompany((await loadAll(db, 'companies')).map((r) => r.record), company);
    if (!record) throw new Error(`No record for ${company}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'context.json'), JSON.stringify({ company: record.name }));
}

// Owner-requested, so allowed on protected companies, but only the fact fields in FIELDS and only into empty ones
// (an unscored fingerprint counts as empty).
// `at` (fixed at dispatch) names the run, so a redo after a failed push writes nothing twice.
export async function finishFill(db, dir, { today, at }) {
    if (readIfThere(join(dir, 'status.txt')).trim() !== 'ok') throw new Error('Model run did not finish ok');
    const { company } = JSON.parse(readFileSync(join(dir, 'context.json'), 'utf8'));
    const raw = JSON.parse(readFileSync(join(dir, 'facts.json'), 'utf8'));
    if (typeof raw?.company === 'string' && !sameCompany(raw.company, company)) throw new Error(`facts.json is for ${raw.company}, not ${company}`);
    // An old status word must not sink the facts: only the facts are used here.
    const { status, stance, ...facts } = raw ?? {};
    const [clean] = cleanPatch([{ ...facts, company }]);
    if (!clean) throw new Error('facts.json unusable');
    for (let attempt = 1; ; attempt++) {
        const row = findRow(await loadAll(db, 'companies'), company);
        if (!row) throw new Error(`No record for ${company}`);
        const run = `fill:${row.id}:${at}`;
        if (await finishedResult(db, run)) return;
        const record = { ...row.record };
        delete record.fillRequested;
        const fill = FIELDS.filter((f) => clean[f] && (f === 'fingerprint' ? fingerprintEmpty(record[f]) : !record[f]));
        for (const f of fill) record[f] = clean[f];
        if (fill.length) Object.assign(record, { factsUpdated: today, factsSource: 'fill' });
        try {
            await writeRows(db, { companies: [{ id: row.id, version: row.version, record }], finishedRun: { run, at, result: {} } });
            return;
        } catch (e) {
            if (!e.stale || attempt >= MAX_TRIES) throw e;
        }
    }
}

const findRow = (rows, company) => {
    const rec = findCompany(rows.map((r) => r.record), company);
    return rows.find((r) => r.record === rec);
};
