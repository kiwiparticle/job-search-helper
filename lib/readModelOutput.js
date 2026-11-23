import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STANCES, FACT_FIELDS, URL_FIELDS } from './companies.js';
import { parseCsv } from './csv.js';
import { cleanChecks } from './checks.js';
import { cleanAssessment, cleanPayEstimate } from './assessment.js';
import { CAPS, MODEL_FIELDS, capText } from './caps.js';

export { CAPS, MODEL_FIELDS, capText };

const read = (path) => {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
};

const unfence = (text) => {
    const m = text.match(/```[a-z]*\s*\n([\s\S]*?)```/i);
    return (m ? m[1] : text).trim();
};

const parseJson = (text) => {
    if (text == null) return null;
    const body = unfence(text);
    try { return JSON.parse(body); } catch { /* fall through */ }
    const start = body.search(/[[{]/);
    if (start < 0) return null;
    try { return JSON.parse(body.slice(start)); } catch { return null; }
};

const isCandidate = (c) => c && typeof c === 'object' && typeof c.company === 'string' && c.company.trim() !== '';
const httpUrl = (v) => (/^https?:\/\//i.test(v ?? '') ? v : '');
const LINK_LABELS = { website: 'Website', careersUrl: 'Careers link', jobsUrl: 'Jobs link' };

// Candidate text fields and their caps. A value of the wrong type is dropped (a role is the exception: see below).
const CANDIDATE_TEXT = { verdict: CAPS.verdict, pay: CAPS.pay, domain: CAPS.domain, size: CAPS.size, founded: CAPS.founded, facts: CAPS.facts, summary: CAPS.notes, overview: CAPS.notes, note: CAPS.notes };

// Returns the cleaned candidate, or { reject } with the reason it was dropped.
function cleanCandidate(c, rejected) {
    const company = capText(c.company, CAPS.company + 1);
    if (company.length > CAPS.company) return { reject: 'Company name too long' };
    if (c.role != null && typeof c.role !== 'string') return { reject: 'Role is not text' };
    const out = {
        company,
        role: capText(c.role, CAPS.role) ?? '',
        url: httpUrl(capText(c.url, CAPS.url + 1)),
        questions: Array.isArray(c.questions) ? c.questions.map((q) => capText(q, CAPS.question)).filter(Boolean).slice(0, CAPS.questions) : [],
        checks: cleanChecks(c.checks),
        assessment: cleanAssessment(c.assessment),
        payEstimate: cleanPayEstimate(c.payEstimate),
    };
    // Fit score 1-5 (prompts/search.md): a whole number in range, else left out.
    const fit = Number(c.fit);
    if (Number.isInteger(fit) && fit >= 1 && fit <= 5) out.fit = fit;
    if (out.url.length > CAPS.url) {
        out.url = '';
        rejected.push({ company, reason: 'url dropped: over the 500-character limit' });
    }
    for (const [f, max] of Object.entries(CANDIDATE_TEXT)) {
        const v = capText(c[f], max);
        if (v != null) out[f] = v;
        else if (c[f] != null) rejected.push({ company, reason: `${f} dropped: not text` });
    }
    if (c.kind === 'role' || c.kind === 'company') out.kind = c.kind;
    return out;
}

const OLD_KEYS = { roles_skipped: 'rolesSkipped', recheck_trigger: 'recheckTrigger', last_checked: 'lastChecked' };
const OWNER_STATUS = ['Applied', 'Rejected', 'Passed'];
const IGNORED_QUIETLY = ['company', 'status', 'lastChecked', 'override'];

// Model patches are untrusted: keep `company` plus MODEL_FIELDS, every value coerced and capped.
// `raw` is an array of rows (or one row); old CSV rows use `status` for what is now `stance`.
// `rejected` (optional) collects { company, reason } for rows dropped and fields stripped.
export function cleanPatch(raw, rejected = []) {
    const rows = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const out = [];
    for (const r of rows) {
        const name = typeof r?.company === 'string' ? r.company.trim() : '';
        if (!name || name.length > CAPS.company) {
            rejected.push({ company: name.slice(0, CAPS.company), reason: 'Patch row has no usable company name' });
            continue;
        }
        const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [OLD_KEYS[k] ?? k, v]));
        const rawStatus = row.stance ?? row.status;
        if (rawStatus != null && typeof rawStatus !== 'string') rejected.push({ company: name, reason: 'stance dropped: not text' });
        const status = capText(rawStatus, 40) ?? '';
        if (OWNER_STATUS.includes(status)) {
            rejected.push({ company: name, reason: 'Models cannot set an owner status' });
            continue;
        }
        const clean = { company: name };
        // "Active lead" and "Skip current role" are old words that change nothing on the company.
        const stance = status === 'Ruled out (company)' ? 'Ruled out' : status;
        if (STANCES.includes(stance)) clean.stance = stance;
        else if (stance && !['Active lead', 'Skip current role'].includes(stance)) rejected.push({ company: name, reason: `Unknown status "${stance}" dropped` });
        const ignored = Object.keys(row).filter((k) => !MODEL_FIELDS.includes(k) && !IGNORED_QUIETLY.includes(k));
        if (ignored.length) rejected.push({ company: name, reason: `Ignored fields: ${ignored.join(', ')}` });
        for (const f of FACT_FIELDS) {
            const v = capText(row[f], CAPS[f]);
            if (v) clean[f] = v;
            else if (row[f] != null && row[f] !== '' && typeof row[f] !== 'string') rejected.push({ company: name, reason: `${f} dropped: not text` });
        }
        for (const f of URL_FIELDS) {
            const label = LINK_LABELS[f];
            if (typeof row[f] === 'string' && row[f].trim().length > CAPS[f]) {
                delete clean[f];
                rejected.push({ company: name, reason: `${label} dropped: over the 500-character limit` });
            } else if (clean[f] && !httpUrl(clean[f])) {
                delete clean[f];
                rejected.push({ company: name, reason: `${label} dropped: not an http(s) link` });
            }
        }
        const rs = row.rolesSkipped;
        const items = Array.isArray(rs) ? rs : typeof rs === 'string' ? rs.split(';') : [];
        if (rs != null && (!Array.isArray(rs) && typeof rs !== 'string' || items.some((x) => typeof x !== 'string'))) rejected.push({ company: name, reason: 'rolesSkipped items dropped: not text' });
        const roles = items.map((x) => capText(x, CAPS.rolesSkipped)).filter(Boolean).slice(0, 50);
        if (roles.length) clean.rolesSkipped = roles;
        out.push(clean);
    }
    return out;
}

// Rows from ledger-patch.json (an array or one object), else the old ledger-patch.csv. Never throws.
export function readPatchFile(path) {
    const rejected = [];
    const text = read(path);
    let raw = parseJson(text);
    if (raw == null && path.endsWith('.json')) {
        const csv = read(path.replace(/\.json$/, '.csv'));
        if (csv != null) raw = parseCsv(csv);
        else if (text != null && text.trim()) rejected.push({ company: '', reason: 'ledger-patch.json is not valid JSON' });
    }
    return { patch: cleanPatch(raw, rejected), rejected };
}

export function readModelOutput(dir) {
    // Why it failed: the runner's reason.txt when it wrote one (model-adjacent text, so capped), else what this reader saw.
    const said = capText(read(join(dir, 'reason.txt')) ?? '', 300) || '';
    const empty = (status, why) => ({ status, reason: said || why, candidates: [], patch: [], rejected: [], coverage: [], pending: [] });
    const status = (read(join(dir, 'status.txt')) ?? '').trim();
    if (status === 'auth') return empty(status, 'not logged in');
    if (status === 'limit') return empty(status, 'hit its usage limit');
    if (!status) return empty('failed', 'no status: its search job never finished');
    if (status !== 'ok') return empty('failed', 'the model run failed');
    const text = read(join(dir, 'candidates.json'));
    if (text == null) return empty('failed', 'finished but wrote no candidates.json');
    const json = parseJson(text);
    const raw = Array.isArray(json) ? json : json?.candidates;
    if (!Array.isArray(raw)) return empty('failed', 'candidates.json is not a valid JSON list');
    const rejected = [];
    const candidates = [];
    for (const c of raw) {
        if (!isCandidate(c)) {
            rejected.push({ company: capText(c?.company, CAPS.company) ?? '', reason: 'Candidate has no usable company name' });
            continue;
        }
        const clean = cleanCandidate(c, rejected);
        if (clean.reject) rejected.push({ company: capText(c.company, CAPS.company), reason: clean.reject });
        else if (candidates.length >= CAPS.candidates) rejected.push({ company: clean.company, reason: `over the ${CAPS.candidates}-candidate limit` });
        else candidates.push(clean);
    }
    if (raw.length && !candidates.length && !raw.some(isCandidate)) return empty('failed', 'no candidate in candidates.json has a company name');
    const patch = readPatchFile(join(dir, 'ledger-patch.json'));
    const coverage = parseJson(read(join(dir, 'coverage.json')));
    const pendingRaw = parseJson(read(join(dir, 'pending.json')));
    const pending = Array.isArray(pendingRaw) ? pendingRaw.slice(0, CAPS.pending).filter(isCandidate).flatMap(c => {
        const clean = cleanCandidate(c, rejected);
        return !clean.reject && clean.role && clean.url ? [clean] : [];
    }) : [];
    if (Array.isArray(pendingRaw) && pendingRaw.length > CAPS.pending) rejected.push({company:'', reason:`pending roles exceed ${CAPS.pending}; research is partial`});
    return { status: 'ok', candidates, patch: patch.patch, rejected: [...rejected, ...patch.rejected], coverage: Array.isArray(coverage) ? coverage.slice(0, CAPS.coverage) : [], pending };
}

export function readReview(path) {
    const json = parseJson(read(path));
    return json && Array.isArray(json.items) ? json : null;
}
