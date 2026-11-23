// Pure: the New queue and the Jobs list are derived from companies and postings, never stored.
// Browser-safe (no node: imports). Nothing here reads a run list or a date.
import { activeApplication, applicationFor, appliedTo, companyOf, inRescoreScope, jobEntry } from './tags.js';

const ORDER = ['flagged', 'applying', 'lead', 'unjudged', 'duplicate', 'gone', 'proposal'];

export const nowPass = (posting) => Boolean(posting.wasLead) && posting.modelSays === 'pass';

// A lead is in New only while the company is open to it and no job or application already covers the role.
const isNewLead = (company, posting) => posting.wasLead
    && !jobEntry(company, posting)
    && !applicationFor(company, posting)
    && posting.posted !== 'no'
    && company.stance !== 'Ruled out'
    && !activeApplication(company);

// A role a script found on a company's board that no model has judged yet.
const isUnjudged = (company, posting) => posting.modelSays === ''
    && !company.sweepOff
    && !jobEntry(company, posting)
    && !applicationFor(company, posting)
    && posting.posted !== 'no'
    && company.stance !== 'Ruled out'
    && !activeApplication(company);

const goneItems = (company, posting) => {
    const entry = jobEntry(company, posting);
    const app = applicationFor(company, posting);
    const records = [['saved', 'applying'].includes(entry?.state) ? entry : null, app?.outcome === 'applied' ? app : null].filter(Boolean);
    return records.some((r) => r.seenGone !== posting.goneAt);
};

const host = (url) => {
    try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// Two known websites on different hosts mean two companies (every pair the owner kept separate had them).
const looksDuplicate = (companies, company) => {
    const other = companies.find((c) => c.key === company.possibleDuplicateOf);
    const a = host(company.website ?? ''), b = host(other?.website ?? '');
    return !a || !b || a === b;
};

export function newQueue(companies, postings) {
    const items = [];
    for (const company of companies) {
        if (company.stance !== 'Ruled out') { // Rule out clears flags; never show stale ones
            if (company.flag) items.push({ kind: 'flagged', about: 'company', company: company.name, at: company.flag.at });
            for (const [postingId, f] of Object.entries(company.jobFlags ?? {})) items.push({ kind: 'flagged', about: 'job', company: company.name, postingId, at: f.at });
        }
        for (const [postingId, e] of Object.entries(company.stance === 'Ruled out' ? {} : company.jobs ?? {})) {
            if (e.state === 'applying' && !appliedTo(company, { id: postingId, leadKey: e.leadKey })) items.push({ kind: 'applying', about: 'job', company: company.name, postingId, at: e.at });
        }
        for (const proposal of company.proposals ?? []) items.push({ kind: 'proposal', about: 'company', company: company.name, proposalId: proposal.id });
        if (company.possibleDuplicateOf && looksDuplicate(companies, company)) items.push({ kind: 'duplicate', about: 'company', company: company.name });
    }
    for (const posting of postings) {
        const company = companyOf(companies, posting);
        if (!company) continue;
        const flagged = Boolean(company.jobFlags?.[posting.id]); // listed above, not again as lead or unjudged
        if (!flagged && isNewLead(company, posting)) items.push({ kind: 'lead', about: 'job', company: company.name, postingId: posting.id });
        if (!flagged && isUnjudged(company, posting)) items.push({ kind: 'unjudged', about: 'job', company: company.name, postingId: posting.id });
        if (posting.goneAt && goneItems(company, posting)) items.push({ kind: 'gone', about: 'job', company: company.name, postingId: posting.id });
    }
    return items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || ((a.kind === 'flagged' || a.kind === 'applying') && b.at.localeCompare(a.at)) || a.company.localeCompare(b.company));
}

export function jobsList(companies, postings) {
    return postings.flatMap((posting) => {
        const company = companyOf(companies, posting);
        if (!company || company.stance === 'Ruled out' || posting.posted === 'no') return [];
        const entry = jobEntry(company, posting);
        if (entry?.state === 'skipped') return [];
        if (!posting.wasLead && !['saved', 'applying'].includes(entry?.state)) return [];
        return [{ posting, company, entry }];
    });
}

// Saved jobs grouped by company, best fit first. A job with its own application lives on Applications instead.
export function savedGroups(companies, postings) {
    const groups = [];
    for (const company of companies) {
        if (company.stance === 'Ruled out' || !Object.values(company.jobs ?? {}).some((e) => e.state === 'saved')) continue;
        const mine = postings.filter((p) => companyOf([company], p) === company);
        const roles = [];
        for (const [postingId, entry] of Object.entries(company.jobs ?? {})) {
            if (entry.state !== 'saved') continue;
            const posting = mine.find((p) => p.id === postingId) ?? mine.find((p) => entry.leadKey && p.leadKey === entry.leadKey);
            if (appliedTo(company, posting ?? { id: postingId, leadKey: entry.leadKey })) continue;
            // A later search can set fit again; the arrow shows only while the re-check's score stands.
            const { fitFrom, fitTo } = posting?.rescore && posting.fit === posting.rescore.fitTo ? posting.rescore : {};
            roles.push({
                postingId, role: entry.role, fit: posting?.fit ?? null,
                move: fitTo > fitFrom ? 'up' : fitTo < fitFrom ? 'down' : null,
                gone: Boolean(posting && (posting.posted === 'no' || posting.goneAt)),
                flagged: Boolean(company.jobFlags?.[postingId]),
                hasPosting: Boolean(posting), postingRowId: posting?.id ?? null,
            });
        }
        if (!roles.length) continue;
        roles.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || a.role.localeCompare(b.role));
        groups.push({ company: company.name, key: company.key, best: roles[0].fit, roles });
    }
    return groups.sort((a, b) => (b.best ?? -1) - (a.best ?? -1) || a.company.localeCompare(b.company));
}

// How many jobs a Re-check scores: lib/rescore.js pickJobs' rule (saved or flagged, with a posting row), counted without the model context.
export function rescoreCount(companies, postings) {
    return postings.filter((p) => {
        const c = companyOf(companies, p);
        return c && inRescoreScope(c, p);
    }).length;
}

// Skipped jobs that were saved when the owner skipped them, newest first, so Passed can offer them back.
export function droppedFromSaved(companies) {
    return companies
        .filter((c) => c.stance !== 'Ruled out')
        .flatMap((c) => Object.entries(c.jobs ?? {})
            .filter(([, e]) => e.state === 'skipped' && e.fromSaved)
            .map(([postingId, e]) => ({
                company: c.name, key: c.key, postingId, role: e.role, ...(e.url && { url: e.url }),
                leadKey: e.leadKey, at: e.at, fromSaved: e.fromSaved, reasons: e.reasons ?? [],
            })))
        .sort((a, b) => b.fromSaved.localeCompare(a.fromSaved) || a.company.localeCompare(b.company));
}
