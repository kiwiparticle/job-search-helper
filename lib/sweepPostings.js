// Turns a board sweep into posting rows. New senior roles arrive unjudged (modelSays ''); the owner or a `tracked` run judges them.
import { findCompany } from './companies.js';
import { leadKey } from './keys.js';
import { sameLink } from './postingId.js';
import { blankPosting } from './postingsFile.js';
import { rejectReason } from './sweepFilter.js';

const day = (s) => String(s ?? '').slice(0, 10);

// Pure. Returns the postings to write: new ones, and still-listed non-leads touched once a day so the monthly prune keeps them.
// `filter` (lib/sweepFilter.js): a new role it rejects is saved as a pass with `filteredBy` (the filter version). When the
// owner edits the filter (a new version), a still-listed role an older version filtered is checked again: it passes and goes
// back to unjudged, or stays filtered under the new version.
export function sweepPostings({ companies, postings, results, run, filter = null }) {
    const today = day(run);
    const byId = new Map(postings.map((p) => [p.id, p]));
    const out = new Map();
    for (const r of results.filter((x) => x.status === 'ok')) {
        const company = findCompany(companies, r.company);
        if (!company) continue;
        for (const role of r.roles) {
            const lk = leadKey(company.name, role.title);
            // The same job may already be recorded under another id (a model found it, under its own name for the role).
            if (byId.has(role.id) || postings.some((p) => p.companyKey === company.key && p.leadKey === lk) || sameLink(postings, company.key, role.url)) continue;
            const why = rejectReason(filter, { title: role.title, location: role.location });
            out.set(role.id, {
                ...blankPosting({ id: role.id, companyKey: company.key, leadKey: lk, role: role.title, url: role.url, source: 'sweep' }),
                ...(role.location && { location: role.location }),
                ...(why ? { modelSays: 'pass', filteredBy: filter.version, filterReason: why } : { modelSays: '' }),
                firstRun: run, lastRun: run,
            });
        }
        for (const id of r.seen ?? []) {
            const p = byId.get(id);
            if (!p || p.wasLead) continue;
            let next = day(p.lastRun) !== today ? { ...p, lastRun: run } : p;
            const url = r.urls?.[id];
            if (p.source === 'sweep' && url && url !== p.url) next = { ...next, url }; // the board's link beats an older one
            if (filter && p.filteredBy != null && p.filteredBy !== filter.version) {
                const why = rejectReason(filter, { title: p.role, location: p.location });
                next = { ...next };
                if (why) Object.assign(next, { filteredBy: filter.version, filterReason: why });
                else { delete next.filteredBy; delete next.filterReason; next.modelSays = ''; }
            }
            if (next !== p) out.set(id, next);
        }
    }
    return [...out.values()];
}
