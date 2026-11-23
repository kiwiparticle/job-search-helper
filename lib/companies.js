import { companyKey, sameCompany } from './keys.js';

export const STANCES = ['Watching', 'Dormant', 'To review', 'Ruled out'];
export const FACT_FIELDS = ['verdict', 'fingerprint', 'domain', 'awards', 'reason', 'recheckTrigger', 'website', 'careersUrl', 'jobsUrl', 'size', 'founded', 'funding', 'stability', 'culture', 'facts'];
export const URL_FIELDS = ['website', 'careersUrl', 'jobsUrl'];

// The 0-5 score a model wrote at the start of `fingerprint` ("4/5; medium confidence"). Null for "Unscored ..." or anything else.
export function fingerprintScore(fingerprint) {
    const m = (fingerprint ?? '').match(/^\s*([0-5](?:\.\d)?)\s*(?:\/\s*5)?(?![\d.])/);
    return m ? Number(m[1]) : null;
}

// A fingerprint with no score ("Unscored — thin evidence", "Thin - ...") counts as empty, so a fill tries again.
// "Pace fail" is a real verdict, not a gap.
export const fingerprintEmpty = (fingerprint) => fingerprintScore(fingerprint) === null && !/pace fail/i.test(fingerprint ?? '');

// Saving a job looks the company up when its culture or fingerprint is still missing.
export const needsCultureFill = (c) => !c.fillRequested && (!c.culture || fingerprintEmpty(c.fingerprint));

export const parseCompanies = (text) => String(text)
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line)
    .map(({ line, n }) => {
        try {
            const v = JSON.parse(line);
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
            return v;
        } catch (e) {
            throw new Error(`companies.jsonl line ${n}: ${e.message}`);
        }
    });

export const renderCompanies = (list) => [...list]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key, ...rest }) => `${JSON.stringify({ key, ...rest })}\n`)
    .join('');

const namesOf = (r) => [r.name, ...(r.aliases ?? [])];

export const findCompany = (list, name) => list.find((r) => namesOf(r).some((n) => sameCompany(name, n)));

// ponytail: prefix match only, no edit distance. Catches Quillfeather/Quillfeather PBC; misses typos.
export const possibleDuplicate = (list, name) => {
    if (findCompany(list, name)) return undefined;
    const k = companyKey(name);
    if (k.length < 4) return undefined;
    const near = (rk) => rk !== k && Math.min(rk.length, k.length) >= 4 && (rk.startsWith(k) || k.startsWith(rk));
    return list.find((r) => !(r.distinctFrom ?? []).includes(k) && [r.key, ...(r.aliases ?? []).map(companyKey)].some(near));
};

export const blankCompany = (name) => ({
    key: companyKey(name),
    name,
    aliases: [],
    distinctFrom: [],
    stance: '',
    ...Object.fromEntries(FACT_FIELDS.map((f) => [f, ''])),
    lastChecked: '',
    rolesSkipped: [],
    jobs: {},
    applications: [],
    proposals: [],
    events: [],
});
