import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRun, findKind } from '../lib/postings.js';
import { blankCompany } from '../lib/companies.js';

const gh = (n) => `https://boards.greenhouse.io/acme/jobs/${n}`;
const lead = (o = {}) => ({ key: 'acme::staffengineer', company: 'Acme', role: 'Staff Engineer', url: gh(1), finalVerdict: 'Strong apply', claude: { verdict: 'Strong apply' }, ...o });
const go = (state, run, leads = [], nearMisses = [], extra = {}) => attachRun(state, { run, leads, nearMisses, ...extra });
const empty = { companies: [], postings: [] };

test('findKind: board id wins, then kind, then the verdict', () => {
    assert.equal(findKind({ url: gh(1), role: 'Engineer', kind: 'company' }, false), 'role');
    assert.equal(findKind({ url: 'https://x.com/careers', role: 'Engineer', kind: 'role' }, false), 'role');
    assert.equal(findKind({ url: 'https://x.com/careers', role: 'Engineer' }, true), 'role');
    assert.equal(findKind({ url: 'https://x.com/careers' }, false), 'company');
});

test('findKind: a role like "No qualifying opening" is company-only, even with a board url', () => {
    for (const role of ['No qualifying opening', 'No qualifying engineering opening', 'No current opening', 'No engineering opening visible', 'No qualifying role confirmed']) {
        assert.equal(findKind({ url: 'https://x.com/careers', role, kind: 'role' }, true), 'company', role);
        assert.equal(findKind({ url: gh(1), role }, true), 'company', role);
    }
    assert.equal(findKind({ url: gh(1), role: 'Nonprofit Platform Engineer' }, true), 'role');
    assert.equal(findKind({ url: gh(1), role: 'Notifications Engineer' }, true), 'role');
});

test('findKind: a find with no role is company-only, even when marked a lead', () => {
    for (const role of ['', '  ', undefined]) assert.equal(findKind({ url: 'https://x.com/careers', role }, true), 'company');
});

test('two leads at one company on one careers page with different roles: two postings', () => {
    const url = 'https://acme.com/careers';
    const r = go(empty, '2026-11-14-daily', [lead({ url, role: 'Staff Engineer', key: 'acme::staffengineer' }), lead({ url, role: 'Principal Engineer', key: 'acme::principalengineer' })]);
    assert.equal(r.postings.length, 2);
    assert.equal(new Set(r.postings.map((p) => p.id)).size, 2);
});

test('a near miss with no kind makes no posting, but the company exists', () => {
    const r = go(empty, 'r1', [], [lead({ company: 'X', role: 'Official careers page', url: 'https://x.com/careers' })]);
    assert.equal(r.postings.length, 0);
    assert.equal(r.companies[0].key, 'x');
});

test('a lead with kind company and a Greenhouse job URL still gets a posting', () => {
    const r = go(empty, 'r1', [lead({ kind: 'company' })]);
    assert.deepEqual(r.postings.map((p) => p.id), ['greenhouse:1']);
});

test('a company find backfills empty facts only on an unprotected company', () => {
    const prot = { ...blankCompany('Acme'), applications: [{ id: 'a', outcome: 'applied' }] };
    const free = blankCompany('Beta');
    const r = go({ companies: [prot, free], postings: [] }, 'r1', [], [lead({ size: '200', domain: 'D' }), lead({ company: 'Beta', size: '50', facts: 'f' })]);
    assert.equal(r.companies[0].size, '');
    assert.deepEqual([r.companies[1].size, r.companies[1].facts], ['50', 'f']);
});

test('same posting reported under another company keeps its companyKey and adds one note', () => {
    const base = { companies: [], postings: [] };
    const a = go(base, 'r1', [lead({ company: 'Quillfeather', key: 'quillfeather::staff', url: 'https://boards.greenhouse.io/quillfeather/jobs/7984391003' })]);
    const b = go(a, 'r2', [lead({ company: 'Quillfeather PBC', key: 'quillfeatherpbc::staff', url: 'https://boards.greenhouse.io/quillfeather/jobs/7984391003' })]);
    assert.equal(b.postings.length, 1);
    assert.equal(b.postings[0].companyKey, 'quillfeather');
    assert.deepEqual(b.notes, ['greenhouse:7984391003 reported under Quillfeather PBC, kept under Quillfeather']);
});

test('a lead that later becomes a pass: modelSays pass, wasLead stays true; verdict kept when a model is silent', () => {
    const a = go(empty, '2026-11-14-daily', [lead({ codex: { verdict: 'Strong apply' } })]);
    const b = go(a, '2026-11-15-daily', [], [lead({ claude: { verdict: 'Skip' }, codex: null })]);
    const p = b.postings[0];
    assert.equal(p.modelSays, 'pass');
    assert.equal(p.wasLead, true);
    assert.deepEqual(p.verdicts, { claude: 'Skip', codex: 'Strong apply' });
    assert.equal(p.firstRun, '2026-11-14-daily');
    assert.equal(p.lastRun, '2026-11-15-daily');
});

test('verdicts are capped at 100 characters', () => {
    const r = go(empty, 'r1', [lead({ claude: { verdict: 'x'.repeat(300) } })]);
    assert.equal(r.postings[0].verdicts.claude.length, 100);
});

test('a posting with a saved job entry keeps its role and url when a later run words it differently', () => {
    const a = go(empty, 'r1', [lead()]);
    a.companies[0].jobs = { 'greenhouse:1': { state: 'saved', role: 'Staff Engineer', leadKey: 'acme::staffengineer', at: '2026-11-14' } };
    const b = go(a, 'r2', [lead({ role: 'Staff Software Engineer, Platform', url: gh(1) + '?src=x' })]);
    assert.equal(b.postings[0].role, 'Staff Engineer');
    assert.equal(b.postings[0].url, gh(1));
    assert.equal(b.postings[0].lastRun, 'r2');
});

test('a sendback of an older run changes only firstRun', () => {
    const a = go(empty, '2026-11-15-daily', [lead({ claude: { verdict: 'Strong apply' } })]);
    const b = go(a, '2026-11-14-daily', [], [lead({ claude: { verdict: 'Skip' } })]);
    const p = b.postings[0];
    assert.equal(p.firstRun, '2026-11-14-daily');
    assert.equal(p.lastRun, '2026-11-15-daily');
    assert.equal(p.modelSays, 'lead');
    assert.equal(p.verdicts.claude, 'Strong apply');
});

test('the same run twice changes nothing, and the input is not mutated', () => {
    const input = { companies: [blankCompany('Acme')], postings: [] };
    const snap = JSON.stringify(input);
    const a = go(input, 'r1', [lead()]);
    assert.equal(JSON.stringify(input), snap);
    const b = go(a, 'r1', [lead()]);
    assert.deepEqual(b, { ...a, notes: [] });
});

test('finds past the new-company allowance make no company or posting and add one note each', () => {
    const l = (n) => lead({ company: `Co${n}`, key: `co${n}::staff`, url: gh(n) });
    const r = go(empty, 'r1', [l(1), l(2), l(3)], [l(3)], { newAllowance: 1 });
    assert.deepEqual(r.companies.map((c) => c.name), ['Co1']);
    assert.deepEqual(r.postings.map((p) => p.id), ['greenhouse:1']);
    assert.deepEqual(r.notes, ['Co2: over the 20-new-companies limit', 'Co3: over the 20-new-companies limit']);
});

test('a company already refused for the limit is not created by a find, and not noted again', () => {
    const r = go(empty, 'r1', [lead({ company: 'Refused Co' })], [], { blocked: ['Refused Co'] });
    assert.deepEqual([r.companies.length, r.postings.length, r.notes.length], [0, 0, 0]);
});

test('verdicts come from the models the run names', () => {
    const r = go(empty, 'r1', [lead({ claude: null, gemini: { verdict: 'Strong apply' } })], [], { models: ['claude', 'gemini'] });
    assert.deepEqual(r.postings[0].verdicts, { gemini: 'Strong apply' });
});

test('leadKey is frozen with role and url when the owner has a job entry, and when the find came under another company name', () => {
    const a = go(empty, 'r1', [lead()]);
    a.companies[0].jobs = { 'greenhouse:1': { state: 'saved', role: 'Staff Engineer', leadKey: 'acme::staffengineer', at: 'x' } };
    const b = go(a, 'r2', [lead({ key: 'acme::other', role: 'Other' })]);
    assert.equal(b.postings[0].leadKey, 'acme::staffengineer');
    const c = go(go(empty, 'r1', [lead({ company: 'Quillfeather', key: 'quillfeather::staff' })]), 'r2', [lead({ company: 'Quillfeather PBC', key: 'quillfeatherpbc::staff', role: 'Renamed' })]);
    assert.equal(c.postings[0].leadKey, 'quillfeather::staff');
    assert.equal(c.postings[0].role, 'Staff Engineer');
});

test('each run that records a find is added to the posting runs list, once', () => {
    const a = go(empty, 'r1', [lead({})]);
    const b = go(go(a, 'r2', [lead({})]), 'r2', [lead({})]);
    assert.deepEqual(b.postings[0].runs, ['r1', 'r2']);
});

test('a lead pay estimate is kept on the posting; a later run without one keeps it', () => {
    const est = { range: '$165–190k', confidence: 'low', basis: 'comparables' };
    const first = go(empty, 'r1', [lead({ payEstimate: est })]);
    assert.deepEqual(first.postings[0].payEstimate, est);
    assert.deepEqual(go(first, 'r2', [lead()]).postings[0].payEstimate, est);
});

test('a find at a job link the company already has joins that posting, whatever the role is called', () => {
    const url = 'https://acme.com/careers/jobs/48213';
    const first = go(empty, '2026-11-23-daily-1200', [lead({ key: 'acme::seniorsoftwareengineerfullstack', role: 'Senior Software Engineer (Full-stack)', url })]);
    const second = go(first, '2026-11-23-tracked-1300', [lead({ key: 'acme::seniorsoftwareengineer', role: 'Senior Software Engineer', url })]);
    assert.equal(second.postings.length, 1);
    assert.equal(second.postings[0].runs.length, 2);
    const index = go(first, '2026-11-23-tracked-1300', [lead({ key: 'acme::designer', role: 'Product Engineer', url: 'https://acme.com/careers' })]);
    assert.equal(index.postings.length, 2);
});
