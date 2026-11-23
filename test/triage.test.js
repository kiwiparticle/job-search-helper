import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickRoles, cleanTriage, applyTriage, finishTriage, prepareTriage } from '../lib/triage.js';
import { readPosting } from '../lib/postingCheck.js';
import { selectRoles } from '../lib/monitoring.js';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { writeRows, loadSome, loadAll } from '../lib/store.js';

const co = (key, over = {}) => ({ key, name: key, stance: 'Watching', jobs: {}, applications: [], ...over });
const post = (id, over = {}) => ({ id, companyKey: 'a', leadKey: id, role: 'Senior Engineer', url: 'https://x.com/' + id, modelSays: '', source: 'sweep', firstRun: '2026-11-20', lastRun: '2026-11-20', posted: 'unknown', ...over });

test('pickRoles: unjudged swept roles, or the filtered ones', () => {
    const ps = [post('u'), post('judged', { modelSays: 'lead' }), post('done', { triage: { keep: true } }), post('owner', { source: 'owner' }), post('gone', { posted: 'no' }),
        post('f', { modelSays: 'pass', filteredBy: 5 }), post('out', { companyKey: 'b' })];
    const cs = [co('a'), co('b', { stance: 'Ruled out' })];
    assert.deepEqual(pickRoles(cs, ps).map((p) => p.id), ['u']);
    assert.deepEqual(pickRoles(cs, ps, { filtered: true }).map((p) => p.id), ['f']);
});

test('readPosting: api text, dead pages, pages that do not name the role', async () => {
    const lookup = async () => [{ address: '8.8.8.8' }];
    const res = (status, body) => ({ status, headers: new Headers(), text: async () => body, json: async () => JSON.parse(body) });
    const pages = {
        'https://boards-api.greenhouse.io/v1/boards/acme/jobs/1': res(200, JSON.stringify({ content: '&lt;p&gt;Vue and TypeScript, $180,000 base&lt;/p&gt;' })),
        'https://boards-api.greenhouse.io/v1/boards/acme/jobs/2': res(404, ''),
        'https://acme.com/jobs/senior': res(200, '<html><h1>Senior Engineer</h1><p>Build our editor.</p></html>'),
        'https://acme.com/jobs/list': res(200, '<html><h1>Careers</h1></html>'),
        'https://acme.com/jobs/closed': res(200, '<p>This job is no longer accepting applications</p>'),
        'https://api.ashbyhq.com/posting-api/job-board/acme': res(200, JSON.stringify({ jobs: [{ id: '11111111-1111-1111-1111-111111111111', descriptionPlain: 'Frontend work' }] })),
    };
    const deps = { fetchImpl: async (u) => pages[u] ?? res(500, ''), lookup };
    const r = (url) => readPosting(post('x', { url }), deps);
    assert.deepEqual(await r('https://job-boards.greenhouse.io/acme/jobs/1'), { state: 'ok', text: 'Vue and TypeScript, $180,000 base' });
    assert.equal((await r('https://job-boards.greenhouse.io/acme/jobs/2')).state, 'gone');
    assert.deepEqual(await r('https://acme.com/jobs/senior'), { state: 'ok', text: 'Senior Engineer Build our editor.' });
    assert.equal((await r('https://acme.com/jobs/list')).state, 'unread');
    assert.equal((await r('https://acme.com/jobs/closed')).state, 'gone');
    assert.deepEqual(await r('https://jobs.ashbyhq.com/acme/11111111-1111-1111-1111-111111111111'), { state: 'ok', text: 'Frontend work' });
    assert.equal((await r('https://jobs.ashbyhq.com/acme/22222222-1111-1111-1111-111111111111')).state, 'gone');
});

test('cleanTriage keeps one checked verdict per known id', () => {
    const out = cleanTriage([{ id: 'a', keep: true, fit: 4, reason: ' Vue ' }, { id: 'a', keep: false }, { id: 'b', keep: 'yes' }, { id: 'zz', keep: true }, { id: 'c', keep: false, fit: 9 }], ['a', 'b', 'c']);
    assert.deepEqual([...out], [['a', { keep: true, fit: 4, reason: 'Vue' }], ['c', { keep: false, reason: '' }]]);
});

test('applyTriage: drop passes, keep rescues a filtered role, judged roles untouched', () => {
    const t = (keep) => ({ keep, fit: 2, reason: 'r' });
    assert.equal(applyTriage(post('u'), t(false), 'claude', 'T').modelSays, 'pass');
    assert.deepEqual(applyTriage(post('u'), t(true), 'claude', 'T').triage, { by: 'claude', at: 'T', keep: true, fit: 2, reason: 'r' });
    const rescued = applyTriage(post('f', { modelSays: 'pass', filteredBy: 5, filterReason: 'x' }), t(true), 'claude', 'T');
    assert.deepEqual([rescued.modelSays, rescued.filteredBy, rescued.filterReason], ['', undefined, undefined]);
    const still = applyTriage(post('f', { modelSays: 'pass', filteredBy: 5 }), t(false), 'claude', 'T');
    assert.deepEqual([still.modelSays, still.filteredBy], ['pass', 5]);
    assert.equal(applyTriage(post('j', { modelSays: 'lead' }), t(false), 'claude', 'T'), null);
    assert.equal(applyTriage(post('d', { triage: {} }), t(false), 'claude', 'T'), null);
});

test('prepare marks dead postings gone; finish applies verdicts once', async () => {
    const db = sqliteD1();
    await applySchema(db);
    await writeRows(db, { companies: [{ id: 'a', version: null, record: co('a', { domain: 'CAD tools' }) }], postings: [post('u1', { url: 'https://acme.com/u1' }), post('u2', { url: 'https://acme.com/u2' })].map((record) => ({ id: record.id, version: null, record })) });
    const dir = mkdtempSync(join(tmpdir(), 'triage-'));
    const res = (status, body) => ({ status, headers: new Headers(), text: async () => body });
    const deps = { fetchImpl: async (u) => (u.endsWith('u2') ? res(410, '') : res(200, '<h1>Senior Engineer</h1>')), lookup: async () => [{ address: '8.8.8.8' }] };
    const repo = new URL('..', import.meta.url).pathname;
    const out = await prepareTriage(db, dir, repo, { now: '2026-11-23T05:00:00Z', deps });
    assert.equal(out.count, 1);
    assert.equal(out.gone, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'context.json'), 'utf8')).roles.map((r) => [r.id, r.about]), [['u1', 'CAD tools']]);
    assert.equal((await loadSome(db, 'postings', ['u2'])).get('u2').record.posted, 'no');
    writeFileSync(join(dir, 'status.txt'), 'ok\n');
    writeFileSync(join(dir, 'triage.json'), JSON.stringify([{ id: 'u1', keep: false, fit: 1, reason: 'mechanical' }, { id: 'u2', keep: true }]));
    assert.deepEqual(await finishTriage(db, dir, dir, { at: 'T1', model: 'claude' }), { kept: 0, dropped: 1, missing: 0 });
    assert.deepEqual(await finishTriage(db, dir, dir, { at: 'T1', model: 'claude' }), { kept: 0, dropped: 0, missing: 0 });
    const u1 = (await loadAll(db, 'postings')).find((r) => r.id === 'u1').record;
    assert.deepEqual([u1.modelSays, u1.triage.reason], ['pass', 'mechanical']);
});

test('selectRoles takes triage-kept roles first, highest fit first', () => {
    const cs = [co('a'), co('b')];
    const ps = [post('a1'), post('a2', { triage: { keep: true, fit: 3 } }), post('b1', { companyKey: 'b', triage: { keep: true, fit: 5 } }), post('b2', { companyKey: 'b' })];
    const entries = [{ company: 'a', roles: [{ id: 'a1' }, { id: 'a2' }] }, { company: 'b', roles: [{ id: 'b1' }, { id: 'b2' }] }];
    assert.deepEqual(selectRoles(entries, cs, ps, 2).flatMap((e) => e.roles.map((r) => r.id)).sort(), ['a2', 'b1']);
});
