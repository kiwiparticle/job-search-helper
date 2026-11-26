import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAction, handleActivity, handleToken, handleData, handleStatus, handleThread, isAllowedPath, checkActionRequest } from '../functions/lib/handlers.js';
import { safeHref } from '../lib/safe.js';
import { makeGithub } from '../functions/lib/github.js';
import { blankCompany } from '../lib/companies.js';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows } from '../lib/store.js';

// In-memory stand-in for the GitHub contents + dispatch API.
function fakeGithub(files) {
    const store = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { text, sha: 's0' }]));
    const calls = { dispatches: [] };
    return {
        calls,
        store,
        async getFile(path) {
            if (!store[path]) { const e = new Error('not found'); e.status = 404; throw e; }
            return { ...store[path] };
        },
        async getRaw(path) {
            if (!store[path]) { const e = new Error('not found'); e.status = 404; throw e; }
            return new Response(store[path].text);
        },
        async dispatch(workflow, inputs) { calls.dispatches.push({ workflow, inputs }); },
    };
}
const deps = (gh, db) => ({ gh, db, today: () => '2026-11-13' });
const thread = (proposal) => JSON.stringify({ company: 'Ostrander', messages: [
    { by: 'owner', text: 'Dig deeper', at: 'T' },
    { by: 'claude', text: 'They posted a TS role.', at: 'T', proposal },
] });

async function seededDb(...records) {
    const db = sqliteD1();
    await applySchema(db);
    await writeRows(db, { companies: records.map((record) => ({ id: record.key, version: null, record })) });
    return db;
}
const rec = (name, over = {}) => ({ ...blankCompany(name), ...over });
const stored = async (db, key) => (await loadAll(db, 'companies')).find((r) => r.id === key)?.record;
const act = async (gh, db, body) => { const res = await handleAction(body, deps(gh, db)); return [res.status, await res.json()]; };

test('data rejects paths outside the allowlist', () => {
    assert.ok(isAllowedPath('data/unfiled-history.jsonl'));
    assert.ok(isAllowedPath('data/schedule.json'));
    assert.ok(!isAllowedPath('ledger.md'));
    assert.ok(isAllowedPath('data/verticals.json'));
    assert.ok(isAllowedPath('data/models.json'));
    assert.ok(isAllowedPath('runs/index.json'));
    assert.ok(isAllowedPath('applications/cartwheelengine-staff/resume.docx'));
    assert.ok(isAllowedPath('followups'));
    assert.ok(isAllowedPath('followups/acme-senior-engineer/followup-1.md'));
    assert.ok(!isAllowedPath('followups/../x'));
    assert.ok(!isAllowedPath('../.github/workflows/search.yml'));
    assert.ok(!isAllowedPath('runs/../.github/workflows/search.yml'));
    assert.ok(!isAllowedPath('.env'));
    assert.ok(!isAllowedPath('/data/unfiled-history.jsonl'));
    assert.ok(!isAllowedPath('instructions.md'));
    assert.ok(!isAllowedPath('runs\\x'));
});

test('data returns 403 for a disallowed path without calling GitHub', async () => {
    const gh = fakeGithub({});
    const res = await handleData('.github/workflows/search.yml', deps(gh));
    assert.equal(res.status, 403);
});

test('getFile falls back to the raw media type when GitHub returns no content', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
        seen.push(init?.headers?.accept);
        return init?.headers?.accept === 'application/vnd.github.raw'
            ? new Response('{"a":1}\n') : new Response(JSON.stringify({ sha: 'abc', encoding: 'none', content: '' }));
    };
    const gh = makeGithub({ token: 't', repo: 'o/r', fetchImpl });
    assert.deepEqual(await gh.getFile('data/companies.jsonl'), { text: '{"a":1}\n', sha: 'abc' });
    assert.ok(seen.includes('application/vnd.github.raw'));
});

const REPORT = '2026-11-13-daily';
const reportFile = (r) => ({ [`runs/${REPORT}/report.json`]: JSON.stringify(r) });

test('run dispatches search with the workflow', async () => {
    const gh = fakeGithub({});
    await handleAction({ type: 'run', workflow: 'culture' }, deps(gh));
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'culture' } }]);
});

test('a vertical run may carry a topic; other workflows and bad topics are refused', async () => {
    const gh = fakeGithub({});
    const res = await handleAction({ type: 'run', workflow: 'vertical', topic: '  K-12 and ed-tech vendors ' }, deps(gh));
    assert.equal(res.status, 202);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'vertical', topic: 'K-12 and ed-tech vendors' } }]);
    // Judge roles: a count, and chain for "all".
    const g2 = fakeGithub({});
    await handleAction({ type: 'run', workflow: 'tracked', sweepRoles: 30, chain: true }, deps(g2));
    assert.deepEqual(g2.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'tracked', sweep_roles: '30', chain: '9' } }]);
    assert.equal((await handleAction({ type: 'run', workflow: 'tracked', sweepRoles: 31 }, deps(g2))).status, 400);
    assert.equal((await handleAction({ type: 'run', workflow: 'daily', sweepRoles: 5 }, deps(g2))).status, 400);
    assert.equal((await handleAction({ type: 'run', workflow: 'daily', topic: 'x' }, deps(gh))).status, 400);
    assert.equal((await handleAction({ type: 'run', workflow: 'vertical', topic: 'x'.repeat(601) }, deps(gh))).status, 400);
    assert.equal((await handleAction({ type: 'run', workflow: 'vertical', topic: 7 }, deps(gh))).status, 400);
    assert.equal(gh.calls.dispatches.length, 1);
});

test('a directed run needs a direction and passes it as the topic', async () => {
    const gh = fakeGithub({});
    assert.equal((await handleAction({ type: 'run', workflow: 'directed' }, deps(gh))).status, 400);
    assert.equal((await handleAction({ type: 'run', workflow: 'directed', topic: 'x'.repeat(2001) }, deps(gh))).status, 400);
    const res = await handleAction({ type: 'run', workflow: 'directed', topic: ' Staff graphics roles at CAD vendors ' }, deps(gh));
    assert.equal(res.status, 202);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'directed', topic: 'Staff graphics roles at CAD vendors' } }]);
});

test('kit dispatches kit.yml and validates pieces', async () => {
    const gh = fakeGithub({});
    const db = await seededDb();
    assert.equal((await handleAction({ type: 'kit', company: 'Cartwheel Engine', role: 'Staff', url: 'https://x', pieces: 'resume,rm -rf' }, deps(gh, db))).status, 400);
    await handleAction({ type: 'kit', company: 'Cartwheel Engine', role: 'Staff', url: 'https://x', pieces: 'resume,answers' }, deps(gh, db));
    assert.equal(gh.calls.dispatches[0].workflow, 'kit.yml');
    assert.equal(gh.calls.dispatches[0].inputs.pieces, 'resume,answers');
});

test('kit with applying: true moves the job to applying; without it the job is saved; a non-boolean is 400', async () => {
    const gh = fakeGithub({});
    const db = await seededDb(rec('Cartwheel Engine'));
    const body = { type: 'kit', company: 'Cartwheel Engine', role: 'Staff', url: 'https://x.example/1', pieces: 'resume', postingId: 'p1' };
    assert.equal((await handleAction({ ...body, applying: 'yes' }, deps(gh, db))).status, 400);
    assert.equal(gh.calls.dispatches.length, 0);
    assert.equal((await handleAction(body, deps(gh, db))).status, 202);
    assert.equal((await stored(db, 'cartwheelengine')).jobs.p1.state, 'saved');
    assert.equal((await handleAction({ ...body, applying: true }, deps(gh, db))).status, 202);
    assert.equal((await stored(db, 'cartwheelengine')).jobs.p1.state, 'applying');
    assert.equal(gh.calls.dispatches.at(-1).workflow, 'kit.yml');
});

test('kit with applying stamps kitStartedAt; without it nothing is stamped', async () => {
    const gh = fakeGithub({});
    const db = await seededDb(rec('Cartwheel Engine'));
    const body = { type: 'kit', company: 'Cartwheel Engine', role: 'Staff', url: 'https://x.example/1', pieces: 'resume', postingId: 'p1' };
    await handleAction(body, deps(gh, db));
    assert.equal((await stored(db, 'cartwheelengine')).jobs.p1.kitStartedAt, undefined);
    await handleAction({ ...body, applying: true }, deps(gh, db));
    assert.match((await stored(db, 'cartwheelengine')).jobs.p1.kitStartedAt, /^\d{4}-\d\d-\d\dT/);
});

test('kit without applying leaves an applying job applying', async () => {
    const gh = fakeGithub({});
    const db = await seededDb(rec('Cartwheel Engine'));
    const body = { type: 'kit', company: 'Cartwheel Engine', role: 'Staff', url: 'https://x.example/1', pieces: 'resume', postingId: 'p1' };
    await handleAction({ ...body, applying: true }, deps(gh, db));
    assert.equal((await handleAction(body, deps(gh, db))).status, 202);
    assert.equal((await stored(db, 'cartwheelengine')).jobs.p1.state, 'applying');
});

test('kitReview dispatches kit-review.yml and validates reviewers', async () => {
    const gh = fakeGithub({});
    const db = await seededDb();
    assert.equal((await handleAction({ type: 'kitReview', company: 'Tarnwick Labs', role: 'Staff', reviewers: 'gemini' }, deps(gh, db))).status, 400);
    assert.equal((await handleAction({ type: 'kitReview', company: 'Tarnwick Labs', role: 'Staff', reviewers: 'both', note: 'check keywords' }, deps(gh, db))).status, 202);
    assert.deepEqual(gh.calls.dispatches[0], { workflow: 'kit-review.yml', inputs: { company: 'Tarnwick Labs', role: 'Staff', reviewers: 'both', note: 'check keywords' } });
});

test('kitRevise dispatches kit-revise.yml and validates the reviser', async () => {
    const gh = fakeGithub({});
    const db = await seededDb();
    assert.equal((await handleAction({ type: 'kitRevise', company: 'Tarnwick Labs', role: 'Staff', reviser: 'both' }, deps(gh, db))).status, 400);
    assert.equal((await handleAction({ type: 'kitRevise', company: 'Tarnwick Labs', role: 'Staff', reviser: 'codex' }, deps(gh, db))).status, 202);
    assert.deepEqual(gh.calls.dispatches[0], { workflow: 'kit-revise.yml', inputs: { company: 'Tarnwick Labs', role: 'Staff', reviser: 'codex' } });
});

test('reviewJob dispatches the job search and writes nothing', async () => {
    const gh = fakeGithub({});
    const db = await seededDb();
    const before = JSON.stringify(await loadAll(db, 'companies'));
    assert.equal((await handleAction({ type: 'reviewJob', company: 'Ostrander', role: 'Staff' }, deps(gh, db))).status, 400);
    assert.equal((await handleAction({ type: 'reviewJob', company: 'Ostrander', role: 'Staff', url: 'https://x.example/1' }, deps(gh, db))).status, 202);
    assert.deepEqual(gh.calls.dispatches[0], { workflow: 'search.yml', inputs: { workflow: 'job', job_company: 'Ostrander', job_role: 'Staff', job_url: 'https://x.example/1' } });
    assert.equal(JSON.stringify(await loadAll(db, 'companies')), before);
});

test('reviewJob forwards the chosen models and rejects bad ids', async () => {
    const gh = fakeGithub({});
    const db = await seededDb();
    const job = { type: 'reviewJob', company: 'Ostrander', role: 'Staff', url: 'https://x.example/1' };
    assert.equal((await handleAction({ ...job, searchers: ['x y'] }, deps(gh, db))).status, 400);
    assert.equal((await handleAction({ ...job, searchers: ['claude'], reviewer: 'codex' }, deps(gh, db))).status, 202);
    assert.deepEqual(gh.calls.dispatches[0].inputs, { workflow: 'job', job_company: 'Ostrander', job_role: 'Staff', job_url: 'https://x.example/1', searchers: 'claude', reviewer: 'codex' });
});

test('bad run name is rejected', async () => {
    const gh = fakeGithub({});
    assert.equal((await handleAction({ type: 'undo', run: '../x', company: 'Ostrander' }, deps(gh))).status, 400);
});

test('unknown type returns 400', async () => {
    assert.equal((await handleAction({ type: 'deleteEverything' }, deps(fakeGithub({})))).status, 400);
});

test('the applications folder itself can be listed', () => {
    assert.ok(isAllowedPath('applications'));
    assert.ok(!isAllowedPath('applications/'));
});

test('encoded traversal and query characters are rejected', () => {
    assert.ok(!isAllowedPath('runs/%2e%2e/history.md'));
    assert.ok(!isAllowedPath('runs/x?ref=other'));
    assert.ok(!isAllowedPath('runs/x#frag'));
});

test('action requests must be same-origin JSON', () => {
    const req = (headers) => new Request('https://jobs.example/api/action', { method: 'POST', headers });
    assert.equal(checkActionRequest(req({ 'content-type': 'application/json', origin: 'https://jobs.example' })), null);
    assert.equal(checkActionRequest(req({ 'content-type': 'text/plain', origin: 'https://jobs.example' })).status, 415);
    assert.equal(checkActionRequest(req({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403);
    assert.equal(checkActionRequest(req({ 'content-type': 'application/json' })).status, 403);
});

test('safeHref allows only http(s) and same-site paths', () => {
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref(' JAVASCRIPT:alert(1)'), null);
    assert.equal(safeHref('data:text/html,x'), null);
    assert.equal(safeHref('https://jobs.lever.co/x'), 'https://jobs.lever.co/x');
    assert.equal(safeHref('kit.html?dir=a'), 'kit.html?dir=a');
});

test('data responses are sandboxed and never sniffed', async () => {
    const gh = { getRaw: async () => new Response('<script>x</script>', { headers: { 'content-type': 'text/html' } }) };
    const res = await handleData('runs/x/evil.html', { gh });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
});

test('a rejected dispatch reports GitHub\'s error, not a conflict', async () => {
    const gh = { dispatch: async () => { const e = new Error('GitHub 422: Workflow does not have workflow_dispatch trigger'); e.status = 422; throw e; } };
    const res = await handleAction({ type: 'run', workflow: 'daily' }, deps(gh));
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /workflow_dispatch/);
});

test('status lists active runs with their current step', async () => {
    const gh = {
        listActiveRuns: async () => [
            { id: 7, name: 'search', status: 'in_progress', run_started_at: '2026-11-13T20:00:00Z', html_url: 'https://github.com/x/actions/runs/7' },
            { id: 8, name: 'kit', status: 'queued', run_started_at: '2026-11-13T20:05:00Z', html_url: 'https://github.com/x/actions/runs/8' },
        ],
        listJobs: async (id) => (id === 7 ? [{ name: 'search (claude)', status: 'in_progress' }, { name: 'setup', status: 'completed' }] : []),
    };
    const body = await (await handleStatus({ gh })).json();
    assert.deepEqual(body.runs, [
        { workflow: 'search', status: 'in_progress', startedAt: '2026-11-13T20:00:00Z', step: 'search (claude)', url: 'https://github.com/x/actions/runs/7' },
        { workflow: 'kit', status: 'queued', startedAt: '2026-11-13T20:05:00Z', step: null, url: 'https://github.com/x/actions/runs/8' },
    ]);
});

test('ask dispatches ask.yml and validates the model', async () => {
    const gh = fakeGithub({});
    assert.equal((await handleAction({ type: 'ask', company: 'Ostrander', model: '../x', question: 'q' }, deps(gh))).status, 400);
    assert.equal((await handleAction({ type: 'ask', company: 'Ostrander', model: 'claude', question: '' }, deps(gh))).status, 400);
    const now = () => '2026-11-16T10:00:00.000Z';
    await handleAction({ type: 'ask', company: 'Ostrander', model: 'codex', question: 'Dig deeper' }, { ...deps(gh), now });
    await handleAction({ type: 'ask', company: 'Ostrander', model: 'both', question: 'Dig deeper' }, { ...deps(gh), now });
    assert.equal(gh.calls.dispatches[1].inputs.model, 'both');
    assert.deepEqual(gh.calls.dispatches[0], { workflow: 'ask.yml', inputs: { company: 'Ostrander', model: 'codex', question: 'Dig deeper', at: '2026-11-16T10:00:00.000Z' } });
});

test('ask accepts a registry id and both', async () => {
    const gh = fakeGithub({});
    const res = await handleAction({ type: 'ask', company: 'Ostrander', model: 'opencode-glm', question: 'q' }, { ...deps(gh), now: () => 'T' });
    assert.equal(res.status, 202);
    assert.equal(gh.calls.dispatches[0].inputs.model, 'opencode-glm');
    assert.equal((await handleAction({ type: 'ask', company: 'Ostrander', model: 'both', question: 'q' }, { ...deps(gh), now: () => 'T' })).status, 202);
    assert.equal((await handleAction({ type: 'ask', company: 'Ostrander', model: 'a/b', question: 'q' }, deps(gh))).status, 400);
});

test('run with searchers and reviewer dispatches them; bad shapes are 400', async () => {
    const gh = fakeGithub({});
    const res = await handleAction({ type: 'run', workflow: 'daily', searchers: ['claude', 'codex'], reviewer: 'opencode' }, deps(gh));
    assert.equal(res.status, 202);
    assert.deepEqual(gh.calls.dispatches[0], { workflow: 'search.yml', inputs: { workflow: 'daily', searchers: 'claude,codex', reviewer: 'opencode' } });
    for (const extra of [{ searchers: ['a', 'b', 'c'] }, { searchers: ['a/b'] }, { searchers: [] }, { searchers: 'claude' }, { reviewer: '../x' }, { reviewer: 5 }]) {
        assert.equal((await handleAction({ type: 'run', workflow: 'daily', ...extra }, deps(gh))).status, 400, JSON.stringify(extra));
    }
    assert.equal(gh.calls.dispatches.length, 1);
});

test('run and reviewJob forward the reviewer tokens each and none', async () => {
    for (const reviewer of ['each', 'none']) {
        const gh = fakeGithub({});
        const db = await seededDb();
        assert.equal((await handleAction({ type: 'run', workflow: 'daily', reviewer }, deps(gh, db))).status, 202);
        assert.equal(gh.calls.dispatches[0].inputs.reviewer, reviewer);
        const job = { type: 'reviewJob', company: 'Ostrander', role: 'Staff', url: 'https://x.example/1', reviewer };
        assert.equal((await handleAction(job, deps(gh, db))).status, 202);
        assert.equal(gh.calls.dispatches[1].inputs.reviewer, reviewer);
    }
});

test('thread endpoint returns an empty thread when none exists', async () => {
    const body = await (await handleThread('Ostrander', { gh: fakeGithub({}) })).json();
    assert.deepEqual(body, { company: 'Ostrander', messages: [] });
});

test('thread endpoint reads asks/<key>.json', async () => {
    const gh = fakeGithub({ 'asks/ostrander.json': thread(undefined) });
    assert.equal((await (await handleThread('Ostrander', { gh })).json()).messages.length, 2);
});

test('recheck dispatches check-postings.yml with no inputs; fillFacts dispatches fill.yml', async () => {
    const gh = fakeGithub({});
    const db = await seededDb(rec('Ostrander'));
    await handleAction({ type: 'recheck' }, deps(gh));
    await handleAction({ type: 'fillFacts', company: 'Ostrander' }, { ...deps(gh, db), now: () => '2026-11-16T10:00:00.000Z' });
    assert.equal((await stored(db, 'ostrander')).fillRequested, '2026-11-16T10:00:00.000Z');
    assert.deepEqual(gh.calls.dispatches, [
        { workflow: 'check-postings.yml', inputs: {} },
        { workflow: 'fill.yml', inputs: { company: 'Ostrander', at: '2026-11-16T10:00:00.000Z' } },
    ]);
    assert.equal((await handleAction({ type: 'fillFacts' }, deps(gh))).status, 400);
    await handleAction({ type: 'fillFacts', company: 'Ostrander', model: 'codex' }, { ...deps(gh, db), now: () => 'T2' });
    assert.deepEqual(gh.calls.dispatches[2], { workflow: 'fill.yml', inputs: { company: 'Ostrander', at: 'T2', model: 'codex' } });
    const res = await handleAction({ type: 'fillFacts', company: 'Ostrander', model: '../x' }, deps(gh, db));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /bad model/);
});

test('addCompany creates a Watching company, dispatches fill, and refuses a repeat', async () => {
    const db = await seededDb();
    const gh = fakeGithub({});
    assert.equal((await act(gh, db, { type: 'addCompany', company: ' Acme Corp ', careersUrl: 'https://acme.test/careers', jobsUrl: '' }))[0], 202);
    const r = await stored(db, 'acme');
    assert.deepEqual([r.name, r.stance, r.careersUrl, r.events.length], ['Acme Corp', 'Watching', 'https://acme.test/careers', 3]);
    assert.equal(gh.calls.dispatches[0].workflow, 'fill.yml');
    assert.equal((await act(gh, db, { type: 'addCompany', company: 'Acme Corp' }))[0], 409);
    assert.equal((await act(gh, db, { type: 'addCompany' }))[0], 400);
});

test('v1 actions are gone', async () => {
    for (const type of ['setStatus', 'skipRole', 'markActed', 'pass', 'decide']) {
        assert.equal((await handleAction({ type, company: 'Ostrander' }, deps(fakeGithub({})))).status, 400, type);
    }
});

test('setStance round trip: 409 needsConfirm, then confirmed writes', async () => {
    const db = await seededDb(rec('Ostrander', { stance: 'Watching' }));
    const gh = fakeGithub({});
    const [status, body] = await act(gh, db, { type: 'setStance', company: 'Ostrander', stance: 'Ruled out' });
    assert.equal(status, 409);
    assert.equal(body.needsConfirm, true);
    assert.equal((await stored(db, 'ostrander')).stance, 'Watching');
    const [s2] = await act(gh, db, { type: 'setStance', company: 'Ostrander', stance: 'Ruled out', confirmed: true });
    assert.equal(s2, 200);
    const r = await stored(db, 'ostrander');
    assert.equal(r.stance, 'Ruled out');
    assert.deepEqual(r.events, [{ date: '2026-11-13', text: 'Stance Watching → Ruled out' }]);
    assert.equal(gh.calls.dispatches.length, 0);
});

test('a plain pure-function 409 has no needsConfirm; bad input is 400; unknown company is 404', async () => {
    const db = await seededDb(rec('Ostrander', { applications: [{ id: 'a1', role: 'R', leadKey: 'ostrander::r', appliedOn: 'd', outcome: 'applied' }] }));
    const gh = fakeGithub({});
    const [s1, b1] = await act(gh, db, { type: 'markApplied', company: 'Ostrander', applicationId: 'a1', role: 'R', confirmed: true });
    assert.equal(s1, 409);
    assert.equal(b1.needsConfirm, undefined);
    assert.equal((await act(gh, db, { type: 'setOutcome', company: 'Ostrander', applicationId: 'a1', outcome: 'passed' }))[0], 400);
    assert.equal((await act(gh, db, { type: 'setStance', company: 'Nobody', stance: 'Dormant' }))[0], 404);
    assert.equal((await act(gh, db, { type: 'markApplied', company: 'Nobody', applicationId: 'x', role: 'R' }))[0], 404);
});

test('markSeen across two companies is one batch', async () => {
    const db = await seededDb(
        rec('Ostrander', { jobs: { 'key:1': { state: 'saved', role: 'A', at: 'd' } } }),
        rec('Quillfeather', { applications: [{ id: 'a1', postingId: 'key:2', role: 'B', appliedOn: 'd', outcome: 'applied' }] }),
    );
    let batches = 0;
    const real = db.batch.bind(db);
    db.batch = (s) => { batches++; return real(s); };
    const [status] = await act(fakeGithub({}), db, { type: 'markSeen', seen: [
        { company: 'Ostrander', postingId: 'key:1', goneAt: '2026-11-10' },
        { company: 'Quillfeather', postingId: 'key:2', goneAt: '2026-11-11' },
    ] });
    assert.equal(status, 200);
    assert.equal(batches, 1);
    assert.equal((await stored(db, 'ostrander')).jobs['key:1'].seenGone, '2026-11-10');
    assert.equal((await stored(db, 'quillfeather')).applications[0].seenGone, '2026-11-11');
});

test('kit with a postingId saves the job first, then dispatches with posting_id', async () => {
    const db = await seededDb(rec('Ostrander'));
    const gh = fakeGithub({});
    const dispatchSaw = [];
    const real = gh.dispatch;
    gh.dispatch = async (w, i) => { dispatchSaw.push(Object.keys((await stored(db, 'ostrander')).jobs)); return real(w, i); };
    const [status] = await act(gh, db, { type: 'kit', company: 'Ostrander', role: 'Staff', url: 'https://x.example/1', pieces: 'resume', postingId: 'key:9' });
    assert.equal(status, 202);
    assert.deepEqual(dispatchSaw, [['key:9']]);
    assert.equal(gh.calls.dispatches[0].inputs.posting_id, 'key:9');
    const r = await stored(db, 'ostrander');
    assert.equal(r.jobs['key:9'].state, 'saved');
    assert.equal(r.stance, 'Watching');
    assert.equal(r.events.length, 1);
});

test('kit at a company with an active application needs confirm and dispatches nothing until then', async () => {
    const db = await seededDb(rec('Ostrander', { applications: [{ id: 'a1', role: 'Staff Engineer', leadKey: 'k', appliedOn: '2026-11-12', outcome: 'applied' }] }));
    const gh = fakeGithub({});
    const body = { type: 'kit', company: 'Ostrander', role: 'Principal', url: 'https://x.example/1', pieces: 'resume', postingId: 'key:9' };
    const [s1, b1] = await act(gh, db, body);
    assert.deepEqual([s1, b1.needsConfirm], [409, true]);
    assert.equal(gh.calls.dispatches.length, 0);
    assert.equal((await act(gh, db, { ...body, confirmed: true }))[0], 202);
    assert.equal(gh.calls.dispatches.length, 1);
});

test('kit without a postingId writes nothing, even for a company not on the list', async () => {
    const db = await seededDb();
    const gh = fakeGithub({});
    assert.equal((await act(gh, db, { type: 'kit', company: 'New Co', role: 'Staff', url: 'https://x.example/1', pieces: 'resume' }))[0], 202);
    assert.equal(gh.calls.dispatches[0].inputs.posting_id, undefined);
    assert.equal((await loadAll(db, 'companies')).length, 0);
});

test('undo applies a run change and refuses an old-format report', async () => {
    const db = await seededDb(rec('Ostrander', { reason: 'new' }));
    const gh = fakeGithub(reportFile({ changes: [{ company: 'Ostrander', by: 'claude', fields: { reason: { from: 'old', to: 'new' } } }] }));
    assert.equal((await act(gh, db, { type: 'undo', run: REPORT, company: 'Ostrander' }))[0], 200);
    assert.equal((await stored(db, 'ostrander')).reason, 'old');
    assert.equal((await act(gh, db, { type: 'undo', run: REPORT, company: 'Ostrander' }))[0], 409);
    const old = fakeGithub(reportFile({ changes: [{ company: 'Ostrander', before: {}, after: {} }] }));
    const [status, body] = await act(old, db, { type: 'undo', run: REPORT, company: 'Ostrander' });
    assert.equal(status, 400);
    assert.equal(body.error, "Changes from runs before the redesign can't be undone here.");
    assert.equal((await act(fakeGithub(reportFile({ changes: [] })), db, { type: 'undo', run: REPORT, company: 'Ostrander' }))[0], 404);
});

test('applyProposal goes through the handler; held actions are gone', async () => {
    const db = await seededDb(rec('Ostrander', {
        proposals: [{ id: 'p1', by: 'codex', at: 'd', text: 't', base: { domain: '' }, changes: { domain: 'Landscaping' } }],
    }));
    const gh = fakeGithub({});
    assert.equal((await act(gh, db, { type: 'applyProposal', company: 'Ostrander', id: 'p1' }))[0], 200);
    const r = await stored(db, 'ostrander');
    assert.deepEqual([r.domain, r.proposals], ['Landscaping', []]);
    assert.notEqual((await act(gh, db, { type: 'keepHeld', company: 'Ostrander' }))[0], 200);
});

test('mergeCompany rewrites the target and deletes the source in one write', async () => {
    const db = await seededDb(rec('Quillfeather PBC', { key: 'quillfeatherpbc' }), rec('Quillfeather', { jobs: { 'key:1': { state: 'saved', role: 'R', at: 'd' } } }));
    const gh = fakeGithub({});
    const [s0, b0] = await act(gh, db, { type: 'mergeCompany', from: 'Quillfeather', into: 'Quillfeather PBC' });
    assert.deepEqual([s0, b0.needsConfirm], [409, true]);
    assert.equal((await act(gh, db, { type: 'mergeCompany', from: 'Quillfeather', into: 'Quillfeather PBC', confirmed: true }))[0], 200);
    assert.equal(await stored(db, 'quillfeather'), undefined);
    const t = await stored(db, 'quillfeatherpbc');
    assert.deepEqual([Object.keys(t.jobs), t.aliases], [['key:1'], ['Quillfeather']]);
});

test('mergeCompany with an applied source leaves one active application on the target and deletes the source', async () => {
    const db = await seededDb(rec('Quillfeather PBC', { key: 'quillfeatherpbc' }), rec('Quillfeather', { applications: [{ id: 'a1', role: 'R', leadKey: 'quillfeather::r', appliedOn: 'd', outcome: 'applied' }] }));
    assert.equal((await act(fakeGithub({}), db, { type: 'mergeCompany', from: 'Quillfeather', into: 'Quillfeather PBC', confirmed: true }))[0], 200);
    assert.equal(await stored(db, 'quillfeather'), undefined);
    assert.equal((await stored(db, 'quillfeatherpbc')).applications.filter((a) => a.outcome === 'applied').length, 1);
});

test('keepSeparate records the other key on both companies', async () => {
    const db = await seededDb(rec('Quillfeather'), rec('Quillfeather PBC', { key: 'quillfeatherpbc', possibleDuplicateOf: 'quillfeather' }));
    assert.equal((await act(fakeGithub({}), db, { type: 'keepSeparate', company: 'Quillfeather PBC', other: 'Quillfeather' }))[0], 200);
    const [a, b] = [await stored(db, 'quillfeather'), await stored(db, 'quillfeatherpbc')];
    assert.deepEqual([a.distinctFrom, b.distinctFrom, b.possibleDuplicateOf], [['quillfeatherpbc'], ['quillfeather'], undefined]);
});

test('job actions: saveJob, skipJob, addJob, markApplied, setOutcome, addPostingLink, deleteApplication', async () => {
    const db = await seededDb(rec('Ostrander'));
    const gh = fakeGithub({});
    const job = { company: 'Ostrander', postingId: 'key:1', leadKey: 'ostrander::senior', role: 'Senior Engineer', url: 'https://x.example/1' };
    assert.equal((await act(gh, db, { type: 'skipJob', ...job }))[0], 200);
    assert.equal((await act(gh, db, { type: 'saveJob', ...job }))[0], 200);
    assert.equal((await act(gh, db, { type: 'addJob', company: 'Ostrander', role: 'Staff Engineer', url: 'https://boards.greenhouse.io/g/jobs/5' }))[0], 200);
    assert.equal((await act(gh, db, { type: 'markApplied', company: 'Ostrander', applicationId: 'a1', ...job }))[0], 200);
    assert.equal((await act(gh, db, { type: 'setOutcome', company: 'Ostrander', applicationId: 'a1', outcome: 'passed', reason: 'pay too low' }))[0], 200);
    assert.equal((await act(gh, db, { type: 'addPostingLink', company: 'Ostrander', applicationId: 'a1', url: 'https://boards.greenhouse.io/g/jobs/6' }))[0], 200);
    assert.equal((await act(gh, db, { type: 'deleteApplication', company: 'Ostrander', applicationId: 'a1' }))[0], 409);
    assert.equal((await act(gh, db, { type: 'deleteApplication', company: 'Ostrander', applicationId: 'a1', confirmed: true }))[0], 200);
    const r = await stored(db, 'ostrander');
    assert.deepEqual(Object.keys(r.jobs).sort(), ['greenhouse:5', 'key:1']);
    assert.equal(r.jobs['key:1'].state, 'saved');
    assert.deepEqual(r.applications, []);
    assert.equal(r.events.length, 8); // saveJob also asked for a fill
    assert.equal((await act(gh, db, { type: 'addJob', company: 'Ostrander', role: 'R', url: 'javascript:x' }))[0], 400);
    assert.equal((await act(gh, db, { type: 'addJob', company: 'Ostrander', role: 'x'.repeat(201), url: 'https://x.example/1' }))[0], 400);
});

test('a conflicting write twice is 409 and saves nothing', async () => {
    const db = await seededDb(rec('Ostrander'));
    const real = db.batch.bind(db);
    db.batch = async () => { throw Object.assign(new Error('stale'), { stale: true }); };
    const [status, body] = await act(fakeGithub({}), db, { type: 'setStance', company: 'Ostrander', stance: 'Dormant' });
    assert.equal(status, 409);
    assert.match(body.error, /same moment/);
    db.batch = real;
    assert.equal((await stored(db, 'ostrander')).stance, '');
});

test('run dispatches the tracked workflow', async () => {
    const gh = fakeGithub({});
    await handleAction({ type: 'run', workflow: 'tracked' }, deps(gh));
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'tracked' } }]);
});

test('setLinks through handleAction writes the row', async () => {
    const db = await seededDb(rec('Ostrander'));
    assert.equal((await act(fakeGithub({}), db, { type: 'setLinks', company: 'Ostrander', careersUrl: 'https://g.example/careers', jobsUrl: '' }))[0], 200);
    const r = await stored(db, 'ostrander');
    assert.deepEqual([r.careersUrl, r.jobsUrl], ['https://g.example/careers', '']);
    assert.equal((await act(fakeGithub({}), db, { type: 'setLinks', company: 'Ostrander', careersUrl: 'javascript:x' }))[0], 400);
});

test('run dispatches the links workflow', async () => {
    const gh = fakeGithub({});
    await handleAction({ type: 'run', workflow: 'links' }, deps(gh));
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'links' } }]);
});

test('resolve dispatches resolve-links.yml and refuses a topic', async () => {
    const gh = fakeGithub({});
    const res = await handleAction({ type: 'run', workflow: 'resolve' }, deps(gh));
    assert.equal(res.status, 202);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'resolve-links.yml', inputs: {} }]);
    assert.equal((await handleAction({ type: 'run', workflow: 'resolve', topic: 'x' }, deps(gh))).status, 400);
    assert.equal(gh.calls.dispatches.length, 1);
});

test('searchJob saves the job, then dispatches a job search; bad input and unknown company dispatch nothing', async () => {
    const db = await seededDb(rec('Ostrander'));
    const gh = fakeGithub({});
    const job = { type: 'searchJob', company: 'Ostrander', role: ' Senior Security Engineer ', url: 'https://boards.greenhouse.io/g/jobs/9' };
    assert.equal((await act(gh, db, job))[0], 202);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'search.yml', inputs: { workflow: 'job', job_company: 'Ostrander', job_role: 'Senior Security Engineer', job_url: 'https://boards.greenhouse.io/g/jobs/9' } }]);
    assert.equal((await stored(db, 'ostrander')).jobs['greenhouse:9'].state, 'saved');
    assert.equal((await act(gh, db, { ...job, url: 'javascript:x' }))[0], 400);
    assert.equal((await act(gh, db, { ...job, company: 'Nobody' }))[0], 404);
    assert.equal(gh.calls.dispatches.length, 1);
});

test('searchJob forwards searchers and reviewer', async () => {
    const db = await seededDb(rec('Ostrander'));
    const gh = fakeGithub({});
    const job = { type: 'searchJob', company: 'Ostrander', role: 'Staff', url: 'https://x.example/1', searchers: ['claude'], reviewer: 'none' };
    assert.equal((await act(gh, db, job))[0], 202);
    assert.deepEqual(gh.calls.dispatches[0].inputs, { workflow: 'job', job_company: 'Ostrander', job_role: 'Staff', job_url: 'https://x.example/1', searchers: 'claude', reviewer: 'none' });
});

test('searchJob rejects bad model fields before saving the job', async () => {
    const db = await seededDb(rec('Ostrander'));
    const gh = fakeGithub({});
    const before = await stored(db, 'ostrander');
    const job = { type: 'searchJob', company: 'Ostrander', role: 'Staff', url: 'https://x.example/1', searchers: ['../x'] };
    assert.equal((await act(gh, db, job))[0], 400);
    assert.equal(gh.calls.dispatches.length, 0);
    assert.deepEqual((await stored(db, 'ostrander')).jobs, before.jobs);
});

test('sweep dispatches sweep.yml and refuses a topic', async () => {
    const gh = fakeGithub({});
    assert.equal((await handleAction({ type: 'run', workflow: 'sweep' }, deps(gh))).status, 202);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'sweep.yml', inputs: {} }]);
    assert.equal((await handleAction({ type: 'run', workflow: 'sweep', topic: 'x' }, deps(gh))).status, 400);
    assert.equal(gh.calls.dispatches.length, 1);
});

test('activity lists recent runs of every state', async () => {
    const gh = { listRecentRuns: async () => [{ id: 1, name: 'kit-revise', display_title: 'revise Acme | Staff', status: 'completed', conclusion: 'success', created_at: 'a', run_started_at: 'b', updated_at: 'c', html_url: 'u' }] };
    const body = await (await handleActivity({ gh })).json();
    assert.deepEqual(body.runs, [{ id: 1, workflow: 'kit-revise', title: 'revise Acme | Staff', status: 'completed', conclusion: 'success', createdAt: 'a', startedAt: 'b', updatedAt: 'c', url: 'u' }]);
});

test('activity attaches script-run summaries from finished_runs by GitHub run id', async () => {
    const db = sqliteD1(); applySchema(db);
    await writeRows(db, { finishedRun: { run: 'sweep:2026-11-26T12:00:00Z', at: '2026-11-26T12:00:00Z', result: { ghRun: '7', summary: '3 boards · 1 new roles · 2 touched' } } });
    await writeRows(db, { finishedRun: { run: 'triage:2026-11-26T12:05:00Z', at: '2026-11-26T12:05:00Z', result: { kept: 1, dropped: 0, missing: 0 } } });
    const gh = { listRecentRuns: async () => [{ id: 7, name: 'sweep', status: 'completed' }, { id: 8, name: 'triage', status: 'completed' }] };
    const body = await (await handleActivity({ gh, db })).json();
    assert.equal(body.runs[0].summary, '3 boards · 1 new roles · 2 touched');
    assert.equal(body.runs[1].summary, undefined);
});

test('activity drops successful schedule ticks but keeps failed ones', async () => {
    const run = (id, name, conclusion) => ({ id, name, display_title: 't', status: 'completed', conclusion });
    const gh = { listRecentRuns: async () => [run(1, 'schedule', 'success'), run(2, 'schedule', 'failure'), run(3, 'tune', 'success')] };
    const body = await (await handleActivity({ gh })).json();
    assert.deepEqual(body.runs.map((r) => r.id), [2, 3]);
});

test('addJob records whether the search had seen the job: by id, by company and role, or not at all', async () => {
    const db = await seededDb(rec('Ostrander'));
    await writeRows(db, { postings: [
        { id: 'greenhouse:7', version: null, record: { id: 'greenhouse:7', companyKey: 'ostrander', leadKey: 'ostrander::staffengineer', role: 'Staff Engineer', modelSays: 'pass', filteredBy: 1, source: 'sweep' } },
        { id: 'key:abc', version: null, record: { id: 'key:abc', companyKey: 'ostrander', leadKey: 'ostrander::backendengineer', role: 'Backend Engineer', modelSays: '', source: 'sweep' } },
    ] });
    const gh = fakeGithub({});
    await act(gh, db, { type: 'addJob', company: 'Ostrander', role: 'Staff Engineer', url: 'https://boards.greenhouse.io/g/jobs/7' });
    await act(gh, db, { type: 'addJob', company: 'Ostrander', role: 'Backend Engineer', url: 'https://ostrander.example/careers/backend' });
    await act(gh, db, { type: 'addJob', company: 'Ostrander', role: 'Data Engineer', url: 'https://ostrander.example/careers/data', coverage: 'lead' });
    const jobs = Object.values((await stored(db, 'ostrander')).jobs);
    assert.deepEqual(jobs.map((j) => [j.role, j.coverage]).sort(), [['Backend Engineer', 'unjudged'], ['Data Engineer', 'unseen'], ['Staff Engineer', 'filtered']]);
});

test('stage actions: setStage and setNextStep go through the handler', async () => {
    const db = await seededDb(rec('Ostrander'));
    const gh = fakeGithub({});
    const job = { company: 'Ostrander', postingId: 'key:1', leadKey: 'ostrander::senior', role: 'Senior Engineer', url: 'https://x.example/1' };
    await act(gh, db, { type: 'markApplied', applicationId: 'a1', ...job });
    assert.equal((await act(gh, db, { type: 'setStage', company: 'Ostrander', applicationId: 'a1', stage: 'interviewing' }))[0], 200);
    assert.equal((await act(gh, db, { type: 'setNextStep', company: 'Ostrander', applicationId: 'a1', text: 'Onsite', on: '2026-12-01' }))[0], 200);
    assert.equal((await act(gh, db, { type: 'setStage', company: 'Ostrander', applicationId: 'a1', stage: 'hired' }))[0], 400);
    const a = (await stored(db, 'ostrander')).applications[0];
    assert.deepEqual([a.stage, a.next], ['interviewing', { text: 'Onsite', on: '2026-12-01' }]);
});

test('saveJob starts a fill when culture or fingerprint is missing, once; a failed dispatch keeps the save', async () => {
    const job = { type: 'saveJob', company: 'Ostrander', postingId: 'key:1', leadKey: 'ostrander::senior', role: 'Senior Engineer', url: 'https://x.example/1' };
    const run = (gh, db) => handleAction(job, { ...deps(gh, db), now: () => 'T1' });
    let gh = fakeGithub({}), db = await seededDb(rec('Ostrander', { culture: 'Glassdoor 4.5', fingerprint: 'Unscored — thin evidence' }));
    assert.equal((await run(gh, db)).status, 200);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'fill.yml', inputs: { company: 'Ostrander', at: 'T1' } }]);
    assert.equal((await stored(db, 'ostrander')).fillRequested, 'T1');
    await run(gh, db); // already looking it up: no second run
    assert.equal(gh.calls.dispatches.length, 1);
    gh = fakeGithub({}); db = await seededDb(rec('Ostrander', { culture: 'Glassdoor 4.5', fingerprint: '4/5; strong' }));
    await run(gh, db);
    assert.deepEqual(gh.calls.dispatches, []);
    db = await seededDb(rec('Ostrander'));
    const down = { dispatch: async () => { throw new Error('GitHub down'); } };
    assert.equal((await run(down, db)).status, 200);
    const r = await stored(db, 'ostrander');
    assert.equal(r.jobs['key:1'].state, 'saved');
    assert.equal(r.fillRequested, undefined);
});

test('an action reply carries the rows it wrote, so the page can patch instead of reloading', async () => {
    const db = await seededDb(rec('Ostrander', { stance: 'Watching' }), rec('Other'));
    const [status, body] = await act(fakeGithub({}), db, { type: 'setStance', company: 'Ostrander', stance: 'Dormant' });
    assert.equal(status, 200);
    assert.deepEqual(body.written.map((w) => [w.table, w.id, w.record.stance]), [['companies', 'ostrander', 'Dormant']]);
    const [, merged] = await act(fakeGithub({}), db, { type: 'mergeCompany', from: 'Other', into: 'Ostrander', confirmed: true });
    assert.deepEqual(merged.written.map((w) => [w.id, w.record === null]).sort(), [['ostrander', false], ['other', true]]);
});

test('setModels flips enabled in data/models.json, keeps its layout, and refuses turning every model off', async () => {
    const file = '{\n  "models": [\n    { "id": "claude", "label": "Claude", "runner": "claude" },\n    { "id": "codex", "label": "Codex", "runner": "codex" }\n  ],\n  "defaults": {\n    "ask": { "model": "both" }\n  }\n}\n';
    const gh = { ...fakeGithub({ 'data/models.json': file }), async putFile(path, text, sha) { this.put = { path, text, sha }; } };
    const [status] = await act(gh, null, { type: 'setModels', enabled: { codex: false } });
    assert.equal(status, 200);
    assert.equal(gh.put.sha, 's0');
    assert.equal(gh.put.text, file.replace('"runner": "codex" }', '"runner": "codex", "enabled": false }'));
    assert.equal((await act(gh, null, { type: 'setModels', enabled: { claude: false, codex: false } }))[0], 400);
    assert.equal((await act(gh, null, { type: 'setModels', enabled: { codex: 'no' } }))[0], 400);
});

const app = { id: 'a1', role: 'Senior Engineer', appliedOn: '2026-11-10', outcome: 'applied', stage: 'screening', stageOn: '2026-11-15', sendTo: 'Dana', next: { text: 'Wait for reply' } };

test('followup dispatches followup.yml with inputs built from the application', async () => {
    const db = await seededDb(rec('Ostrander', { applications: [app] }));
    const gh = fakeGithub({});
    const res = await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'a1', note: 'mention the demo', role: 'IGNORED' });
    assert.equal(res[0], 202);
    assert.deepEqual(gh.calls.dispatches, [{ workflow: 'followup.yml', inputs: { company: 'Ostrander', role: 'Senior Engineer', application_id: 'a1', stage: 'screening', applied_on: '2026-11-10', stage_on: '2026-11-15', send_to: 'Dana', next: 'Wait for reply', note: 'mention the demo' } }]);
});

test('followup defaults the stage and refuses a closed or missing application', async () => {
    const db = await seededDb(rec('Ostrander', { applications: [{ id: 'a1', role: 'R', appliedOn: '2026-11-10', outcome: 'applied' }, { ...app, id: 'a2', outcome: 'rejected' },
        { id: 'a3', role: '—', appliedOn: '2026-11-10', outcome: 'applied' }, { id: 'a4', role: 'R', outcome: 'applied' }] }));
    const gh = fakeGithub({});
    await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'a1' });
    assert.deepEqual(gh.calls.dispatches[0].inputs, { company: 'Ostrander', role: 'R', application_id: 'a1', stage: 'applied', applied_on: '2026-11-10' });
    assert.equal((await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'a2' }))[0], 400);
    assert.equal((await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'zz' }))[0], 404);
    assert.equal((await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'a1', note: 'x'.repeat(2001) }))[0], 400);
    assert.equal((await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'a3' }))[0], 400);
    assert.equal((await act(gh, db, { type: 'followup', company: 'Ostrander', applicationId: 'a4' }))[0], 400);
    assert.equal(gh.calls.dispatches.length, 1);
});

test('setSendTo goes through the handler', async () => {
    const db = await seededDb(rec('Ostrander', { applications: [app] }));
    assert.equal((await act(fakeGithub({}), db, { type: 'setSendTo', company: 'Ostrander', applicationId: 'a1', sendTo: 'Pat' }))[0], 200);
    assert.equal((await stored(db, 'ostrander')).applications[0].sendTo, 'Pat');
});

test('kit refuses to replace a kit folder unless the rerun says so, and never for another posting', async () => {
    const db = await seededDb(rec('Cartwheel Engine'));
    const gh = fakeGithub({ 'applications/cartwheelengine-staff/meta.json': JSON.stringify({ company: 'Cartwheel Engine', role: 'Staff', postingId: 'p1' }) });
    const body = { type: 'kit', company: 'Cartwheel Engine', role: 'Staff', url: 'https://x.example/1', pieces: 'resume', postingId: 'p1' };
    const first = await handleAction(body, deps(gh, db));
    assert.equal(first.status, 409);
    assert.match((await first.json()).error, /already has a kit/);
    const other = await handleAction({ ...body, postingId: 'p2', replace: true }, deps(gh, db));
    assert.equal(other.status, 409);
    assert.match((await other.json()).error, /another posting/);
    assert.equal(gh.calls.dispatches.length, 0);
    assert.equal((await stored(db, 'cartwheelengine')).jobs?.p2, undefined);
    assert.equal((await handleAction({ ...body, replace: true }, deps(gh, db))).status, 202);
});

test('token reports the status and turns the expiry header into ISO time', async () => {
    const res = (status, headers = {}) => async () => new Response('{}', { status, headers });
    const gh = (status, headers) => makeGithub({ token: 't', repo: 'a/b', fetchImpl: res(status, headers) });
    assert.deepEqual(await (await handleToken({ gh: gh(200, { 'github-authentication-token-expiration': '2026-12-31 23:59:59 UTC' }) })).json(), { status: 200, expires: '2026-12-31T23:59:59.000Z' });
    assert.deepEqual(await (await handleToken({ gh: gh(401) })).json(), { status: 401, expires: null });
});
