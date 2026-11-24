import { companyKey, leadKey, sameCompany } from '../../lib/keys.js';
import * as O from '../../lib/ownerActions.js';
import { updateCompanies } from './companiesWrite.js';
import { currentSeq, deltaJson, historyLines, jsonLines, loadAll, loadSome, writeRows } from '../../lib/store.js';
import { companyOf } from '../../lib/tags.js';
import { newEntry, factsBlock } from '../../lib/supplement.js';
import { blankCompany, needsCultureFill } from '../../lib/companies.js';
import { threadPath } from '../../lib/ask.js';
import { postingId } from '../../lib/postingId.js';
import { CHAIN_BATCHES } from '../../lib/chain.js';
import { registryText, setEnabled } from '../../lib/modelsText.js';

const WORKFLOWS = ['daily', 'tracked', 'links', 'culture', 'vertical', 'reconcile', 'directed'];
// The board resolver is a script workflow with no run folder, so it stays out of RUN_RE.
const RESOLVE = 'resolve';
const SWEEP = 'sweep';
const TUNE = 'tune';
const TRIAGE = 'triage';
const RESCORE = 'rescore';
const FIND_BOARDS = 'find-boards';
const RUN_RE = /^\d{4}-\d{2}-\d{2}-(daily|tracked|links|culture|vertical|reconcile|job|directed)(-\d{4,6})?$/;
const PIECES_RE = /^(resume|cover-letter|answers)(,(resume|cover-letter|answers))*$/;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bad = (msg) => json(400, { error: msg });
const str = (v, max = 500) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const opt = (v, max) => v == null || v === '' || str(v, max);

export function isAllowedPath(path) {
    // %, ? and # would let an encoded `..` or a query reach the GitHub API URL.
    if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\%?#]/.test(path)) return false;
    if (path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
    return ['data/unfiled-history.jsonl', 'data/verticals.json', 'data/models.json', 'data/master-sections.json', 'data/reasons.json', 'data/profile.json', 'data/schedule.json', 'master-resume.md', 'applications', 'followups'].includes(path) || path.startsWith('runs/') || path.startsWith('applications/') || path.startsWith('followups/');
}

export async function handleData(path, { gh, when }) {
    if (!isAllowedPath(path)) return json(403, { error: 'path not allowed' });
    try {
        if (when) return json(200, { at: await gh.lastCommitAt(path) });
        const res = await gh.getRaw(path);
        // Files under runs/ are model-written; never let one render as an active page on this origin.
        return new Response(res.body, { headers: {
            'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "sandbox; default-src 'none'",
        } });
    } catch (e) {
        return json(e.status === 404 ? 404 : 502, { error: e.message });
    }
}

const NDJSON = 'application/x-ndjson';

async function ndjson(read) {
    try {
        const { text, next } = await read();
        return new Response(text, { headers: { 'content-type': NDJSON, ...(next == null ? {} : { 'x-next-after': String(next) }) } });
    } catch (e) {
        return json(502, { error: e.message });
    }
}

// Companies and postings: `since` (a seq the page has) answers with only what changed after it (deltaJson). A full load's
// first page carries `x-seq`, read before any row, for the page's next `since`.
const seqTable = (table) => async ({ db, after = '', since = null }) => {
    if (since != null) {
        if (!/^\d{1,15}$/.test(since)) return json(400, { error: 'bad since' });
        try { return new Response(await deltaJson(db, table, Number(since)), { headers: { 'content-type': 'application/json' } }); }
        catch (e) { return json(502, { error: e.message }); }
    }
    const seq = after ? null : await currentSeq(db).catch(() => null);
    const res = await ndjson(() => jsonLines(db, table, { after }));
    if (seq != null && res.ok) res.headers.set('x-seq', String(seq));
    return res;
};
export const handleCompanies = seqTable('companies');
export const handlePostings = seqTable('postings');
export const handleSupplement = ({ db, after }) => ndjson(() => jsonLines(db, 'supplement', { after }));
export const handleTune = ({ db, after }) => ndjson(() => jsonLines(db, 'tune', { after }));
export const handleHistory = ({ db, company }) => ndjson(async () => ({ text: await historyLines(db, company) }));

// Same-origin JSON only: a cross-site form can't set this content type without a preflight.
export function checkActionRequest(request) {
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json(415, { error: 'JSON only' });
    if (request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'cross-origin request' });
    return null;
}

// What's running now, so the page can show progress between finished runs.
export async function handleStatus({ gh }) {
    try {
        const runs = await Promise.all((await gh.listActiveRuns()).map(async (r) => ({
            workflow: r.name,
            title: r.display_title,
            status: r.status,
            startedAt: r.run_started_at,
            step: (await gh.listJobs(r.id)).find((j) => j.status === 'in_progress')?.name ?? null,
            url: r.html_url,
        })));
        return json(200, { runs });
    } catch (e) {
        return json(502, { error: e.message });
    }
}

// The page's GitHub token: { status, expires } with expires as ISO time or null. The page warns on 401/403/404 and near expiry.
export async function handleToken({ gh }) {
    try {
        const { status, expires } = await gh.tokenStatus();
        const iso = expires ? new Date(expires.replace(' UTC', 'Z').replace(' ', 'T')) : null;
        return json(200, { status, expires: iso && !Number.isNaN(+iso) ? iso.toISOString() : null });
    } catch (e) {
        return json(502, { error: e.message });
    }
}

// The status page: recent runs with their state. No per-run job lookups (free-plan subrequest limit).
export async function handleActivity({ gh }) {
    try {
        const runs = (await gh.listRecentRuns())
            // The hourly tick runs 24 times a day; only its failures matter, and the rest would push real runs out of the window.
            .filter((r) => !(r.name === 'schedule' && r.conclusion === 'success'))
            .map((r) => ({
            id: r.id, workflow: r.name, title: r.display_title, status: r.status, conclusion: r.conclusion,
            createdAt: r.created_at, startedAt: r.run_started_at, updatedAt: r.updated_at, url: r.html_url,
        }));
        return json(200, { runs });
    } catch (e) {
        return json(502, { error: e.message });
    }
}

export async function handleThread(company, { gh }) {
    if (!str(company, 120)) return bad('bad company');
    try {
        return json(200, JSON.parse((await gh.getFile(threadPath(company))).text));
    } catch (e) {
        return e.status === 404 ? json(200, { company, messages: [] }) : json(502, { error: e.message });
    }
}

const NO_COMPANY = 'No company with that name.';
const defaultNow = () => new Date().toISOString();
const defaultToday = () => new Date().toISOString().slice(0, 10);
const ok = () => json(200, { ok: true });
const readReport = async (gh, run) => JSON.parse((await gh.getFile(`runs/${run}/report.json`)).text);

// One owner action on one company: the pure function mutates the record, updateCompanies writes it.
// What the owner has supplied beyond the master, as one prompt block that fits in `budget` characters of dispatch input.
const supplementInput = async (db, budget = 20000) => (budget > 200 ? factsBlock((await loadAll(db, 'supplement')).map((r) => r.record), budget) : '');

// Reads one supplement row, applies `fn` to a copy, writes it back at the version read. A moved row is a 409.
async function changeTune(db, id, fn) {
    const row = (await loadSome(db, 'tune', [id])).get(id);
    if (!row) throw O.fail(404, 'No such proposal.');
    const record = structuredClone(row.record);
    fn(record);
    await writeRows(db, { tune: [{ id, version: row.version, record }] });
}

async function changeSupplement(db, id, fn) {
    const row = (await loadSome(db, 'supplement', [id])).get(id);
    if (!row) throw O.fail(404, 'No such fact.');
    const record = structuredClone(row.record);
    fn(record);
    await writeRows(db, { supplement: [{ id, version: row.version, record }] });
}

// What the search knew about a job the owner is adding by hand: its posting row by id, or by company and role.
// ponytail: a posting pruned after a month off its board reads as unseen; add a seen-ids table if the count says that matters.
async function coverageOf(db, b) {
    const role = String(b.role ?? '').trim();
    const id = postingId({ url: b.url, company: b.company, role });
    const row = await db.prepare("SELECT data FROM postings WHERE id = ?1 OR (json_extract(data, '$.companyKey') = ?2 AND json_extract(data, '$.leadKey') = ?3) LIMIT 1")
        .bind(id, companyKey(b.company), leadKey(b.company, role)).first();
    const p = row && JSON.parse(row.data);
    if (!p || ['owner', 'application', 'migration'].includes(p.source)) return 'unseen';
    if (p.filteredBy != null || p.triage?.keep === false) return 'filtered';
    if (p.modelSays === '') return 'unjudged';
    return p.modelSays === 'lead' ? 'lead' : 'passed';
}
const addJob = async (b, deps) => onCompany(O.addJob)({ ...b, coverage: str(b.url, 500) && str(b.role, 160) ? await coverageOf(deps.db, b) : undefined }, deps);

const onCompany = (fn) => async (b, { db, today = defaultToday }) => {
    if (!str(b.company, 120)) return bad('bad company');
    const key = companyKey(b.company);
    await updateCompanies(db, [key], (recs) => {
        if (!recs[key]) throw O.fail(404, NO_COMPANY);
        fn(recs[key], { ...b, confirmed: b.confirmed === true, today: today() });
    });
    return ok();
};

// Shape only; the trusted setup step checks the ids against the registry.
const checkModels = (b) => {
    if (b.searchers != null && (!Array.isArray(b.searchers) || b.searchers.length < 1 || b.searchers.length > 2 || !b.searchers.every(isId))) return bad('bad searchers');
    if (b.reviewer != null && !isId(b.reviewer)) return bad('bad reviewer');
};
const modelInputs = (b) => ({ ...(b.searchers && { searchers: b.searchers.join(',') }), ...(b.reviewer && { reviewer: b.reviewer }) });

const actions = {
    async run(b, { gh }) {
        if (b.workflow !== RESOLVE && b.workflow !== SWEEP && b.workflow !== TUNE && b.workflow !== TRIAGE && b.workflow !== RESCORE && b.workflow !== FIND_BOARDS && !WORKFLOWS.includes(b.workflow)) return bad('unknown workflow');
        // A topic names the verticals for a vertical sweep, or is the owner's direction for a directed search (required there).
        if (b.workflow === 'directed' && !str(b.topic, 2000)) return bad('a directed search needs a direction');
        if (b.topic != null && b.topic !== '' && b.workflow !== 'directed' && (b.workflow !== 'vertical' || !str(b.topic, 600))) return bad('bad topic');
        const badModels = checkModels(b);
        if (badModels) return badModels;
        // How many unjudged roles a tracked run judges; chain starts follow-up batches (10 at most) until none are left.
        if ((b.sweepRoles != null || b.chain != null) && b.workflow !== 'tracked') return bad('sweepRoles only fits a tracked run');
        if (b.sweepRoles != null && !(Number.isInteger(b.sweepRoles) && b.sweepRoles >= 1 && b.sweepRoles <= 30)) return bad('bad sweepRoles');
        if (b.workflow === SWEEP) { await gh.dispatch('sweep.yml', {}); return json(202, { ok: true }); }
        if (b.workflow === TUNE) { await gh.dispatch('tune.yml', {}); return json(202, { ok: true }); }
        if (b.workflow === RESCORE) { await gh.dispatch('rescore.yml', {}); return json(202, { ok: true }); }
        if (b.workflow === FIND_BOARDS) { await gh.dispatch('find-boards.yml', {}); return json(202, { ok: true }); }
        if (b.workflow === TRIAGE) { await gh.dispatch('triage.yml', {}); return json(202, { ok: true }); }
        if (b.workflow === RESOLVE) { await gh.dispatch('resolve-links.yml', {}); return json(202, { ok: true }); }
        await gh.dispatch('search.yml', { workflow: b.workflow, ...(b.topic && { topic: b.topic.trim() }), ...(b.sweepRoles && { sweep_roles: String(b.sweepRoles) }), ...(b.chain === true && { chain: String(CHAIN_BATCHES - 1) }), ...modelInputs(b) });
        return json(202, { ok: true });
    },
    // One posting, searched by both models like a found lead. Saved first so it shows on Jobs even if the run fails.
    async searchJob(b, { gh, db, today = defaultToday }) {
        if (!str(b.company, 120) || !str(b.role, 160) || !str(b.url, 500)) return bad('bad job fields');
        const badModels = checkModels(b);
        if (badModels) return badModels;
        const res = await addJob(b, { db, today });
        if (res.status !== 200) return res;
        await gh.dispatch('search.yml', { workflow: 'job', job_company: b.company.trim(), job_role: b.role.trim(), job_url: b.url.trim(), ...modelInputs(b) });
        return json(202, { ok: true });
    },
    // Starts the review of a job that is already saved. Unlike searchJob it writes nothing, so a skipped job stays skipped.
    async reviewJob(b, { gh }) {
        if (!str(b.company, 120) || !str(b.role, 160) || !str(b.url, 500)) return bad('bad job fields');
        const badModels = checkModels(b);
        if (badModels) return badModels;
        await gh.dispatch('search.yml', { workflow: 'job', job_company: b.company.trim(), job_role: b.role.trim(), job_url: b.url.trim(), ...modelInputs(b) });
        return json(202, { ok: true });
    },
    async kit(b, { gh, db, today = defaultToday }) {
        if (!str(b.company, 120) || !str(b.role, 160) || !opt(b.url, 500) || !opt(b.posting_text, 60000) || !opt(b.note, 2000)) return bad('bad kit fields');
        if (!PIECES_RE.test(b.pieces ?? '')) return bad('bad pieces');
        if (b.drafter && !['claude', 'codex'].includes(b.drafter)) return bad('bad drafter');
        if (!b.url && !b.posting_text) return bad('need a url or posting text');
        if (b.postingId != null && !str(b.postingId, 200)) return bad('bad posting id');
        if (b.applying != null && typeof b.applying !== 'boolean') return bad('bad applying');
        if (b.replace != null && typeof b.replace !== 'boolean') return bad('bad replace');
        const key = companyKey(b.company);
        // kit.yml replaces the whole folder (bin/kit-dir.js names it by company and role). Only a rerun from the kit's own page
        // (`replace`) may do that, and never for another posting with the same title.
        const slug = b.role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const meta = await gh.getFile(`applications/${key}-${slug}/meta.json`).then((f) => JSON.parse(f.text), (e) => { if (e.status === 404) return null; throw e; });
        if (meta) {
            const other = meta.postingId && b.postingId && meta.postingId !== b.postingId;
            if (other) return json(409, { error: `${b.role} at ${b.company} already has a kit for another posting with the same title. Open it from Kits.` });
            if (b.replace !== true) return json(409, { error: `${b.role} at ${b.company} already has a kit. Open it from Kits; rerun it there to replace it.` });
        }
        // Saved before the dispatch, so a failed kit run leaves the job Saved and a retry records nothing twice.
        await updateCompanies(db, [key], (recs) => {
            const c = recs[key];
            if (!c) {
                if (b.postingId) throw O.fail(404, NO_COMPANY);
                return null;
            }
            O.guardSecondApplication(c, b.confirmed === true);
            if (!b.postingId) return null;
            // A kit started from the Kits page sends no `applying`; it must not demote an applying job.
            if (b.applying !== true && c.jobs?.[b.postingId]?.state === 'applying') return;
            (b.applying === true ? O.applyJob : O.saveJob)(c, { postingId: b.postingId, leadKey: leadKey(b.company, b.role), role: b.role, url: b.url, today: today(), kitStartedAt: new Date().toISOString() });
        });
        const inputs = { company: b.company, role: b.role, pieces: b.pieces, drafter: b.drafter ?? 'claude' };
        for (const k of ['url', 'posting_text', 'note']) if (b[k]) inputs[k] = b[k];
        if (b.postingId) inputs.posting_id = b.postingId;
        // One dispatch carries at most 65,535 characters in all, and the posting text can be most of it.
        const facts = await supplementInput(db, Math.min(20000, 60000 - (b.posting_text?.length ?? 0) - (b.note?.length ?? 0)));
        if (facts) inputs.supplement = facts;
        await gh.dispatch('kit.yml', inputs);
        return json(202, { ok: true });
    },
    async kitReview(b, { gh, db }) {
        if (!str(b.company, 120) || !str(b.role, 160) || !opt(b.note, 2000)) return bad('bad review fields');
        if (!['claude', 'codex', 'both'].includes(b.reviewers)) return bad('bad reviewers');
        const facts = await supplementInput(db);
        await gh.dispatch('kit-review.yml', { company: b.company, role: b.role, reviewers: b.reviewers, ...(b.note && { note: b.note }), ...(facts && { supplement: facts }) });
        return json(202, { ok: true });
    },
    // Writes a cover letter or form answers for a kit that already has a resume. Leaves everything else in the kit alone.
    async kitAdd(b, { gh, db }) {
        if (!str(b.company, 120) || !str(b.role, 160) || !opt(b.note, 2000)) return bad('bad piece fields');
        if (!/^(cover-letter|answers)(,(cover-letter|answers))?$/.test(b.pieces ?? '')) return bad('bad pieces');
        if (!['claude', 'codex'].includes(b.drafter)) return bad('bad drafter');
        const facts = await supplementInput(db);
        await gh.dispatch('kit-add.yml', { company: b.company, role: b.role, pieces: b.pieces, drafter: b.drafter, ...(b.note && { note: b.note }), ...(facts && { supplement: facts }) });
        return json(202, { ok: true });
    },
    // Drafts a follow-up email for an open application. Every input but the note comes from the stored application.
    async followup(b, { gh, db }) {
        if (!str(b.company, 120) || !str(b.applicationId, 60) || !opt(b.note, 2000)) return bad('bad follow-up fields');
        const key = companyKey(b.company);
        const c = (await loadSome(db, 'companies', [key])).get(key)?.record;
        const a = c?.applications?.find((x) => x.id === b.applicationId);
        if (!a) return json(404, { error: 'No such application.' });
        if (a.outcome !== 'applied') return bad('That application is not open.');
        if (!a.appliedOn || !/[a-z0-9]/i.test(a.role ?? '')) return bad('That application needs an applied date and a role to draft a follow-up.');
        await gh.dispatch('followup.yml', { company: c.name, role: a.role, application_id: a.id, stage: a.stage || 'applied', applied_on: a.appliedOn,
            ...(a.stageOn && { stage_on: a.stageOn }), ...(a.sendTo && { send_to: a.sendTo }), ...(a.next?.text && { next: a.next.text }), ...(b.note && { note: b.note }) });
        return json(202, { ok: true });
    },
    async kitRevise(b, { gh, db }) {
        if (!str(b.company, 120) || !str(b.role, 160) || !opt(b.note, 2000)) return bad('bad revise fields');
        if (!['claude', 'codex'].includes(b.reviser)) return bad('bad reviser');
        const facts = await supplementInput(db);
        await gh.dispatch('kit-revise.yml', { company: b.company, role: b.role, reviser: b.reviser, ...(b.note && { note: b.note }), ...(facts && { supplement: facts }) });
        return json(202, { ok: true });
    },
    // Taken-down notices can span companies: one write, one batch. `seen` is [{ company, postingId, goneAt }].
    async markSeen(b, { db, today = defaultToday }) {
        if (!Array.isArray(b.seen) || !b.seen.length || b.seen.length > 500
            || !b.seen.every((s) => str(s?.company, 120) && str(s.postingId, 200) && opt(s.goneAt, 40))) return bad('bad seen fields');
        const byKey = new Map();
        for (const s of b.seen) {
            const g = byKey.get(companyKey(s.company)) ?? { postingIds: [], goneAtById: {} };
            g.postingIds.push(s.postingId);
            if (s.goneAt) g.goneAtById[s.postingId] = s.goneAt;
            byKey.set(companyKey(s.company), g);
        }
        await updateCompanies(db, [...byKey.keys()], (recs) => {
            for (const [key, g] of byKey) {
                if (!recs[key]) throw O.fail(404, NO_COMPANY);
                O.markSeen(recs[key], { ...g, today: today() });
            }
        });
        return ok();
    },
    // Passed page: `read` is [{ company, jobs?: [{ postingId, leadKey, role, url }], verdict? }], any number of companies, one batch.
    async markPassedRead(b, { db, today = defaultToday }) {
        if (!Array.isArray(b.read) || !b.read.length || b.read.length > 500 || !b.read.every((r) => str(r?.company, 120))) return bad('bad read fields');
        const byKey = new Map(b.read.map((r) => [companyKey(r.company), r]));
        await updateCompanies(db, [...byKey.keys()], (recs) => {
            for (const [key, r] of byKey) {
                if (!recs[key]) throw O.fail(404, NO_COMPANY);
                O.markPassedRead(recs[key], { jobs: r.jobs, verdict: r.verdict === true, today: today() });
            }
        });
        return ok();
    },
    // Rewrites the target and deletes the source in the same batch.
    async mergeCompany(b, { db, today = defaultToday }) {
        if (!str(b.from, 120) || !str(b.into, 120)) return bad('bad merge fields');
        const [from, into] = [companyKey(b.from), companyKey(b.into)];
        if (from === into) return bad('those are the same company');
        if (b.confirmed !== true) throw O.confirmNeeded(`Merge ${b.from} into ${b.into}? This can't be undone.`);
        await updateCompanies(db, [from, into], (recs) => {
            if (!recs[from] || !recs[into]) throw O.fail(404, NO_COMPANY);
            O.mergeInto(recs[into], recs[from], { today: today() });
            recs[from] = null;
        });
        return ok();
    },
    // `other` is the possible duplicate's key; both companies remember the pair is distinct.
    async keepSeparate(b, { db, today = defaultToday }) {
        if (!str(b.company, 120) || !str(b.other, 120)) return bad('bad fields');
        const [key, other] = [companyKey(b.company), companyKey(b.other)];
        if (key === other) return bad('those are the same company');
        await updateCompanies(db, [key, other], (recs) => {
            if (!recs[key]) throw O.fail(404, NO_COMPANY);
            O.keepSeparate(recs[key], { otherKey: other, today: today() });
            if (recs[other]) O.keepSeparate(recs[other], { otherKey: key, today: today() });
        });
        return ok();
    },
    // New company at Watching, then the usual Fill facts run.
    async addCompany(b, { gh, db, today = defaultToday, now = defaultNow }) {
        if (!str(b.company, 120)) return bad('bad company');
        if (!opt(b.careersUrl, 500) || !opt(b.jobsUrl, 500)) return bad('bad links');
        const name = b.company.trim();
        const key = companyKey(name);
        if (!key) return bad('bad company');
        const at = now();
        await updateCompanies(db, [key], (recs) => {
            if (recs[key]) throw O.fail(409, `${recs[key].name} is already tracked.`);
            recs[key] = { ...blankCompany(name), stance: 'Watching', events: [{ date: today(), text: 'Added by hand at Watching' }] };
            if (b.careersUrl || b.jobsUrl) O.setLinks(recs[key], { careersUrl: b.careersUrl, jobsUrl: b.jobsUrl, today: today() });
            O.requestFill(recs[key], { at, today: today() });
        });
        await gh.dispatch('fill.yml', { company: name, at });
        return json(202, { ok: true });
    },
    // Facts the owner supplies outside the master. Kits use them until they are merged or dismissed (lib/supplement.js).
    async addSupplement(b, { db, now = defaultNow }) {
        if (!str(b.text, 1500) || !opt(b.question, 400) || !opt(b.kit, 200)) return bad('bad fact fields');
        const id = crypto.randomUUID();
        await writeRows(db, { supplement: [{ id, version: null, record: newEntry({ id, text: b.text, question: b.question, kit: b.kit, at: now() }) }] });
        return json(200, { ok: true });
    },
    async editSupplement(b, { db }) {
        if (!str(b.id, 80) || !str(b.text, 1500)) return bad('bad fact fields');
        await changeSupplement(db, b.id, (e) => { if (e.status !== 'open') throw O.fail(409, 'That fact is already being merged or is done.'); e.text = b.text.trim(); });
        return json(200, { ok: true });
    },
    async dismissSupplement(b, { db }) {
        if (!str(b.id, 80)) return bad('bad id');
        await changeSupplement(db, b.id, (e) => { if (e.status === 'merged') throw O.fail(409, 'That fact is already in the master.'); e.status = 'dismissed'; });
        return json(200, { ok: true });
    },
    // The owner picks the heading. A trusted job adds the line to master-resume.md and marks the fact merged.
    async mergeSupplement(b, { db, gh }) {
        if (!str(b.id, 80) || !str(b.section, 200) || !opt(b.text, 1500)) return bad('bad merge fields');
        await changeSupplement(db, b.id, (e) => {
            if (e.status !== 'open' && e.status !== 'merging') throw O.fail(409, 'That fact is already done.');
            if (b.text) e.text = b.text.trim();
            delete e.error;
            e.status = 'merging';
            e.section = b.section;
        });
        await gh.dispatch('merge-master.yml', { id: b.id });
        return json(202, { ok: true });
    },
    // A tune proposal: Apply hands it to tune-apply.yml (which refuses it if the file changed), Dismiss drops it.
    async applyTune(b, { db, gh }) {
        if (!str(b.id, 80) || !/^tune:/.test(b.id)) return bad('bad proposal id');
        if (b.confirmed !== true) throw O.confirmNeeded('Change the search rules with this edit? It is committed to the repo.');
        await changeTune(db, b.id, (p) => {
            if (p.status !== 'open') throw O.fail(409, 'That proposal is already done.');
            p.status = 'applying';
        });
        await gh.dispatch('tune-apply.yml', { id: b.id });
        return json(202, { ok: true });
    },
    async dismissTune(b, { db }) {
        if (!str(b.id, 80)) return bad('bad proposal id');
        await changeTune(db, b.id, (p) => { p.status = 'dismissed'; });
        return ok();
    },
    // The one page action that also writes a posting row: the link lives there and in the job entry. One batch, one retry.
    async setPostingUrl(b, { db, today = defaultToday }) {
        if (!str(b.company, 120) || !str(b.postingId, 200) || !str(b.url, 500)) return bad('bad link fields');
        const key = companyKey(b.company);
        for (let attempt = 0; ; attempt++) {
            const [cs, ps] = await Promise.all([loadSome(db, 'companies', [key]), loadSome(db, 'postings', [b.postingId])]);
            const crow = cs.get(key);
            if (!crow) throw O.fail(404, NO_COMPANY);
            const prow = ps.get(b.postingId);
            const c = structuredClone(crow.record);
            const p = prow && companyOf([crow.record], prow.record) ? structuredClone(prow.record) : undefined;
            O.setPostingUrl(c, p, { postingId: b.postingId, url: b.url, today: today() });
            if (JSON.stringify(c) === JSON.stringify(crow.record)) return ok();
            try {
                await writeRows(db, { companies: [{ id: key, version: crow.version, record: c }], ...(p && { postings: [{ id: b.postingId, version: prow.version, record: p }] }) });
                return ok();
            } catch (e) {
                if (!e.stale) throw e;
                if (attempt >= 1) throw Object.assign(new Error('Someone else changed the data at the same moment. Nothing was saved. Try again.'), { status: 409 });
            }
        }
    },
    async recheck(_b, { gh }) {
        await gh.dispatch('check-postings.yml', {});
        return json(202, { ok: true });
    },
    // Saves the job, then looks the company up when its culture or fingerprint is missing. The save stands even if the
    // lookup can't start: the mark is taken back so the page doesn't show "Looking up facts" forever.
    async saveJob(b, { gh, db, today = defaultToday, now = defaultNow }) {
        const saved = await onCompany(O.saveJob)(b, { db, today });
        if (saved.status !== 200) return saved;
        const key = companyKey(b.company), at = now();
        let fill = false;
        await updateCompanies(db, [key], (recs) => {
            if (!recs[key] || !needsCultureFill(recs[key])) return null;
            O.requestFill(recs[key], { at, today: today() });
            fill = true;
        });
        if (!fill) return saved;
        try {
            await gh.dispatch('fill.yml', { company: b.company, at });
        } catch {
            await updateCompanies(db, [key], (recs) => {
                if (recs[key]?.fillRequested !== at) return null;
                delete recs[key].fillRequested;
            });
        }
        return saved;
    },
    async fillFacts(b, { gh, db, today = defaultToday, now = defaultNow }) {
        if (!str(b.company, 120)) return bad('bad company');
        if (b.model != null && !isId(b.model)) return bad('bad model');
        // `at` names the run in D1, so a redo after a failed push matches the first try.
        const at = now();
        await onCompany(O.requestFill)({ ...b, at }, { db, today });
        await gh.dispatch('fill.yml', { company: b.company, at, ...(b.model && { model: b.model }) });
        return json(202, { ok: true });
    },
    // The Models dialog: turns registry models on or off with one commit to data/models.json. The sha makes a moved file fail.
    async setModels(b, { gh }) {
        const e = b.enabled;
        if (!e || typeof e !== 'object' || Array.isArray(e) || !Object.keys(e).length || !Object.entries(e).every(([k, v]) => isId(k) && typeof v === 'boolean')) return bad('bad models');
        const { text, sha } = await gh.getFile('data/models.json');
        const next = setEnabled(JSON.parse(text), e);
        if (!next.models.some((m) => m.enabled !== false && !m.missing)) return bad('Keep at least one model on.');
        const off = Object.keys(e).filter((k) => !e[k]);
        await gh.putFile('data/models.json', registryText(next), sha, `models: ${off.length ? `off ${off.join(', ')}` : 'turned on'} (page)`);
        return json(200, { ok: true });
    },
    async ask(b, { gh, now = defaultNow }) {
        if (!str(b.company, 120) || !(b.model === 'both' || isId(b.model)) || !str(b.question, 4000)) return bad('bad ask fields');
        await gh.dispatch('ask.yml', { company: b.company, model: b.model, question: b.question, at: now() });
        return json(202, { ok: true });
    },
    async undo(b, { gh, db, today = defaultToday }) {
        if (!RUN_RE.test(b.run ?? '') || !str(b.company, 120)) return bad('bad undo fields');
        // A run can log a company twice (its patch and the facts a find filled in): undo both.
        const found = ((await readReport(gh, b.run)).changes ?? []).filter((c) => sameCompany(c.company, b.company));
        if (!found.length) return json(404, { error: 'no such change' });
        if (found.some((c) => !c.fields)) return bad("Changes from runs before the redesign can't be undone here.");
        const fields = Object.assign({}, ...found.map((c) => c.fields));
        return onCompany((c, args) => O.undoChange(c, { ...args, fields }))(b, { db, today });
    },
};

for (const name of ['setStance', 'setLinks', 'setCulture', 'setNote', 'setFlag', 'setSweep', 'skipJob', 'markApplied', 'setOutcome', 'setStage', 'setNextStep', 'setSendTo', 'deleteApplication', 'addPostingLink',
    'keepCompany', 'applyProposal', 'dismissProposal']) actions[name] = onCompany(O[name]);
actions.addJob = addJob;

export async function handleAction(body, deps) {
    const fn = Object.hasOwn(actions, body?.type ?? '') ? actions[body.type] : null;
    if (!fn) return bad('unknown action');
    // Every write goes through `db`, which notes the company and posting rows it wrote. The reply carries them
    // so the page patches its lists instead of reloading both whole tables (~2,500 D1 reads an action).
    const written = [];
    const db = deps.db && { prepare: (q) => deps.db.prepare(q), batch: (s) => deps.db.batch(s), written };
    try {
        const res = await fn(body, { ...deps, db });
        if (!res.ok || !written.length) return res;
        return json(res.status, { ...(await res.json()), written });
    } catch (e) {
        return json(e.status === 409 || e.expected ? e.status : 502, { error: e.message, ...(e.needsConfirm && { needsConfirm: true }) });
    }
}
