import { sameCompany } from './keys.js';
import { findCompany, possibleDuplicate, blankCompany, URL_FIELDS } from './companies.js';
import { isProtected, activeApplication } from './tags.js';
import { CAPS, MODEL_FIELDS } from './caps.js';

export { MODEL_FIELDS };

const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const http = (v) => /^https?:\/\//i.test(v);
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(';')).map((x) => String(x).trim()).filter(Boolean);
const same = (a, b) => (a ?? '') === (b ?? '');

// Applies the searchers' patch rows to the companies. Pure: no I/O.
// `base` is the companies as they were when the run started (null when unreadable: no company field is written).
// `order` is the route's searcher order: per field, the first searcher with a value wins.
// Owner guards: a protected company takes nothing; a field that moved since `base` is skipped;
// a stance the owner set (no `stanceBy`) is never changed by a run; `To review` never changes;
// Ruled out is saved as `ruleOutSuggested` for the owner to confirm, never set.
export function applyPatches({ companies, base, patches, order = Object.keys(patches), limit: maxNew }) {
    let next = [...companies];
    const changes = [];
    const refused = [];
    const bys = order.filter((by) => patches[by]);

    // One group per company, with each searcher's rows merged (a later non-empty value wins within one searcher).
    const groups = [];
    for (const by of bys) {
        for (const row of patches[by]) {
            if (!row?.company) continue;
            const g = groups.find((x) => sameCompany(x.name, row.company)) ?? (groups.push({ name: row.company, parts: {} }), groups.at(-1));
            const part = (g.parts[by] ??= {});
            for (const f of MODEL_FIELDS) if (!empty(row[f])) part[f] = f === 'rolesSkipped' ? [...list(part[f]), ...list(row[f])] : row[f];
        }
    }

    // Each searcher gets its own allowance, so a second searcher's finds aren't crowded out by the first's.
    const limit = maxNew ?? CAPS.newCompanies * Math.max(1, bys.length);
    let created = 0;
    for (const g of groups) {
        const from = bys.filter((by) => g.parts[by]);
        const existing = findCompany(next, g.name);
        if (existing && isProtected(existing)) {
            const reason = activeApplication(existing) ? 'active application' : 'ruled out';
            for (const by of from) refused.push({ company: existing.name, by, reason });
            continue;
        }
        let rec = existing ? { ...existing } : null;
        if (!rec) {
            if (created >= limit) {
                for (const by of from) refused.push({ company: g.name, by, reason: `over the ${limit}-new-companies limit` });
                continue;
            }
            created++;
            // A run made it: New lists it while a model's stance stands (see newQueue).
            rec = { ...blankCompany(g.name), newFromRun: true };
            const dup = possibleDuplicate(next, g.name);
            if (dup) rec.possibleDuplicateOf = dup.key;
        }
        // A new record is its own starting point, so nothing about it can be stale.
        const baseRec = existing ? (base ? findCompany(base, existing.name) ?? blankCompany(existing.name) : null) : rec;
        const fields = {};
        const skip = (f, by, reason) => refused.push({ company: rec.name, by, reason: `${f}: ${reason}` });

        for (const f of MODEL_FIELDS) {
            let props = from.filter((by) => !empty(g.parts[by][f])).map((by) => [by, g.parts[by][f]]);
            if (URL_FIELDS.includes(f)) props = props.filter(([, v]) => http(v));
            if (!props.length) continue;

            if (f === 'rolesSkipped') {
                // Add only, never stale: it cannot overwrite anything.
                const added = [...new Set(props.flatMap(([, v]) => list(v)))].filter((r) => !list(rec.rolesSkipped).includes(r));
                if (!added.length) continue;
                fields[f] = { from: rec[f], to: [...list(rec[f]), ...added] };
                rec[f] = fields[f].to;
                continue;
            }
            const [by, value] = props[0];
            // Links are fill-only: a stored link is never touched.
            if (URL_FIELDS.includes(f) ? !empty(rec[f]) : same(value, rec[f])) continue;
            if (!baseRec) { skip(f, by, 'could not read the starting point'); continue; }
            if (!same(rec[f], baseRec[f])) { skip(f, by, 'changed since the run started'); continue; }
            if (f === 'stance') {
                if (value === 'To review' || rec.stance === 'To review') continue;
                if (!empty(rec.stance) && !rec.stanceBy) { skip(f, by, 'stance set by you'); continue; }
                // Ruled out is only a suggestion: the owner confirms it on the Passed page (a wrong one hides a good company).
                if (value === 'Ruled out') {
                    const next = { by, reason: g.parts[by].reason ?? '' };
                    if (JSON.stringify(rec.ruleOutSuggested) === JSON.stringify(next)) continue;
                    fields.ruleOutSuggested = { from: rec.ruleOutSuggested, to: next };
                    rec.ruleOutSuggested = next;
                    continue;
                }
                fields.stance = { from: rec.stance, to: value };
                fields.stanceBy = { from: rec.stanceBy, to: by };
                rec.stance = value;
                rec.stanceBy = by;
                continue;
            }
            fields[f] = { from: rec[f], to: value };
            rec[f] = value;
        }

        next = existing ? next.map((r) => (r === existing ? rec : r)) : [...next, rec];
        if (!existing || Object.keys(fields).length) changes.push({ company: rec.name, by: from.join('+'), fields });
    }

    return { companies: next, changes, refused };
}
