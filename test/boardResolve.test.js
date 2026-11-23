import test from 'node:test';
import assert from 'node:assert/strict';
import { boardOf } from '../lib/boardSweep.js';
import { boardUrl, findBoards, resolveBoard, resolveAll, applyResolutions } from '../lib/boardResolve.js';

const pub = async () => [{ address: '93.184.216.34' }];
const res = (status, body) => ({ status, text: async () => body, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
const mk = (routes) => async (url) => {
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    if (!hit) return res(404, '');
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
};
const R = (status, body) => ({ ...res(status, body), headers: new Headers() });

test('boardUrl', () => {
    assert.equal(boardUrl({ kind: 'greenhouse', slug: 'a' }), 'https://boards.greenhouse.io/a');
    assert.equal(boardUrl({ kind: 'lever', slug: 'a' }), 'https://jobs.lever.co/a');
    assert.equal(boardUrl({ kind: 'ashby', slug: 'a' }), 'https://jobs.ashbyhq.com/a');
});

test('findBoards recognises every form', () => {
    const html = `<a href="https://boards.greenhouse.io/acme/jobs/1">x</a>
      <a href="https://job-boards.greenhouse.io/beta">x</a>
      <iframe src="https://boards.greenhouse.io/embed/job_board?for=gamma&b=1"></iframe>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=delta"></script>
      <a href="https://jobs.lever.co/eps/abc">x</a> jobs.ashbyhq.com/zeta
      <a href="https://boards.greenhouse.io/embed/job_board">no slug</a>`;
    assert.deepEqual(findBoards(html), [
        { kind: 'greenhouse', slug: 'acme' }, { kind: 'greenhouse', slug: 'beta' },
        { kind: 'greenhouse', slug: 'gamma' }, { kind: 'greenhouse', slug: 'delta' },
        { kind: 'lever', slug: 'eps' }, { kind: 'ashby', slug: 'zeta' },
    ]);
});

test('findBoards de-duplicates by kind and lower-cased slug', () => {
    assert.deepEqual(findBoards('boards.greenhouse.io/Acme and job-boards.greenhouse.io/acme/jobs/2'), [{ kind: 'greenhouse', slug: 'Acme' }]);
    assert.equal(findBoards('jobs.lever.co/acme jobs.ashbyhq.com/acme').length, 2);
});

const page = 'https://acme.com/careers';
const deps = (routes, extra = {}) => ({ fetchImpl: mk(routes), lookup: pub, ...extra });
const GH = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';

test('resolveBoard: one board confirmed by its API', async () => {
    const d = deps({ [page]: R(200, '<a href="https://boards.greenhouse.io/acme">'), [GH]: R(200, '{"jobs":[]}') });
    assert.deepEqual(await resolveBoard(page, d), { kind: 'greenhouse', slug: 'acme', url: 'https://boards.greenhouse.io/acme' });
});

test('resolveBoard: lever and ashby APIs', async () => {
    const l = deps({ [page]: R(200, 'jobs.lever.co/acme'), 'https://api.lever.co/v0/postings/acme?mode=json': R(200, '[]') });
    assert.equal((await resolveBoard(page, l)).kind, 'lever');
    const a = deps({ [page]: R(200, 'jobs.ashbyhq.com/acme'), 'https://api.ashbyhq.com/posting-api/job-board/acme': R(200, '{"jobs":[]}') });
    assert.equal((await resolveBoard(page, a)).kind, 'ashby');
});

test('resolveBoard: null cases', async () => {
    const two = deps({ [page]: R(200, 'boards.greenhouse.io/acme jobs.lever.co/acme'), [GH]: R(200, '{"jobs":[]}') });
    assert.equal(await resolveBoard(page, two), null);
    assert.equal(await resolveBoard(page, deps({ [page]: R(200, 'nothing here') })), null);
    const body = '<a href="https://boards.greenhouse.io/acme">';
    assert.equal(await resolveBoard(page, deps({ [page]: R(200, body), [GH]: R(404, '') })), null);
    assert.equal(await resolveBoard(page, deps({ [page]: R(200, body), [GH]: R(200, '{"jobs":5}') })), null);
    assert.equal(await resolveBoard(page, deps({ [page]: R(403, body), [GH]: R(200, '{"jobs":[]}') })), null);
    assert.equal(await resolveBoard(page, deps({ [page]: new Error('boom') })), null);
});

test('resolveBoard: private address is never fetched', async () => {
    let called = 0;
    const d = { fetchImpl: async () => { called++; return R(200, ''); }, lookup: async () => [{ address: '10.0.0.5' }] };
    assert.equal(await resolveBoard(page, d), null);
    assert.equal(called, 0);
});

test('resolveBoard reads only the first 500,000 characters', async () => {
    const html = `${'x'.repeat(500_000)}boards.greenhouse.io/acme`;
    assert.equal(await resolveBoard(page, deps({ [page]: R(200, html), [GH]: R(200, '{"jobs":[]}') })), null);
});

test('resolveAll', async () => {
    const d = deps({
        'https://a.com/careers': R(200, 'nothing'),
        'https://a.com': R(200, 'boards.greenhouse.io/acme'),
        [GH]: R(200, '{"jobs":[]}'),
    });
    const companies = [
        { key: 'a', name: 'A', stance: 'Watching', careersUrl: 'https://a.com/careers', website: 'https://a.com' },
        { key: 'b', name: 'B', stance: 'Watching', jobsUrl: 'https://jobs.lever.co/b' },
        { key: 'c', name: 'C', stance: 'Watching', careersUrl: 'https://c.com', applications: [{ outcome: 'applied' }] },
        { key: 'd', name: 'D', stance: 'Watching', careersUrl: 'ftp://d.com' },
    ];
    const out = await resolveAll({ companies, postings: [] }, d);
    assert.deepEqual(out, [
        { key: 'a', company: 'A', board: { kind: 'greenhouse', slug: 'acme', url: 'https://boards.greenhouse.io/acme' }, source: 'https://a.com' },
        { key: 'd', company: 'D', board: null, source: '' },
    ]);
});

test('findBoards is linear on hostile input', () => {
    for (const unit of ['boards.greenhouse.io/embed/job_board?', 'boards.greenhouse.io/embed/job_board/js?a&', 'boards.greenhouse.io/embed/job_board?a;']) {
        const html = unit.repeat(Math.ceil(500_000 / unit.length)).slice(0, 500_000);
        const t = performance.now();
        findBoards(html);
        assert.ok(performance.now() - t < 300, `${unit} took ${performance.now() - t} ms`);
    }
});

test('findBoards needs a left boundary', () => {
    assert.deepEqual(findBoards('notjobs.lever.co/x'), []);
    assert.deepEqual(findBoards('//jobs.lever.co/x'), [{ kind: 'lever', slug: 'x' }]);
});

test('applyResolutions', () => {
    const board = { url: 'https://boards.greenhouse.io/acme' };
    const a = { jobsUrl: '', careersUrl: '', events: [] };
    assert.equal(applyResolutions(a, board, '2026-11-17'), true);
    assert.deepEqual(a, { jobsUrl: board.url, careersUrl: '', events: [{ date: '2026-11-17', text: `Found jobs board ${board.url}` }] });
    const b = { jobsUrl: 'https://acme.com/jobs', careersUrl: '', events: [] };
    applyResolutions(b, board, 'd');
    assert.deepEqual([b.jobsUrl, b.careersUrl], [board.url, 'https://acme.com/jobs']);
    const c = { jobsUrl: 'https://acme.com/jobs', careersUrl: 'https://acme.com/c', events: [] };
    applyResolutions(c, board, 'd');
    assert.deepEqual([c.jobsUrl, c.careersUrl], [board.url, 'https://acme.com/c']);
    const d = { jobsUrl: 'https://jobs.lever.co/acme', careersUrl: '', events: [] };
    assert.equal(applyResolutions(d, board, 'd'), false);
    assert.deepEqual(d, { jobsUrl: 'https://jobs.lever.co/acme', careersUrl: '', events: [] });
});

test('resolveBoard stops reading a streamed body at the cap', async () => {
    let pulled = 0;
    const enc = new TextEncoder();
    const body = new ReadableStream({
        pull(c) {
            pulled++;
            c.enqueue(enc.encode(pulled === 1 ? '<a href="https://boards.greenhouse.io/acme">' + ' '.repeat(100_000) : ' '.repeat(100_000)));
        },
    });
    const page200 = { status: 200, headers: new Headers(), body, text: async () => { throw new Error('whole body read'); } };
    const d = deps({ [page]: page200, [GH]: R(200, '{"jobs":[]}') });
    assert.equal((await resolveBoard(page, d)).slug, 'acme');
    assert.ok(pulled < 20, `pulled ${pulled} chunks`);
});

const NEW = [
    ['bamboohr', 'https://acme.bamboohr.com/careers', 'https://acme.bamboohr.com/careers/list', '{"result":[]}'],
    ['breezy', 'https://acme.breezy.hr', 'https://acme.breezy.hr/json', '[]'],
    ['workable', 'https://apply.workable.com/acme', 'https://apply.workable.com/api/v1/widget/accounts/acme', '{"jobs":[]}'],
    ['pinpoint', 'https://acme.pinpointhq.com', 'https://acme.pinpointhq.com/postings.json', '{"data":[]}'],
];

test('boardUrl round-trips through boardOf for all seven kinds', () => {
    for (const kind of ['greenhouse', 'lever', 'ashby', 'bamboohr', 'breezy', 'workable', 'pinpoint']) {
        assert.deepEqual(boardOf(boardUrl({ kind, slug: 'acme' })), { kind, slug: 'acme' });
    }
    for (const [kind, url] of NEW) assert.equal(boardUrl({ kind, slug: 'acme' }), url);
});

test('findBoards recognises the four new forms', () => {
    const html = `<a href="https://acme.bamboohr.com/careers/12">x</a> beta.bamboohr.com
      <a href="https://gamma.breezy.hr/p/abc">x</a> <a href="//delta.pinpointhq.com/en/postings/1">x</a>
      <a href="https://apply.workable.com/eps/j/ABC/">x</a>`;
    assert.deepEqual(findBoards(html), [
        { kind: 'bamboohr', slug: 'acme' }, { kind: 'bamboohr', slug: 'beta' },
        { kind: 'breezy', slug: 'gamma' }, { kind: 'pinpoint', slug: 'delta' }, { kind: 'workable', slug: 'eps' },
    ]);
});

test('findBoards never takes a reserved word as a slug', () => {
    const html = 'www.bamboohr.com api.breezy.hr app.pinpointhq.com careers.bamboohr.com apply.workable.com/j/X apply.workable.com/api/v1 x.www.bamboohr.com';
    assert.deepEqual(findBoards(html), []);
    assert.deepEqual(findBoards('foo.acme.breezy.hr'), []);
});

test('resolveBoard confirms each new kind and rejects a 404', async () => {
    for (const [kind, url, api, body] of NEW) {
        const ok = await resolveBoard(page, deps({ [page]: R(200, `<a href="${url}">`), [api]: R(200, body) }));
        assert.deepEqual(ok, { kind, slug: 'acme', url });
        assert.equal(await resolveBoard(page, deps({ [page]: R(200, `<a href="${url}">`), [api]: R(404, '') })), null);
    }
});

test('findBoards is linear on the new patterns', () => {
    const units = ['a.bamboohr.com', 'aaaaaaaaaaaaaaaa', 'a.', 'apply.workable.com/', '.breezy.hr', 'x-.pinpointhq.com', 'a.a.a.a.bamboohr'];
    for (const unit of units) {
        const html = unit.repeat(Math.ceil(500_000 / unit.length)).slice(0, 500_000);
        const t = performance.now();
        findBoards(html);
        assert.ok(performance.now() - t < 300, `${unit} took ${performance.now() - t} ms`);
    }
});

test('findBoards: embed is never a slug for any kind', () => {
    assert.deepEqual(findBoards('jobs.lever.co/embed jobs.ashbyhq.com/embed boards.greenhouse.io/embed'), []);
});

test('findBoards: a lookalike domain or path is not a board', () => {
    for (const t of ['acme.bamboohr.com.evil.example', 'acme.breezy.hr.evil.example', 'acme.pinpointhq.com.evil.example', 'notbamboohr.com',
        'boards.greenhouse.io/acme.evil', 'jobs.lever.co/acme.evil', 'jobs.ashbyhq.com/acme.evil', 'apply.workable.com/acme.evil']) {
        assert.deepEqual(findBoards(t), [], t);
    }
});

test('findBoards: a sentence-ending dot still matches', () => {
    assert.deepEqual(findBoards('see acme.bamboohr.com.'), [{ kind: 'bamboohr', slug: 'acme' }]);
    assert.deepEqual(findBoards('see jobs.lever.co/acme. Then'), [{ kind: 'lever', slug: 'acme' }]);
});

test('findBoards: a full link to a board with no short form (rippling, workday)', () => {
    assert.deepEqual(findBoards('<a href="https://ats.rippling.com/acme/jobs">Jobs</a>'), [{ kind: 'rippling', slug: 'acme', url: 'https://ats.rippling.com/acme/jobs' }]);
    assert.deepEqual(findBoards('<iframe src="https://acme.wd1.myworkdayjobs.com/Careers">').map((b) => b.slug), ['acme.wd1.myworkdayjobs.com/acme/Careers']);
});

test('boardFromUrl reads board API calls a careers page script makes; pickBoard takes the clear winner', async () => {
    const { boardFromUrl, pickBoard, browserTargets } = await import('../lib/boardResolve.js');
    const cases = [
        ['https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true', 'greenhouse', 'acme'],
        ['https://api.ashbyhq.com/posting-api/job-board/acme?x=1', 'ashby', 'acme'],
        ['https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs', 'workday', 'acme.wd5.myworkdayjobs.com/acme/External'],
        ['https://api.rippling.com/platform/api/ats/v1/board/acme-careers/jobs', 'rippling', 'acme-careers'],
        ['https://www.smartrecruiters.com/job-api/public/search/widgets/Medtelligent/postings?offset=0', 'smartrecruiters', 'Medtelligent'],
        ['https://jobs.lever.co/acme/123', 'lever', 'acme'],
    ];
    for (const [u, kind, slug] of cases) assert.deepEqual(boardFromUrl(u), { kind, slug }, u);
    assert.equal(boardFromUrl('https://static.smartrecruiters.com/job-widget/1.5.8/css/x.css'), null);
    const gh = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';
    assert.deepEqual(pickBoard([gh, gh, 'https://jobs.lever.co/other/1', 'https://x.com']), { kind: 'greenhouse', slug: 'acme' });
    assert.equal(pickBoard([gh, 'https://jobs.lever.co/other/1']), null);
    assert.equal(pickBoard(['https://x.com']), null);
    const co = (key, over) => ({ key, name: key, stance: 'Watching', jobs: {}, ...over });
    assert.deepEqual(browserTargets([co('a', { careersUrl: 'https://a.com/careers', website: 'https://a.com' }), co('b', { website: 'https://b.com' }),
        co('c', { jobsUrl: 'https://boards.greenhouse.io/c' }), co('d', {}), co('e', { stance: 'Ruled out', website: 'https://e.com' })], []).map((t) => [t.key, t.url]),
    [['a', 'https://a.com/careers'], ['b', 'https://b.com']]);
});

test('find-boards finish sets jobsUrl from a board whose API answers, only for targets', async () => {
    const { run } = await import('../bin/find-boards-finish.js');
    const { sqliteD1, applySchema } = await import('./sqliteD1.js');
    const { writeRows, loadAll } = await import('../lib/store.js');
    const db = sqliteD1();
    await applySchema(db);
    const co = (key) => ({ key, name: key, stance: 'Watching', jobs: {}, careersUrl: `https://${key}.com/careers` });
    await writeRows(db, { companies: ['a', 'b', 'c'].map((k) => ({ id: k, version: null, record: co(k) })) });
    const api = (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`;
    const fetchImpl = async (u) => (u === api('a-co') ? { status: 200, headers: new Headers(), json: async () => ({ jobs: [] }) } : { status: 404, headers: new Headers() });
    const n = await run(db, {
        targets: [{ key: 'a' }, { key: 'b' }],
        observed: [{ key: 'a', seen: [api('a-co')] }, { key: 'b', seen: [api('dead')] }, { key: 'c', seen: [api('a-co')] }],
        today: '2026-11-23', deps: { fetchImpl, lookup: async () => [{ address: '8.8.8.8' }] },
    });
    assert.equal(n, 1);
    const by = Object.fromEntries((await loadAll(db, 'companies')).map((r) => [r.id, r.record]));
    assert.equal(by.a.jobsUrl, 'https://boards.greenhouse.io/a-co');
    assert.equal(by.b.jobsUrl, undefined);
    assert.equal(by.c.jobsUrl, undefined);
});
