import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPosting, checkAll, prune, safeFetch, isPublicAddress } from '../lib/postingCheck.js';
import { blankPosting } from '../lib/postingsFile.js';
import { blankCompany } from '../lib/companies.js';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows } from '../lib/store.js';
import { run } from '../bin/check-postings.js';

const res = (status, body = '') => async () => new Response(body, { status });
const pub = async () => [{ address: '93.184.216.34', family: 4 }];
const GH = 'https://boards.greenhouse.io/acme/jobs/123';
const LEVER = 'https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000001';
const ASHBY = 'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000001';
const deps = (fetchImpl) => ({ fetchImpl, lookup: pub });
const post = (o = {}) => ({ ...blankPosting({ id: 'greenhouse:123', companyKey: 'acme', leadKey: 'acme::staffengineer', role: 'Staff Engineer', url: GH, source: 'run' }), wasLead: true, modelSays: 'lead', ...o });
const acme = (o = {}) => ({ ...blankCompany('Acme'), key: 'acme', stance: 'Watching', ...o });
const TODAY = '2026-11-16';

test('JavaScript shell without the role title is unknown; title in the HTML is yes', async () => {
    const p = post({ url: 'https://acme.com/careers/x', id: 'key:1' });
    assert.equal(await checkPosting(p, deps(res(200, '<div id="root"></div><script src="app.js"></script>'))), 'unknown');
    assert.equal(await checkPosting(p, deps(res(200, '<h1>Staff  Engineer</h1>'))), 'yes');
});

test('plain page: 404/410 and closed text are no', async () => {
    const p = post({ url: 'https://acme.com/careers/x', id: 'key:1' });
    assert.equal(await checkPosting(p, deps(res(404))), 'no');
    assert.equal(await checkPosting(p, deps(res(410))), 'no');
    assert.equal(await checkPosting(p, deps(res(200, 'Staff Engineer. This position has been filled'))), 'no');
});

test('greenhouse API: calls the API, 200 yes, 404 no, 429 unknown', async () => {
    let seen;
    assert.equal(await checkPosting(post(), deps(async (u) => { seen = u; return new Response('{}'); })), 'yes');
    assert.equal(seen, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123');
    assert.equal(await checkPosting(post(), deps(res(404))), 'no');
    assert.equal(await checkPosting(post(), deps(res(429))), 'unknown');
});

test('lever API 200/404', async () => {
    let seen;
    const p = post({ id: 'lever:0b1c2d3e-0000-4000-8000-000000000001', url: LEVER });
    assert.equal(await checkPosting(p, deps(async (u) => { seen = u; return new Response('{}'); })), 'yes');
    assert.equal(seen, 'https://api.lever.co/v0/postings/acme/0b1c2d3e-0000-4000-8000-000000000001');
    assert.equal(await checkPosting(p, deps(res(404))), 'no');
});

test('ashby: uuid in the board list is yes, a 200 without it is no', async () => {
    const p = post({ id: 'ashby:0b1c2d3e-0000-4000-8000-000000000001', url: ASHBY });
    const body = (id) => JSON.stringify({ jobs: [{ id }] });
    assert.equal(await checkPosting(p, deps(res(200, body('0b1c2d3e-0000-4000-8000-000000000001')))), 'yes');
    assert.equal(await checkPosting(p, deps(res(200, body('other')))), 'no');
    assert.equal(await checkPosting(p, deps(res(503))), 'unknown');
});

test('5xx, network error and a refused host are unknown', async () => {
    const p = post({ url: 'https://acme.com/x', id: 'key:1' });
    assert.equal(await checkPosting(p, deps(res(503))), 'unknown');
    assert.equal(await checkPosting(p, deps(async () => { throw new Error('boom'); })), 'unknown');
    assert.equal(await checkPosting(p, { fetchImpl: res(200), lookup: async () => [{ address: '10.0.0.1' }] }), 'unknown');
});

test('a redirect to a private address is refused and never fetched', async () => {
    const urls = [];
    const f = async (u) => { urls.push(u); return new Response('', { status: 302, headers: { location: 'http://192.168.1.10/' } }); };
    assert.equal(await checkPosting(post({ url: 'https://acme.com/x', id: 'key:1' }), deps(f)), 'unknown');
    assert.deepEqual(urls, ['https://acme.com/x']);
});

test('safeFetch follows a public redirect and stops after 5 hops', async () => {
    let n = 0;
    const f = async () => (++n === 1 ? new Response('', { status: 301, headers: { location: '/next' } }) : new Response('ok'));
    assert.equal(await (await safeFetch('https://acme.com/a', deps(f))).text(), 'ok');
    const loop = async () => new Response('', { status: 302, headers: { location: '/again' } });
    assert.equal(await safeFetch('https://acme.com/a', deps(loop)), null);
});

test('a host with any non-public address is refused', async () => {
    const lookup = async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
    assert.equal(await safeFetch('https://acme.com/', { fetchImpl: res(200), lookup }), null);
});

test('isPublicAddress', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:a00:1', '[::1]', 'nonsense']) {
        assert.equal(isPublicAddress(ip), false, ip);
    }
    for (const ip of ['93.184.216.34', '172.32.0.1', '2606:2800:220:1::1', '::ffff:93.184.216.34']) assert.equal(isPublicAddress(ip), true, ip);
});

test('yes to no sets goneAt; no to yes deletes it', async () => {
    const c = [acme()];
    let out = await checkAll({ companies: c, postings: [post({ posted: 'yes' })] }, { today: TODAY, ...deps(res(404)) });
    assert.equal(out[0].posted, 'no');
    assert.equal(out[0].goneAt, TODAY);
    out = await checkAll({ companies: c, postings: [{ ...out[0], postedCheckedAt: '2026-11-01' }] }, { today: '2026-11-17', ...deps(res(200)) });
    assert.equal(out[0].posted, 'yes');
    assert.equal('goneAt' in out[0], false);
});

test('unknown leaves posted and the check date alone', async () => {
    const out = await checkAll({ companies: [acme()], postings: [post({ posted: 'yes', postedCheckedAt: 'old' })] }, { today: TODAY, ...deps(res(429)) });
    assert.equal(out[0].posted, 'yes');
    assert.equal(out[0].postedCheckedAt, 'old');
});

test('an application with a pasted link and no posting gets a stub', async () => {
    const c = acme({ applications: [{ postingId: 'greenhouse:123', role: 'Staff Engineer', url: GH, outcome: 'applied' }] });
    const out = await checkAll({ companies: [c], postings: [] }, { today: TODAY, ...deps(res(200)) });
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'application');
    assert.equal(out[0].id, 'greenhouse:123');
    assert.equal(out[0].wasLead, true);
    assert.equal(out[0].posted, 'yes');
});

test('prune keeps wasLead and anything with a job entry, deletes bare old passes', () => {
    const old = { lastRun: '2026-08-01-daily', wasLead: false };
    const c = acme({ jobs: { 'key:kept': { state: 'skipped', leadKey: 'acme::kept' } } });
    const postings = [
        post({ id: 'key:lead', leadKey: 'acme::lead', lastRun: '2026-08-01-daily' }),
        post({ id: 'key:kept', leadKey: 'acme::kept', ...old }),
        post({ id: 'key:bare', leadKey: 'acme::bare', ...old }),
        post({ id: 'key:recent', leadKey: 'acme::recent', wasLead: false, lastRun: '2026-11-10-daily' }),
    ];
    assert.deepEqual(prune({ companies: [c], postings }, TODAY).map((p) => p.id), ['key:lead', 'key:kept', 'key:recent']);
});

test('bin/check-postings leaves company versions unchanged and writes the posting', async () => {
    const db = sqliteD1();
    await applySchema(db);
    const c = acme();
    await writeRows(db, { companies: [{ id: 'acme', version: null, record: c }], postings: [{ id: 'greenhouse:123', version: null, record: post() }] });
    const before = (await loadAll(db, 'companies')).map((r) => r.version);
    await run(db, { today: TODAY, ...deps(res(404)) });
    assert.deepEqual((await loadAll(db, 'companies')).map((r) => r.version), before);
    const [p] = await loadAll(db, 'postings');
    assert.equal(p.record.posted, 'no');
    assert.equal(p.version, 2);
});

test('readPosting: board APIs for pages that need JavaScript (Workday, Rippling, Workable, Gem)', async () => {
    const { readPosting } = await import('../lib/postingCheck.js');
    const json = (status, body) => ({ status, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body });
    const pages = {
        'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/job/Remote/Staff-Engineer_R1': json(200, { jobPostingInfo: { jobDescription: '<p>Vue &amp; TS</p>' } }),
        'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/job/Remote/Old_R2': json(404, {}),
        'https://api.rippling.com/platform/api/ats/v1/board/acme/jobs/84e7de11-6932-40d7-b900-b0f03415d339': json(200, { description: { role: '<p>Build the editor</p>', company: '<p>About us</p>' } }),
        'https://apply.workable.com/api/v2/accounts/acme/jobs/0E2E2072EC': json(200, { description: '<p>Frontend</p>', requirements: '<p>5 years</p>' }),
        'https://api.gem.com/job_board/v0/acme/job_posts/': json(200, [{ id: 'g1', content_plain: 'Remote US' }]),
    };
    const deps = { fetchImpl: async (u) => pages[u] ?? json(500, {}), lookup: async () => [{ address: '8.8.8.8' }] };
    const r = (id, url, board) => readPosting({ id, role: 'Staff Engineer', url }, deps, { board });
    assert.deepEqual(await r('workday:R1', 'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Staff-Engineer_R1'), { state: 'ok', text: 'Vue & TS' });
    assert.equal((await r('workday:R2', 'https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Old_R2')).state, 'gone');
    assert.deepEqual(await r('rippling:x', 'https://ats.rippling.com/acme/jobs/84e7de11-6932-40d7-b900-b0f03415d339'), { state: 'ok', text: 'Build the editor\nAbout us' });
    assert.deepEqual(await r('workable:0E2E2072EC', 'https://apply.workable.com/j/0E2E2072EC', { kind: 'workable', slug: 'acme' }), { state: 'ok', text: 'Frontend\n5 years' });
    assert.deepEqual(await r('gem:g1', 'https://jobs.gem.com/acme/g1'), { state: 'ok', text: 'Remote US' });
    assert.equal((await r('gem:g2', 'https://jobs.gem.com/acme/g2')).state, 'gone');
});
