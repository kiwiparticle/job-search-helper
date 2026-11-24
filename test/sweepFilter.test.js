import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rejectReason, loadFilter, DEFAULT_DROP, dropWords } from '../lib/sweepFilter.js';
import { sweepPostings } from '../lib/sweepPostings.js';
import { blankCompany } from '../lib/companies.js';

const f = (over = {}) => ({ version: 2, titleMust: [], titleMustNot: [], levels: [], locations: [], ...over });

test('rejectReason: whole words, any case; empty lists and a missing location pass', () => {
    assert.equal(rejectReason(null, { title: 'Anything' }), null);
    assert.equal(rejectReason(f(), { title: 'Anything' }), null);
    assert.match(rejectReason(f({ titleMustNot: ['iOS'] }), { title: 'Senior iOS Engineer' }), /excluded/);
    assert.equal(rejectReason(f({ titleMustNot: ['ios'] }), { title: 'Senior Bios Engineer' }), null);
    assert.match(rejectReason(f({ levels: ['senior', 'staff'] }), { title: 'Software Engineer II' }), /levels/);
    assert.equal(rejectReason(f({ levels: ['senior', 'staff'] }), { title: 'Staff Engineer' }), null);
    assert.match(rejectReason(f({ locations: ['remote', 'united states'] }), { title: 'X', location: 'London, UK' }), /location/);
    assert.equal(rejectReason(f({ locations: ['remote'] }), { title: 'X', location: 'Remote - US' }), null);
    assert.equal(rejectReason(f({ locations: ['remote'] }), { title: 'X' }), null);
});

const acme = { ...blankCompany('Acme'), stance: 'Watching' };
const result = (roles, seen = roles.map((r) => r.id)) => [{ company: 'Acme', status: 'ok', roles, seen }];

test('a new role the filter rejects is saved as a filtered pass; one it keeps is unjudged', () => {
    const out = sweepPostings({ companies: [acme], postings: [], run: '2026-11-20-sweep-0400', filter: f({ titleMustNot: ['ios'] }), results: result([
        { id: 'greenhouse:1', title: 'Senior iOS Engineer', url: 'https://x/1', location: 'Remote' },
        { id: 'greenhouse:2', title: 'Senior Backend Engineer', url: 'https://x/2' },
    ]) });
    const [ios, backend] = out;
    assert.deepEqual([ios.modelSays, ios.filteredBy, ios.location], ['pass', 2, 'Remote']);
    assert.match(ios.filterReason, /excluded/);
    assert.deepEqual([backend.modelSays, backend.filteredBy], ['', undefined]);
});

test('a new filter version re-checks still-listed filtered roles: passing ones go back to unjudged', () => {
    const old = { id: 'greenhouse:1', companyKey: 'acme', role: 'Senior iOS Engineer', modelSays: 'pass', filteredBy: 1, filterReason: 'x', lastRun: '2026-11-20-sweep-0400' };
    const still = { ...old, id: 'greenhouse:3', role: 'Senior Android Engineer' };
    const out = sweepPostings({ companies: [acme], postings: [old, still], run: '2026-11-20-sweep-1600', filter: f({ titleMustNot: ['android'] }), results: result([], ['greenhouse:1', 'greenhouse:3']) });
    const byId = Object.fromEntries(out.map((p) => [p.id, p]));
    assert.deepEqual([byId['greenhouse:1'].modelSays, byId['greenhouse:1'].filteredBy], ['', undefined]);
    assert.deepEqual([byId['greenhouse:3'].modelSays, byId['greenhouse:3'].filteredBy], ['pass', 2]);
    // Same version: nothing to redo (and touched once a day already).
    assert.deepEqual(sweepPostings({ companies: [acme], postings: [{ ...old, filteredBy: 2 }], run: '2026-11-20-sweep-1600', filter: f(), results: result([], ['greenhouse:1']) }), []);
});

test('a non-software word rejects only a title with no software word', () => {
    const nf = f({ titleNonSoftware: ['Mechanical', 'Hardware', 'Structural'], softwareWords: ['Software', 'SWE'] });
    assert.match(rejectReason(nf, { title: 'Senior Mechanical Engineer' }), /non-software/);
    assert.match(rejectReason(nf, { title: 'Hardware Testing Engineer' }), /non-software/);
    assert.equal(rejectReason(nf, { title: 'SWE - Mechanical Modeling' }), null);
    assert.equal(rejectReason(nf, { title: 'Senior Software Engineer, Structural' }), null);
    assert.equal(rejectReason(nf, { title: 'Staff Engineer' }), null);
});

test('a space or hyphen in a filter word matches a space, hyphen or nothing', () => {
    const nf = f({ titleMustNot: ['Full Stack'] });
    for (const t of ['Full Stack Engineer', 'Full-Stack Engineer', 'FullStack Engineer', 'full_stack engineer']) assert.match(rejectReason(nf, { title: t }), /excluded/, t);
    assert.equal(rejectReason(nf, { title: 'Fullstacks Engineer' }), null);
});

test('a still-listed swept role takes the board link', () => {
    const old = { id: 'greenhouse:9', companyKey: 'acme', role: 'Senior Engineer', modelSays: '', source: 'sweep', url: 'https://acme.com/careers?gh_jid=9', lastRun: '2026-11-20-sweep-0400' };
    const [p] = sweepPostings({ companies: [acme], postings: [old], run: '2026-11-21-sweep-0400', results: [{ company: acme.name, status: 'ok', roles: [], seen: ['greenhouse:9'], urls: { 'greenhouse:9': 'https://job-boards.greenhouse.io/acme/jobs/9' } }] });
    assert.equal(p.url, 'https://job-boards.greenhouse.io/acme/jobs/9');
});

test('a swept role already recorded at the same job link is not added again', () => {
    const had = { id: 'key:abc', companyKey: 'acme', leadKey: 'acme::seniorsoftwareengineerfullstack', role: 'Senior Software Engineer (Full-stack)', modelSays: 'lead', url: 'https://ats.rippling.com/acme/jobs/ae602b2a-aea8-4770-a7a2-048df791f7c4' };
    const out = sweepPostings({ companies: [acme], postings: [had], run: '2026-11-23-sweep-1600', results: result([{ id: 'rippling:ae602b2a-aea8-4770-a7a2-048df791f7c4', title: 'Senior Software Engineer', url: had.url }], []) });
    assert.deepEqual(out, []);
});

test('loadFilter: titleDrop defaults when absent, [] when empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-'));
    mkdirSync(join(dir, 'data'));
    const write = (o) => writeFileSync(join(dir, 'data/sweep-filter.json'), JSON.stringify({ version: 1, ...o }));
    write({});
    assert.deepEqual(loadFilter(dir).titleDrop, DEFAULT_DROP);
    assert.deepEqual(dropWords(dir), DEFAULT_DROP);
    write({ titleDrop: [] });
    assert.deepEqual(loadFilter(dir).titleDrop, []);
    assert.deepEqual(dropWords(dir), []);
    assert.deepEqual(dropWords(join(dir, 'nope')), DEFAULT_DROP);
});

import { roleTest } from '../lib/sweepFilter.js';
test('roleTest: engineering by default, a QA/SDET list when the filter sets one', () => {
    const eng = roleTest(null);
    assert.equal(eng('Senior Software Engineer'), true);
    assert.equal(eng('SDET II'), false);
    assert.equal(eng('QA Analyst'), false);
    const qa = roleTest({ roleWords: ['QA', 'QE', 'SDET', 'quality', 'test', 'tester', 'testing', 'automation', 'engineer in test'], roleNotWords: ['manager', 'director', 'head', 'vp', 'recruiter', 'sales', 'support', 'designer'] });
    for (const t of ['SDET II', 'QA Analyst', 'Senior QA Engineer', 'Software Development Engineer in Test', 'Test Automation Specialist', 'Quality Engineer']) assert.equal(qa(t), true, t);
    for (const t of ['QA Manager', 'Senior Software Engineer', 'Product Designer']) assert.equal(qa(t), false, t);
});
