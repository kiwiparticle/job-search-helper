import test from 'node:test';
import assert from 'node:assert/strict';
import { boardOf, isEngineering, knownBoard, sweepBoards, pickLinkTargets, LINK_SLICE, fetchRoles } from '../lib/boardSweep.js';
import { boardId } from '../lib/postingId.js';

test('boardOf', () => {
    assert.deepEqual(boardOf('https://boards.greenhouse.io/acme/jobs/1'), { kind: 'greenhouse', slug: 'acme' });
    assert.deepEqual(boardOf('https://job-boards.greenhouse.io/acme'), { kind: 'greenhouse', slug: 'acme' });
    assert.deepEqual(boardOf('https://jobs.lever.co/beta/abc'), { kind: 'lever', slug: 'beta' });
    assert.deepEqual(boardOf('https://jobs.ashbyhq.com/gamma/uuid'), { kind: 'ashby', slug: 'gamma' });
    assert.equal(boardOf('https://boards.greenhouse.io/embed/job_board'), null);
    assert.equal(boardOf('https://x.com/careers'), null);
    assert.equal(boardOf('nope'), null);
});

test('isEngineering', () => {
    for (const t of ['Senior Software Engineer', 'Staff Frontend Developer', 'Lead Engineer', 'Software Engineer', 'Frontend Architect', 'Member of Technical Staff',
        'Creative Technologist', 'Programmer II', 'Technical Lead, Web', 'Senior Full-Stack (Vue)', 'SDE III']) assert.equal(isEngineering(t), true, t);
    for (const t of ['Engineering Manager', 'Senior Accountant', 'Staff Recruiter', 'Product Marketing Lead']) assert.equal(isEngineering(t), false, t);
});

test('knownBoard', () => {
    const c = { key: 'a', jobs: {} };
    assert.deepEqual(knownBoard(c, [{ companyKey: 'a', url: 'https://x.com', lastRun: '1' }, { companyKey: 'a', url: 'https://jobs.lever.co/s1/x', lastRun: '2' }]), { kind: 'lever', slug: 's1' });
    assert.deepEqual(knownBoard({ key: 'b', jobs: { j: { url: 'https://jobs.ashbyhq.com/s2/u' } } }, []), { kind: 'ashby', slug: 's2' });
    assert.equal(knownBoard({ key: 'c' }, []), null);
});

test('knownBoard uses stored links first', () => {
    const old = [{ companyKey: 'a', url: 'https://jobs.lever.co/old/x', lastRun: '1' }];
    assert.deepEqual(knownBoard({ key: 'a', jobsUrl: 'https://boards.greenhouse.io/gh' }, []), { kind: 'greenhouse', slug: 'gh' });
    assert.deepEqual(knownBoard({ key: 'a', jobsUrl: 'https://boards.greenhouse.io/gh' }, old), { kind: 'greenhouse', slug: 'gh' });
    assert.deepEqual(knownBoard({ key: 'a', jobsUrl: 'https://acme.com/jobs', careersUrl: 'https://jobs.ashbyhq.com/cr' }, old), { kind: 'ashby', slug: 'cr' });
    assert.equal(knownBoard({ key: 'a', jobsUrl: 'https://acme.com/jobs', careersUrl: 'https://acme.com/careers' }, []), null);
});

test('sweepBoards', async () => {
    const json = (body) => ({ status: 200, headers: new Headers(), json: async () => body });
    const pages = {
        'https://boards-api.greenhouse.io/v1/boards/ok/jobs': json({ jobs: [
            { id: 1, title: 'Senior Software Engineer', absolute_url: 'https://boards.greenhouse.io/ok/jobs/1' },
            { id: 2, title: 'Staff Engineer', absolute_url: 'https://boards.greenhouse.io/ok/jobs/2' },
            { id: 3, title: 'Software Engineer', absolute_url: 'https://boards.greenhouse.io/ok/jobs/3' },
            { id: 4, title: 'Senior Engineer', absolute_url: 'https://boards.greenhouse.io/ok/jobs/4' },
        ] }),
        'https://api.lever.co/v0/postings/html?mode=json': { status: 200, headers: new Headers(), json: async () => { throw new Error('x'); } },
        'https://api.ashbyhq.com/posting-api/job-board/empty': json({ jobs: [] }),
    };
    const fetchImpl = async (u) => pages[u] ?? { status: 404, headers: new Headers() };
    const lookup = async () => [{ address: '8.8.8.8' }];
    const co = (key, url, extra = {}) => ({ key, name: key, stance: 'Watching', jobs: { j: { url } }, ...extra });
    const companies = [
        co('ok', 'https://boards.greenhouse.io/ok/jobs/9'),
        co('html', 'https://jobs.lever.co/html/x'),
        co('empty', 'https://jobs.ashbyhq.com/empty/u'),
        co('busy', 'https://boards.greenhouse.io/busy/jobs/9', { applications: [{ outcome: 'applied' }] }),
    ];
    const postings = [{ id: 'greenhouse:4', companyKey: 'ok', url: 'https://boards.greenhouse.io/ok/jobs/4' }];
    const out = await sweepBoards({ companies, postings }, { fetchImpl, lookup });
    assert.deepEqual(out.map((s) => [s.company, s.status, s.roles.map((r) => r.id)]), [
        ['ok', 'ok', ['greenhouse:1', 'greenhouse:2', 'greenhouse:3']],
        ['html', 'error', []],
        ['empty', 'ok', []],
    ]);
    companies[2].stance = 'Dormant';
    assert.deepEqual((await sweepBoards({ companies, postings }, { fetchImpl, lookup })).map((s) => s.company), ['ok', 'html']);
    assert.deepEqual((await sweepBoards({ companies, postings, dormant: true }, { fetchImpl, lookup })).map((s) => s.company), ['ok', 'html', 'empty']);
});

test('sweepBoards: bad responses and private hosts are errors', async () => {
    const co = (key, url) => ({ key, name: key, stance: 'Watching', jobs: { j: { url } } });
    const run = (company, fetchImpl, lookup = async () => [{ address: '8.8.8.8' }]) => sweepBoards({ companies: [company], postings: [] }, { fetchImpl, lookup });
    const gh = co('a', 'https://boards.greenhouse.io/a/jobs/1');

    let calls = 0;
    const [priv] = await run(gh, async () => { calls++; return { status: 200, headers: new Headers(), json: async () => ({ jobs: [] }) }; }, async () => [{ address: '10.0.0.1' }]);
    assert.deepEqual([priv.status, priv.roles, calls], ['error', [], 0]);

    const [down] = await run(gh, async () => ({ status: 500, headers: new Headers() }));
    assert.equal(down.status, 'error');

    const [odd] = await run(gh, async () => ({ status: 200, headers: new Headers(), json: async () => ({}) }));
    assert.equal(odd.status, 'error');
});

test('sweepBoards: large boards retain all roles for the bounded screening queue', async () => {
    const jobs = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: 'Senior Engineer', absolute_url: `https://boards.greenhouse.io/a/jobs/${i + 1}` }));
    const run = (n) => sweepBoards(
        { companies: [{ key: 'a', name: 'a', stance: 'Watching', jobs: { j: { url: 'https://boards.greenhouse.io/a/jobs/1' } } }], postings: [] },
        { fetchImpl: async () => ({ status: 200, headers: new Headers(), json: async () => ({ jobs: jobs(n) }) }), lookup: async () => [{ address: '8.8.8.8' }] },
    );
    const [big] = await run(31);
    assert.deepEqual([big.status, big.total, big.roles.length], ['ok', 31, 31]);
    const [edge] = await run(30);
    assert.deepEqual([edge.status, edge.roles.length], ['ok', 30]);
});

test('pickLinkTargets: eligible companies with no link and no known board, oldest check first, sliced', () => {
    const c = (name, over = {}) => ({ key: name.toLowerCase(), name, stance: 'Watching', jobs: {}, ...over });
    const list = [
        c('Zed', { lastChecked: '2026-11-18', monitoring: {lastLinksTriedAt:'2026-11-01T00:00:00Z'} }), c('Amy', { lastChecked: '2026-11-18', monitoring: {lastLinksTriedAt:'2026-11-01T00:00:00Z'} }), c('Fresh'), c('Late', { lastChecked: '2026-01-01', monitoring: {lastLinksTriedAt:'2026-11-10T00:00:00Z'} }),
        c('HasCareers', { careersUrl: 'https://x.com/careers' }), c('HasJobs', { jobsUrl: 'https://x.com/jobs' }),
        c('OnBoard', { jobs: { j: { url: 'https://jobs.lever.co/s/x' } } }),
        c('Applied', { applications: [{ id: 'a', outcome: 'applied' }] }), c('Out', { stance: 'Ruled out' }),
    ];
    assert.deepEqual(pickLinkTargets(list, []), ['Fresh', 'Amy', 'Zed', 'Late']);
    assert.deepEqual(pickLinkTargets(list, [], 2), ['Fresh', 'Amy']);
    assert.equal(LINK_SLICE, 40);
});

test('knownBoard ignores malformed stored links and falls through', () => {
    const next = { kind: 'lever', slug: 's1' };
    const post = [{ companyKey: 'a', url: 'https://jobs.lever.co/s1/x' }];
    for (const bad of [5, {}, '/careers', 'garbage ::']) {
        assert.deepEqual(knownBoard({ key: 'a', jobsUrl: bad, careersUrl: bad }, post), next);
    }
});

test('pickLinkTargets excludes a company whose only board evidence is a posting url', () => {
    const c = { key: 'p', name: 'P', stance: 'Watching', jobs: {} };
    assert.deepEqual(pickLinkTargets([c], [{ companyKey: 'p', url: 'https://jobs.ashbyhq.com/p/u' }]), []);
});

test('boardOf: bamboohr, breezy, workable, pinpoint', () => {
    assert.deepEqual(boardOf('https://rockbranch.bamboohr.com/careers/54'), { kind: 'bamboohr', slug: 'rockbranch' });
    assert.deepEqual(boardOf('https://holdco.breezy.hr/p/4ff64c701d4401-x'), { kind: 'breezy', slug: 'holdco' });
    assert.deepEqual(boardOf('https://brightform.pinpointhq.com/en/postings/u'), { kind: 'pinpoint', slug: 'brightform' });
    assert.deepEqual(boardOf('https://apply.workable.com/it1/j/0E2E2072EC/'), { kind: 'workable', slug: 'it1' });
    for (const u of ['https://apply.workable.com/j/0E2E2072EC', 'https://apply.workable.com/api/v1/x', 'https://www.bamboohr.com/careers/1',
        'https://api.breezy.hr/x', 'https://app.pinpointhq.com/x', 'https://careers.bamboohr.com/x']) assert.equal(boardOf(u), null, u);
});

test('sweepBoards: bamboohr, breezy, workable, pinpoint', async () => {
    const json = (body) => ({ status: 200, headers: new Headers(), json: async () => body });
    const pages = {
        'https://b.bamboohr.com/careers/list': json({ result: [{ id: '7', jobOpeningName: 'Senior Software Engineer' }, { id: '8', jobOpeningName: 'Software Engineer' }] }),
        'https://z.breezy.hr/json': json([{ id: 'abc123', name: 'Staff Engineer', url: 'https://z.breezy.hr/p/abc123-staff-engineer' }, { id: 'd', name: 'Intern Engineer', url: 'https://z.breezy.hr/p/d-i' }]),
        'https://apply.workable.com/api/v1/widget/accounts/w': json({ jobs: [{ title: 'Lead Developer', shortcode: '0E2E2072EC', url: 'https://apply.workable.com/j/0E2E2072EC' }, { title: 'Designer', shortcode: 'X', url: 'https://apply.workable.com/j/X' }] }),
        'https://p.pinpointhq.com/postings.json': json({ data: [{ id: '1', title: 'Principal Engineer', url: 'https://p.pinpointhq.com/en/postings/cdf03ccf-84c1-4c59-ad90-fb1b77ecc0f8' }] }),
        'https://bad.breezy.hr/json': json({ nope: 1 }),
    };
    const fetchImpl = async (u) => pages[u] ?? { status: 404, headers: new Headers() };
    const lookup = async () => [{ address: '8.8.8.8' }];
    const co = (key, url) => ({ key, name: key, stance: 'Watching', jobs: { j: { url } } });
    const companies = [co('b', 'https://b.bamboohr.com/careers/1'), co('z', 'https://z.breezy.hr/p/abc123-x'), co('w', 'https://apply.workable.com/w/j/0E2E2072EC/'),
        co('p', 'https://p.pinpointhq.com/en/postings/u'), co('bad', 'https://bad.breezy.hr/p/a-b'), co('gone', 'https://gone.breezy.hr/p/a-b')];
    const out = await sweepBoards({ companies, postings: [] }, { fetchImpl, lookup });
    assert.deepEqual(out.map((s) => [s.company, s.status, s.roles.map((r) => r.id)]), [
        ['b', 'ok', ['bamboohr:b:7', 'bamboohr:b:8']],
        ['z', 'ok', ['breezy:abc123']],
        ['w', 'ok', ['workable:0E2E2072EC']],
        ['p', 'ok', ['pinpoint:cdf03ccf-84c1-4c59-ad90-fb1b77ecc0f8']],
        ['bad', 'error', []],
        ['gone', 'error', []],
    ]);
    assert.equal(out[0].roles[0].url, 'https://b.bamboohr.com/careers/7');
});

test('sweepBoards: role id is boardId(url), never the raw api id', async () => {
    const json = (body) => ({ status: 200, headers: new Headers(), json: async () => body });
    const bad = { status: 200, headers: new Headers(), json: async () => { throw new Error('x'); } };
    const pages = {
        'https://z.breezy.hr/json': json([{ id: 'other', name: 'Staff Engineer', url: 'https://z.breezy.hr/p/abc123-staff-engineer' }]),
        'https://apply.workable.com/api/v1/widget/accounts/w': json({ jobs: [{ title: 'Lead Developer', shortcode: '0e2e2072ec', url: 'https://apply.workable.com/j/0E2E2072EC' }] }),
        'https://boards-api.greenhouse.io/v1/boards/g/jobs': json({ jobs: [{ id: 99, title: 'Senior Engineer', absolute_url: 'https://boards.greenhouse.io/g/jobs/5' }] }),
        'https://api.lever.co/v0/postings/l?mode=json': json([{ id: 'raw', text: 'Senior Engineer', hostedUrl: 'https://jobs.lever.co/l/0b3c1d2e-1111-2222-3333-444455556666' }]),
        'https://api.ashbyhq.com/posting-api/job-board/a': json({ jobs: [{ id: 'raw', title: 'Senior Engineer', jobUrl: 'https://jobs.ashbyhq.com/a/0b3c1d2e-1111-2222-3333-444455556666' }] }),
        'https://b.bamboohr.com/careers/list': json({ result: [{ id: '7?x', jobOpeningName: 'Senior Engineer' }, { id: '../x', jobOpeningName: 'Senior Engineer' }, { id: '9', jobOpeningName: 'Senior Engineer' }] }),
        'https://b1.bamboohr.com/careers/list': json({ nope: 1 }),
        'https://b2.bamboohr.com/careers/list': bad,
        'https://apply.workable.com/api/v1/widget/accounts/w1': json({ nope: 1 }),
        'https://apply.workable.com/api/v1/widget/accounts/w2': bad,
        'https://p1.pinpointhq.com/postings.json': json({ nope: 1 }),
        'https://p2.pinpointhq.com/postings.json': bad,
    };
    const fetchImpl = async (u) => pages[u] ?? { status: 404, headers: new Headers() };
    const lookup = async () => [{ address: '8.8.8.8' }];
    const co = (key, url) => ({ key, name: key, stance: 'Watching', jobs: { j: { url } } });
    const companies = [
        co('z', 'https://z.breezy.hr/p/abc123-x'), co('w', 'https://apply.workable.com/w/j/0E2E2072EC/'),
        co('g', 'https://boards.greenhouse.io/g/jobs/1'), co('l', 'https://jobs.lever.co/l/x'), co('a', 'https://jobs.ashbyhq.com/a/x'),
        co('b', 'https://b.bamboohr.com/careers/1'),
        co('b1', 'https://b1.bamboohr.com/careers/1'), co('b2', 'https://b2.bamboohr.com/careers/1'),
        co('w1', 'https://apply.workable.com/w1/j/A/'), co('w2', 'https://apply.workable.com/w2/j/A/'),
        co('p1', 'https://p1.pinpointhq.com/en/postings/u'), co('p2', 'https://p2.pinpointhq.com/en/postings/u'),
    ];
    const out = await sweepBoards({ companies, postings: [] }, { fetchImpl, lookup });
    const by = Object.fromEntries(out.map((s) => [s.company, s]));
    for (const k of ['z', 'w', 'g', 'l', 'a']) {
        assert.equal(by[k].roles.length, 1, k);
        assert.equal(by[k].roles[0].id, boardId(by[k].roles[0].url), k);
    }
    assert.equal(by.w.roles[0].id, 'workable:0E2E2072EC');
    assert.equal(by.z.roles[0].id, 'breezy:abc123');
    assert.deepEqual(by.b.roles.map((r) => r.url), ['https://b.bamboohr.com/careers/9']);
    for (const k of ['b1', 'b2', 'w1', 'w2', 'p1', 'p2']) assert.deepEqual([by[k].status, by[k].roles], ['error', []], k);
});

test('boardOf: rippling, workday, paylocity, gem, smartrecruiters, recruitee, personio, teamtailor, applytojob', () => {
    const cases = {
        'https://ats.rippling.com/en-CA/coveto/jobs': ['rippling', 'coveto'],
        'https://ats.rippling.com/kudosly': ['rippling', 'kudosly'],
        'https://acme.wd3.myworkdayjobs.com/en-US/Ext/job/x_R1': ['workday', 'acme.wd3.myworkdayjobs.com/acme/Ext'],
        'https://wd3.myworkdaysite.com/recruiting/volaris/GoSolutions': ['workday', 'wd3.myworkdaysite.com/volaris/GoSolutions'],
        'https://recruiting.paylocity.com/recruiting/jobs/All/13AFA810-5782-4e0f-bd66-ca1861e6a9df/X': ['paylocity', '13afa810-5782-4e0f-bd66-ca1861e6a9df'],
        'https://jobs.gem.com/informed-k12': ['gem', 'informed-k12'],
        'https://careers.smartrecruiters.com/INNERGY1': ['smartrecruiters', 'INNERGY1'],
        'https://medme.recruitee.com': ['recruitee', 'medme'],
        'https://lampbox.jobs.personio.com/': ['personio', 'lampbox.jobs.personio.com'],
        'https://cargas.na.teamtailor.com/jobs': ['teamtailor', 'cargas.na'],
        'https://getalma.applytojob.com/apply': ['applytojob', 'getalma'],
    };
    for (const [u, [kind, slug]] of Object.entries(cases)) assert.deepEqual(boardOf(u), { kind, slug }, u);
    for (const u of ['https://recruiting.paylocity.com/recruiting/jobs/Details/4440189/X', 'https://www.recruitee.com/x', 'https://ats.rippling.com/']) assert.equal(boardOf(u), null, u);
});

test('fetchRoles: workday pages, paylocity page data, teamtailor rss, applytojob links', async () => {
    const lookup = async () => [{ address: '8.8.8.8' }];
    const ok = (body) => ({ status: 200, headers: new Headers(), json: async () => body, text: async () => body });
    const posts = [];
    const wd = (n, off) => Array.from({ length: n }, (_, i) => ({ title: `Senior Engineer ${off + i}`, externalPath: `/job/US/Senior-Engineer_R${off + i}`, locationsText: 'Remote' }));
    const pages = {
        'https://recruiting.paylocity.com/recruiting/jobs/All/0a88105e-c979-4fda-8437-9cbf2ac511e3': ok('<script>\n    window.pageData = {"Jobs":[{"JobId":7,"JobTitle":"Senior Developer","LocationName":"Remote"}]};\n</script>'),
        'https://cargas.na.teamtailor.com/jobs.rss': ok('<rss><channel><item><title>Staff &amp; Lead Engineer</title><link>https://cargas.na.teamtailor.com/jobs/724582-x</link><tt:city>Lancaster</tt:city><remoteStatus>fully</remoteStatus></item></channel></rss>'),
        'https://mcp.applytojob.com/apply': ok('<h3><a href="https://mcp.applytojob.com/apply/rNP1xlF0vI/Senior-Software-Engineer">\n   Senior Software Engineer   </a></h3>'),
    };
    const fetchImpl = async (u, init) => {
        if (u.includes('/wday/cxs/')) {
            const { offset } = JSON.parse(init.body);
            posts.push(offset);
            return ok({ total: offset ? 0 : 25, jobPostings: wd(offset ? 5 : 20, offset) });
        }
        return pages[u] ?? { status: 404, headers: new Headers() };
    };
    const deps = { fetchImpl, lookup };
    const w = await fetchRoles({ kind: 'workday', slug: 'acme.wd3.myworkdayjobs.com/acme/Ext' }, deps);
    assert.deepEqual([w.length, posts, w[0].url, w[0].id], [25, [0, 20], 'https://acme.wd3.myworkdayjobs.com/Ext/job/US/Senior-Engineer_R0', 'workday:R0']);
    assert.deepEqual(await fetchRoles({ kind: 'paylocity', slug: '0a88105e-c979-4fda-8437-9cbf2ac511e3' }, deps),
        [{ id: 'paylocity:7', title: 'Senior Developer', url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/7', location: 'Remote' }]);
    assert.deepEqual(await fetchRoles({ kind: 'teamtailor', slug: 'cargas.na' }, deps),
        [{ id: 'teamtailor:724582', title: 'Staff & Lead Engineer', url: 'https://cargas.na.teamtailor.com/jobs/724582-x', location: 'Lancaster, Remote' }]);
    assert.deepEqual(await fetchRoles({ kind: 'applytojob', slug: 'mcp' }, deps),
        [{ id: 'applytojob:rNP1xlF0vI', title: 'Senior Software Engineer', url: 'https://mcp.applytojob.com/apply/rNP1xlF0vI/Senior-Software-Engineer' }]);
    assert.equal(await fetchRoles({ kind: 'paylocity', slug: 'ffffffff-c979-4fda-8437-9cbf2ac511e3' }, deps), null);
});

test('pageOf and the page reader: engineering job links on a careers page, not nav or docs links', async () => {
    const { pageOf } = await import('../lib/boardSweep.js');
    assert.deepEqual(pageOf({ careersUrl: 'https://acme.com/careers' }), { kind: 'page', slug: 'https://acme.com/careers' });
    assert.equal(pageOf({ careersUrl: '' }), null);
    const html = `<nav><a href="/developers">Developers</a><a href="/docs">Developer Docs</a><a href="/blog/x">Meet our engineers</a></nav>
        <a href="/jobs/1"><h3>Frontend Engineer, 2D Editor</h3> · Full-time · Remote</a>
        <a href="https://jobs.acme.com/2">Senior Software Engineer Full-time Remote / Emeryville</a>
        <a href="/jobs/3">Account Executive</a><a href="/jobs/1">Frontend Engineer, 2D Editor</a>`;
    const fetchImpl = async () => ({ status: 200, headers: new Headers(), text: async () => html });
    const roles = await fetchRoles({ kind: 'page', slug: 'https://acme.com/careers' }, { fetchImpl, lookup: async () => [{ address: '8.8.8.8' }] });
    assert.deepEqual(roles.map((r) => [r.title, r.url]), [['Frontend Engineer, 2D Editor', 'https://acme.com/jobs/1'], ['Senior Software Engineer', 'https://jobs.acme.com/2']]);
    assert.match(roles[0].id, /^page:[0-9a-f]{8}$/);
});

test('isEngineering keeps junior titles; sweepBoards drops them by `drop`', async () => {
    assert.equal(isEngineering('Junior Developer'), true);
    assert.equal(isEngineering('Engineering Manager'), false);
    const body = { jobs: [{ id: 1, title: 'Junior Developer', absolute_url: 'https://boards.greenhouse.io/j/jobs/1' }, { id: 2, title: 'Senior Engineer', absolute_url: 'https://boards.greenhouse.io/j/jobs/2' }] };
    const fetchImpl = async () => ({ status: 200, headers: new Headers(), json: async () => body });
    const lookup = async () => [{ address: '8.8.8.8' }];
    const companies = [{ key: 'j', name: 'j', stance: 'Watching', jobs: { x: { url: 'https://boards.greenhouse.io/j/jobs/9' } } }];
    const ids = async (extra) => (await sweepBoards({ companies, postings: [], ...extra }, { fetchImpl, lookup }))[0].roles.map((r) => r.id);
    assert.deepEqual(await ids({}), ['greenhouse:2']);
    assert.deepEqual(await ids({ drop: [] }), ['greenhouse:1', 'greenhouse:2']);
});
