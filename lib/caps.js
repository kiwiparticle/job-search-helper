import { FACT_FIELDS } from './companies.js';

// Model output is untrusted: every model string is coerced to text and capped before it is stored.
export const CAPS = {
    company: 120, role: 200, url: 500, pay: 200, verdict: 300, shortVerdict: 100, fingerprint: 400,
    domain: 300, awards: 500, recheckTrigger: 500, size: 300, founded: 100, funding: 300, stability: 600, culture: 600, facts: 1000, notes: 1500,
    reason: 2000, website: 500, careersUrl: 500, jobsUrl: 500, rolesSkipped: 200,
    questions: 10, question: 300, check: 300, listItems: 8, listItem: 500, basis: 600,
    candidates: 40, newCompanies: 20, coverage: 15, pending: 200,
};

export const MODEL_FIELDS = ['stance', ...FACT_FIELDS, 'rolesSkipped'];

// null when the value is not a string, so callers can tell "wrong type" from "empty".
export const capText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : null);
