import { companyKey } from './keys.js';

export const squash = (s) => String(s ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '');
export const sameRole = (a, b) => a === b || (a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a)));

export const activeApplication = (company) => (company.applications ?? []).find((a) => a.outcome === 'applied');

export const isProtected = (company) => Boolean(activeApplication(company)) || company.stance === 'Ruled out';

export const jobEntry = (company, posting) => {
    const jobs = company.jobs ?? {};
    return jobs[posting.id] ?? Object.values(jobs).find((j) => j.leadKey === posting.leadKey);
};

export const applicationFor = (company, posting) => {
    const apps = company.applications ?? [];
    const mine = apps.filter((a) => a.postingId === posting.id);
    const same = mine.length ? mine : apps.filter((a) => a.leadKey === posting.leadKey);
    return same.find((a) => a.outcome === 'applied') ?? same[0];
};

// An application that holds this job back from Apply, Applying and Saved: one for this posting, or an open one for the same role.
// A closed application for an earlier posting with the same title does not.
export const appliedTo = (company, posting) => (company.applications ?? [])
    .find((a) => a.postingId === posting.id || (a.outcome === 'applied' && a.leadKey === posting.leadKey));

export const companyOf = (companies, posting) => companies.find((c) => c.key === posting.companyKey
    || (c.aliases ?? []).some((a) => companyKey(a) === posting.companyKey));

export const hasActiveLead = (company, postings) => postings.some((p) => {
    if (companyOf([company], p) !== company || !p.wasLead || p.posted === 'no' || applicationFor(company, p)) return false;
    const e = jobEntry(company, p);
    return !e || e.state === 'saved' || e.state === 'applying';
});

const OUTCOMES = { rejected: 'Rejected', passed: 'Passed', 'no response': 'No response' };

export const pastOutcomes = (company) => (company.applications ?? [])
    .filter((a) => OUTCOMES[a.outcome])
    .map((a) => `${OUTCOMES[a.outcome]} ${a.outcomeOn ?? ''}`.trim());

// A job Re-check scores: saved, applying or flagged, still listed, company not Ruled out, and shown on New (no application holds it back).
// Applying is in: it's the last stop before sending, when a changed score matters most.
export const inRescoreScope = (company, posting) => company.stance !== 'Ruled out' && posting.posted !== 'no' && !posting.goneAt && !appliedTo(company, posting)
    && (['saved', 'applying'].includes(jobEntry(company, posting)?.state) || Boolean(company.jobFlags?.[posting.id]));
