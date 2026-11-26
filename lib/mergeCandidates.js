import { reviewersOf } from './models.js';
import { leadKey } from './keys.js';
import { boardId } from './postingId.js';
import { cleanChecks } from './checks.js';
import { cleanAssessment, cleanPayEstimate } from './assessment.js';

// Not openings worth showing as leads: skipped roles and companies only worth watching.
export const NEAR_MISS_VERDICTS = ['Skip', 'Near miss', 'Company worth watching'];
// All not-a-lead verdicts ("Skip", "Near misses", "Company worth watching") count as the same answer,
// and trailing asides ("— posting closed", "(ranked low)") don't change it.
export const verdictClass = (v) => {
    const s = String(v ?? '').split(/ — | \(/)[0].trim().toLowerCase();
    return NEAR_MISS_VERDICTS.some((n) => s.startsWith(n.toLowerCase())) ? 'not-a-lead' : s;
};
const opinion = (c) => (c ? {
    verdict: c.verdict, note: c.summary ?? c.note ?? '', checks: cleanChecks(c.checks),
    assessment: cleanAssessment(c.assessment), payEstimate: cleanPayEstimate(c.payEstimate),
} : null);

// Groups the searchers' candidates into one entry per posting: same board job id, or same company + role.
// Two different roles at one company stay two entries. Each entry is { key, [searcherId]: candidate }.
export function pairCandidates(listsById = {}) {
    const entries = [];
    for (const [id, list] of Object.entries(listsById)) {
        for (const c of list ?? []) {
            const key = leadKey(c.company, c.role);
            const board = boardId(c.url);
            let e = entries.find((x) => x.key === key || (board && x.boards.has(board)));
            if (!e) entries.push(e = { key, boards: new Set() });
            if (board) e.boards.add(board);
            e[id] ??= c;
        }
    }
    return entries.map(({ boards, ...e }) => e);
}

// One lead per posting. Every searcher's and reviewer's opinion is kept; reviews never change the verdict.
// When searchers disagree, a lead verdict beats a pass (the first searcher with a lead verdict, in route order).
export function mergeCandidates({ outputs, route, reviews = {} }) {
    const reviewFor = (reviewer, key) => reviews[reviewer]?.items?.find((i) => i.key === key) ?? null;
    const lists = Object.fromEntries(route.searchers.map((id) => [id, outputs[id]?.candidates]));

    return pairCandidates(lists).map((pair) => {
        const { key } = pair;
        const finders = route.searchers.filter((id) => pair[id]);
        const lead = finders.find((id) => verdictClass(pair[id].verdict) !== 'not-a-lead');
        const first = pair[lead ?? finders[0]];
        const ops = Object.fromEntries(finders.map((id) => [id, opinion(pair[id])]));
        const reviewers = [];
        for (const r of reviewersOf(route)) {
            const item = !finders.includes(r) && reviewFor(r, key);
            if (item) { reviewers.push(r); ops[r] = opinion(item); }
        }
        const pick = (f) => finders.map((id) => pair[id][f]).find(Boolean) ?? '';
        const questions = [...new Set(finders.flatMap((id) => pair[id].questions ?? []))];
        // Several searchers: the highest fit any of them gave.
        const fits = finders.map((id) => pair[id].fit).filter(Number.isInteger);
        return {
            key,
            company: first.company,
            role: first.role,
            url: first.url || pick('url'),
            urls: Object.fromEntries(route.searchers.map((id) => [id, pair[id]?.url ?? ''])),
            pay: first.pay || pick('pay'),
            domain: pick('domain'),
            size: pick('size'),
            founded: pick('founded'),
            facts: pick('facts'),
            overview: first.overview || pick('overview'),
            // A role off the big boards is only a job (gets a posting) when the searcher said kind "role"; dropping it left swept roles unjudged.
            ...(pick('kind') && { kind: pick('kind') }),
            foundBy: finders.length > 1 ? 'both' : finders[0],
            finalVerdict: first.verdict,
            reviewed: finders.length > 1 || reviewers.length > 0,
            reviewers,
            opinions: ops,
            payEstimate: Object.values(ops).find((o) => o?.payEstimate)?.payEstimate ?? null,
            ...(fits.length && { fit: Math.max(...fits) }),
            questions,
        };
    });
}
