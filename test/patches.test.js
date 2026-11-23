import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatches, MODEL_FIELDS } from '../lib/applyPatches.js';
import { cleanPatch, readModelOutput, CAPS, capText } from '../lib/readModelOutput.js';
import { blankCompany, findCompany } from '../lib/companies.js';

const co = (name, over) => ({ ...blankCompany(name), ...over });
const start = () => [
    co('Applied Co', { stance: 'Watching', applications: [{ outcome: 'applied' }], reason: 'Applied.' }),
    co('Ruled Co', { stance: 'Ruled out', reason: 'No.' }),
    co('Ostrander', { stance: '', verdict: 'Watch company', reason: 'Pay too low.', rolesSkipped: ['Software Engineer III'] }),
    co('Review Co', { stance: 'To review' }),
    co('Watched', { stance: 'Watching', verdict: 'Watch' }),
];
const go = (over) => {
    const companies = over.companies ?? start();
    return applyPatches({ companies, base: structuredClone(companies), patches: { claude: [], codex: [] }, ...over });
};
const both = (row, over) => go({ patches: { claude: [row], codex: [row] }, ...over });
const get = (out, name) => findCompany(out.companies, name);

test('a protected company accepts nothing', () => {
    const a = both({ company: 'Applied Co', reason: 'New.' });
    assert.deepEqual(a.refused.map((r) => r.reason), ['active application', 'active application']);
    assert.equal(get(a, 'Applied Co').reason, 'Applied.');
    const r = both({ company: 'Ruled Co', reason: 'New.' });
    assert.equal(r.refused[0].reason, 'ruled out');
    assert.equal(get(r, 'Ruled Co').reason, 'No.');
});

test('one searcher alone changes a field; changes list from/to', () => {
    const out = go({ patches: { claude: [{ company: 'Ostrander', reason: 'Pay fine now.' }] } });
    assert.equal(get(out, 'Ostrander').reason, 'Pay fine now.');
    assert.deepEqual(out.changes, [{ company: 'Ostrander', by: 'claude', fields: { reason: { from: 'Pay too low.', to: 'Pay fine now.' } } }]);
});

test('per field, the first searcher in route order wins; an empty first falls through to the next', () => {
    const patches = { claude: [{ company: 'Ostrander', reason: 'A.' }], codex: [{ company: 'Ostrander', reason: 'B.', size: '50' }] };
    const out = go({ patches, order: ['codex', 'claude'] });
    assert.equal(get(out, 'Ostrander').reason, 'B.');
    const out2 = go({ patches, order: ['claude', 'codex'] });
    assert.equal(get(out2, 'Ostrander').reason, 'A.');
    assert.equal(get(out2, 'Ostrander').size, '50');
});

test('a field that moved since the run started is skipped and listed; no base writes no company field', () => {
    const companies = start();
    const base = structuredClone(companies);
    findCompany(companies, 'Ostrander').reason = 'Owner edit.';
    const out = applyPatches({ companies, base, patches: { claude: [{ company: 'Ostrander', reason: 'Model.' }] } });
    assert.equal(get(out, 'Ostrander').reason, 'Owner edit.');
    assert.match(out.refused[0].reason, /changed since the run started/);
    const none = applyPatches({ companies: start(), base: null, patches: { claude: [{ company: 'Ostrander', reason: 'Model.' }] } });
    assert.equal(get(none, 'Ostrander').reason, 'Pay too low.');
    assert.match(none.refused[0].reason, /starting point/);
});

test('stance: a model sets an empty stance and marks it; an owner stance is never changed; To review never moves', () => {
    const out = go({ patches: { codex: [{ company: 'Ostrander', stance: 'Dormant' }] } });
    assert.equal(get(out, 'Ostrander').stance, 'Dormant');
    assert.equal(get(out, 'Ostrander').stanceBy, 'codex');
    assert.deepEqual(out.changes[0].fields.stanceBy, { from: undefined, to: 'codex' });
    const owner = go({ patches: { claude: [{ company: 'Watched', stance: 'Dormant' }] } });
    assert.equal(get(owner, 'Watched').stance, 'Watching');
    assert.match(owner.refused[0].reason, /stance set by you/);
    const review = go({ patches: { claude: [{ company: 'Review Co', stance: 'Watching' }] } });
    assert.equal(get(review, 'Review Co').stance, 'To review');
});

test('stance: a stance a model set can be changed by a later run', () => {
    const companies = start();
    Object.assign(findCompany(companies, 'Watched'), { stanceBy: 'claude' });
    const out = go({ companies, patches: { codex: [{ company: 'Watched', stance: 'Dormant' }] } });
    assert.equal(get(out, 'Watched').stance, 'Dormant');
    assert.equal(get(out, 'Watched').stanceBy, 'codex');
});

test('rolesSkipped is the union of all searchers, added only', () => {
    const out = go({ patches: { claude: [{ company: 'Ostrander', rolesSkipped: 'A' }, { company: 'Ostrander', rolesSkipped: 'B' }], codex: [{ company: 'Ostrander', rolesSkipped: ['C', 'Software Engineer III'] }] } });
    assert.deepEqual(get(out, 'Ostrander').rolesSkipped, ['Software Engineer III', 'A', 'B', 'C']);
});

test('links fill an empty field only, with an http(s) link', () => {
    const companies = start();
    findCompany(companies, 'Watched').jobsUrl = 'https://old.example/jobs';
    const out = go({ companies, patches: { claude: [{ company: 'Ostrander', careersUrl: 'https://g.example/careers', website: 'ftp://x' }, { company: 'Watched', jobsUrl: 'https://new.example/jobs' }] } });
    assert.equal(get(out, 'Ostrander').careersUrl, 'https://g.example/careers');
    assert.equal(get(out, 'Ostrander').website, '');
    assert.equal(get(out, 'Watched').jobsUrl, 'https://old.example/jobs');
});

test('an unknown company becomes a record, flags a duplicate, and counts toward the new-company limit', () => {
    const rows = Array.from({ length: CAPS.newCompanies + 1 }, (_, i) => ({ company: `New ${i}`, reason: 'x' }));
    const out = go({ patches: { claude: [{ company: 'Ostrander Inc.', reason: 'dup?' }, ...rows] } });
    assert.ok(out.refused.some((r) => /new-companies limit/.test(r.reason)));
    assert.equal(out.companies.length, start().length + CAPS.newCompanies);
});

test('each searcher gets its own new-company allowance', () => {
    const rows = (p) => Array.from({ length: CAPS.newCompanies }, (_, i) => ({ company: `${p} ${i}`, reason: 'x' }));
    const out = go({ patches: { claude: rows('A'), codex: rows('B') } });
    assert.ok(!out.refused.some((r) => /new-companies limit/.test(r.reason)));
    assert.equal(out.companies.length, start().length + 2 * CAPS.newCompanies);
});

test('applyPatches does not mutate its inputs', () => {
    const companies = start();
    const before = structuredClone(companies);
    go({ companies, patches: { claude: [{ company: 'Ostrander', reason: 'X.' }] } });
    assert.deepEqual(companies, before);
});

test('6. lastChecked in a row is ignored', () => {
    const out = both({ company: 'Ostrander', lastChecked: '1999-01-01' });
    assert.equal(get(out, 'Ostrander').lastChecked, '');
    assert.equal(out.changes.length, 0);
});

test('MODEL_FIELDS holds only what a model may set', () => {
    assert.deepEqual(MODEL_FIELDS, ['stance', 'verdict', 'fingerprint', 'domain', 'awards', 'reason', 'recheckTrigger', 'website', 'careersUrl', 'jobsUrl', 'size', 'founded', 'funding', 'stability', 'culture', 'facts', 'rolesSkipped']);
});

// cleaning
test('culture passes through the patch reader and is capped', () => {
    const [c] = cleanPatch([{ company: 'X', culture: 'Glassdoor 2.9, 41 reviews. Independent.' }, ], []);
    assert.equal(c.culture, 'Glassdoor 2.9, 41 reviews. Independent.');
    const [long] = cleanPatch([{ company: 'X', culture: 'a'.repeat(5000) }], []);
    assert.ok(long.culture.length <= CAPS.culture + 1);
});

test('cleanPatch keeps only company and MODEL_FIELDS', () => {
    const rej = [];
    const [c] = cleanPatch([{ company: 'X', reason: 'r', application: { s: 1 }, events: [{}], override: true, lastChecked: 'z' }], rej);
    assert.deepEqual(c, { company: 'X', reason: 'r' });
    assert.match(rej[0].reason, /Ignored fields: application, events/);
});

test('cleanPatch translates old status words', () => {
    const rej = [];
    assert.deepEqual(cleanPatch([{ company: 'X', status: 'Active lead' }, { company: 'Y', status: 'Skip current role' }, { company: 'Z', status: 'Watching' }], rej), [{ company: 'X' }, { company: 'Y' }, { company: 'Z', stance: 'Watching' }]);
    assert.equal(rej.length, 0);
    for (const status of ['Applied', 'Rejected', 'Passed']) {
        const r = [];
        assert.deepEqual(cleanPatch([{ company: 'X', status }], r), []);
        assert.equal(r.length, 1);
    }
});

test('cleanPatch survives junk and caps text', () => {
    const rej = [];
    assert.deepEqual(cleanPatch([5, null, { company: 5 }, { company: 'x'.repeat(121) }], rej), []);
    assert.equal(rej.length, 4);
    assert.deepEqual(cleanPatch([{ company: 'X', size: { a: 1 }, status: 'Bogus', website: 'javascript:x' }]), [{ company: 'X' }]);
    assert.equal(cleanPatch([{ company: 'X', reason: 'r'.repeat(1_000_000) }])[0].reason.length, 2000);
    assert.deepEqual(cleanPatch([{ company: 'X', rolesSkipped: 'a; b' }]), [{ company: 'X', rolesSkipped: ['a', 'b'] }]);
    assert.equal(capText(5, 10), null);
});

const out = (files) => {
    const d = mkdtempSync(join(tmpdir(), 'rmo-'));
    for (const [f, v] of Object.entries(files)) writeFileSync(join(d, f), v);
    return readModelOutput(d);
};

test('readModelOutput reads the JSON patch, else the old CSV', () => {
    const json = out({ 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': '```json\n[{"company":"Cartwheel","status":"Watching","reason":"Fit"}]\n```' });
    assert.deepEqual(json.patch, [{ company: 'Cartwheel', stance: 'Watching', reason: 'Fit' }]);
    const csv = out({ 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.csv': 'company,status,reason,roles_skipped,override\nCartwheel,Dormant,"Fit, ok",A; B,yes\n' });
    assert.deepEqual(csv.patch, [{ company: 'Cartwheel', stance: 'Dormant', reason: 'Fit, ok', rolesSkipped: ['A', 'B'] }]);
});

test('candidates: kind kept only for role or company; non-text role is dropped and listed', () => {
    const r = out({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([
        { company: 'A', role: 'Eng', kind: 'role' }, { company: 'B', role: 'Eng', kind: 'evil' }, { company: 'C', role: 7 },
    ]) });
    assert.deepEqual(r.candidates.map((c) => [c.company, c.kind]), [['A', 'role'], ['B', undefined]]);
    assert.deepEqual(r.rejected.map((x) => x.company), ['C']);
});

test('500 candidates: 40 kept, 460 rejected', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ company: `Co ${i}`, role: 'Eng' }));
    const r = out({ 'status.txt': 'ok', 'candidates.json': JSON.stringify(many) });
    assert.equal(r.candidates.length, CAPS.candidates);
    assert.equal(r.rejected.length, 460);
    assert.equal(r.rejected[0].reason, 'over the 40-candidate limit');
});

test('candidate text is capped and lists are limited', () => {
    const r = out({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'A', note: 'n'.repeat(9999), url: 'javascript:x', questions: Array(30).fill('q'.repeat(999)), assessment: { for: Array(20).fill('f'.repeat(999)) } }]) });
    const [c] = r.candidates;
    assert.equal(c.note.length, 1500);
    assert.equal(c.url, '');
    assert.equal(c.questions.length, 10);
    assert.equal(c.questions[0].length, 300);
    assert.equal(c.assessment.for.length, 8);
    assert.equal(c.assessment.for[0].length, 500);
    assert.ok(c.assessment.for[0].endsWith('…'));
});

test('a url over 500 chars is dropped and listed, not truncated', () => {
    const r = out({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'A', url: `https://x.co/${'a'.repeat(600)}` }]) });
    assert.equal(r.candidates[0].url, '');
    assert.match(r.rejected[0].reason, /url dropped/);
});

test('dropped values are listed: non-text field, no company, non-text rolesSkipped and stance', () => {
    const r = out({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'A', facts: 5 }, { company: 7 }]), 'ledger-patch.json': JSON.stringify([{ company: 'B', stance: 3, rolesSkipped: ['ok', 4] }]) });
    const reasons = r.rejected.map((x) => x.reason).join('|');
    assert.match(reasons, /facts dropped: not text/);
    assert.match(reasons, /no usable company/);
    assert.match(reasons, /stance dropped/);
    assert.match(reasons, /rolesSkipped items dropped/);
});

test('invalid ledger-patch.json falls back to the CSV, else is listed', () => {
    const csv = out({ 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': 'oops', 'ledger-patch.csv': 'company,reason\nCartwheel,Fit\n' });
    assert.deepEqual(csv.patch, [{ company: 'Cartwheel', reason: 'Fit' }]);
    const none = out({ 'status.txt': 'ok', 'candidates.json': '[]', 'ledger-patch.json': 'oops' });
    assert.deepEqual(none.patch, []);
    assert.deepEqual(none.rejected.map((x) => x.reason), ['ledger-patch.json is not valid JSON']);
});

test('a pay estimate basis up to 600 characters is kept; longer is cut and ends in an ellipsis', async () => {
    const { cleanPayEstimate } = await import('../lib/assessment.js');
    const keep = 'b'.repeat(600);
    assert.equal(cleanPayEstimate({ range: '$150–190k', basis: keep }).basis, keep);
    const cut = cleanPayEstimate({ range: '$150–190k', basis: 'b'.repeat(601) }).basis;
    assert.equal(cut.length, 600);
    assert.ok(cut.endsWith('…'));
});

// link fields
test('link fields: valid links are kept, bad ones are dropped and reported', () => {
    const rej = [];
    const [c] = cleanPatch([{ company: 'X', careersUrl: 'https://x.example/careers', jobsUrl: 'javascript:x' }], rej);
    assert.deepEqual(c, { company: 'X', careersUrl: 'https://x.example/careers' });
    assert.deepEqual(rej.map((r) => r.reason), ['Jobs link dropped: not an http(s) link']);
    const rej2 = [];
    assert.deepEqual(cleanPatch([{ company: 'X', careersUrl: 'https://x.example/' + 'a'.repeat(490) }], rej2), [{ company: 'X' }]);
    assert.deepEqual(rej2.map((r) => r.reason), ['Careers link dropped: over the 500-character limit']);
});


test('Ruled out from a model is a suggestion: the stance stays, ruleOutSuggested carries who and why', () => {
    const out = go({ patches: { codex: [{ company: 'Ostrander', stance: 'Ruled out', reason: 'Defense contractor.' }] } });
    const g = get(out, 'Ostrander');
    assert.equal(g.stance, '');
    assert.deepEqual(g.ruleOutSuggested, { by: 'codex', reason: 'Defense contractor.' });
    assert.deepEqual(out.changes[0].fields.ruleOutSuggested, { from: undefined, to: { by: 'codex', reason: 'Defense contractor.' } });
    // An owner stance gets no suggestion either.
    assert.equal(get(go({ patches: { claude: [{ company: 'Watched', stance: 'Ruled out' }] } }), 'Watched').ruleOutSuggested, undefined);
});

test('a company a run creates is marked newFromRun; an existing one is not', () => {
    const out = go({ patches: { claude: [{ company: 'Brand New Co', stance: 'Watching', reason: 'x' }, { company: 'Ostrander', reason: 'y' }] } });
    assert.equal(get(out, 'Brand New Co').newFromRun, true);
    assert.equal(get(out, 'Ostrander').newFromRun, undefined);
});
