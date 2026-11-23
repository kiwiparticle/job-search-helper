// Is each posting still up? Pure of node: imports; fetch and DNS lookup are injected.
import { boardId, postingId } from './postingId.js';
import { leadKey } from './keys.js';
import { blankPosting } from './postingsFile.js';
import { applicationFor, companyOf, jobEntry, squash } from './tags.js';
import { newQueue } from './newQueue.js';
import { findPay } from './findPay.js';
import { boardOf, API, knownBoard } from './boardSweep.js'; // a cycle, used only inside functions

export const CLOSED = /no longer (accepting|available)|position (has been )?filled|job (is )?closed/i;
const HEADERS = { 'user-agent': 'job-search-posting-check' };
const MAX_HOPS = 5;
const PRUNE_DAYS = 60;
const day = (s) => String(s ?? '').slice(0, 10);

const v4Public = (o) => {
    const [a, b] = o;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
};

export function isPublicAddress(ip) {
    const s = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
    const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const o = v4.slice(1).map(Number);
        return o.every((n) => n <= 255) && v4Public(o);
    }
    if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return false;
    const mapped = s.match(/^(?:0*:){2,5}ffff:(.+)$/);
    if (mapped) {
        const tail = mapped[1];
        if (tail.includes('.')) return isPublicAddress(tail);
        const [hi, lo] = tail.split(':').map((h) => parseInt(h, 16));
        return Number.isInteger(hi) && Number.isInteger(lo) && v4Public([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
    if (/^(0*:)*0*:?[01]?$/.test(s)) return false; // :: and ::1
    const first = parseInt(s.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return false;
    return true;
}

async function hostIsPublic(host, lookup) {
    if (/^[\d.]+$/.test(host) || host.startsWith('[')) return isPublicAddress(host);
    const found = await lookup(host, { all: true });
    return found.length > 0 && found.every((a) => isPublicAddress(a.address));
}

// Follows redirects by hand so every hop's host is checked. null = refused, failed or too many hops.
export async function safeFetch(url, { fetchImpl, lookup }, { method = 'GET', body, headers } = {}) {
    try {
        let target = new URL(url);
        for (let hop = 0; hop <= MAX_HOPS; hop++) {
            if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
            if (!(await hostIsPublic(target.hostname, lookup))) return null;
            const r = await fetchImpl(target.href, { method, body, headers: { ...HEADERS, ...headers }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
            const where = r.headers.get('location');
            if (r.status < 300 || r.status >= 400 || !where) return r;
            target = new URL(where, target);
        }
        return null;
    } catch {
        return null;
    }
}

export const visibleText = (html) => html.slice(0, 200_000)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

// Where the board's own API lives, or null for a plain page.
export function apiFor(posting) {
    const id = boardId(posting.url);
    let u;
    try {
        u = new URL(posting.url);
    } catch {
        return null;
    }
    const [seg] = u.pathname.split('/').filter(Boolean);
    if (id?.startsWith('greenhouse:') && /^(job-)?boards\.greenhouse\.io$/.test(u.host) && seg && seg !== 'embed') {
        return { kind: 'status', url: `https://boards-api.greenhouse.io/v1/boards/${seg}/jobs/${id.slice(11)}` };
    }
    if (id?.startsWith('lever:') && seg) return { kind: 'status', url: `https://api.lever.co/v0/postings/${seg}/${id.slice(6)}` };
    if (id?.startsWith('ashby:') && seg) return { kind: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${seg}`, uuid: id.slice(6) };
    return null;
}

const usd = (cents) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

// Posted pay for one posting, or null. Greenhouse and Lever give it as fields; any other page (and any
// page whose fields are empty) is searched as text, scripts included, since boards often embed it there.
export async function payFor(url, { fetchImpl, lookup }) {
    const api = apiFor({ url });
    const target = api?.kind === 'status' ? (api.url.includes('greenhouse') ? `${api.url}?pay_transparency=true` : api.url) : url;
    const r = await safeFetch(target, { fetchImpl, lookup });
    if (!r || r.status !== 200) return null;
    try {
        const body = (await r.text()).slice(0, 400_000);
        let json = null;
        if (api?.kind === 'status') try { json = JSON.parse(body); } catch { /* not JSON: search the text */ }
        const fields = [
            ...(json?.pay_input_ranges ?? []).map((x) => `${usd(x.min_cents)}–${usd(x.max_cents)}`),
            ...(json?.salaryRange ? [`$${json.salaryRange.min}–$${json.salaryRange.max}`] : []),
        ];
        if (fields.length) return fields.slice(0, 3).join(' | ');
        return findPay(json ? JSON.stringify(json) : body.replace(/<[^>]*>/g, ' '));
    } catch {
        return null;
    }
}

const TEXT_CHARS = 2500;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (t) => String(t ?? '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);
const plain = (html) => visibleText(decode(html)).trim();
const cap = (...parts) => parts.filter(Boolean).map(plain).join('\n').slice(0, TEXT_CHARS).trim();

// The part of a page's text from the role's title on, capped.
function focus(text, title) {
    const i = Math.max(0, title ? text.toLowerCase().indexOf(String(title).toLowerCase()) : -1);
    return text.slice(i, i + TEXT_CHARS).trim();
}

// Where a board's own API describes one job, for boards whose job pages need JavaScript.
// { url, text(json) } reads one job; { list, find(json), text(job) } finds it in the board's list (missing = taken down).
function detailOf(p, board) {
    const b = boardOf(p.url) ?? board;
    if (!b) return null;
    const own = (kind) => (p.id.startsWith(`${kind}:`) ? p.id.slice(kind.length + 1) : null);
    const path = (() => { try { return new URL(p.url).pathname; } catch { return ''; } })();
    switch (b.kind) {
        case 'workday': {
            const [host, tenant, site] = b.slug.split('/');
            const i = path.indexOf('/job/');
            return i < 0 ? null : { url: `https://${host}/wday/cxs/${tenant}/${site}${path.slice(i)}`, text: (d) => cap(d.jobPostingInfo?.jobDescription) };
        }
        case 'rippling': {
            const uuid = path.match(/\/jobs\/([0-9a-f-]{36})/i)?.[1];
            return uuid && { url: `https://api.rippling.com/platform/api/ats/v1/board/${b.slug}/jobs/${uuid}`, text: (d) => cap(d.description?.role, d.description?.company) };
        }
        case 'bamboohr': {
            const n = path.match(/\/careers\/(\d+)/)?.[1];
            return n && { url: `https://${b.slug}.bamboohr.com/careers/${n}/detail`, text: (d) => cap(d.result?.jobOpening?.description) };
        }
        case 'workable': {
            const sc = path.match(/\/j\/([0-9a-z]+)/i)?.[1];
            return sc && { url: `https://apply.workable.com/api/v2/accounts/${b.slug}/jobs/${sc}`, text: (d) => cap(d.description, d.requirements) };
        }
        case 'smartrecruiters': {
            const id = own('smartrecruiters');
            const s = (d) => d.jobAd?.sections ?? {};
            return id && { url: `https://api.smartrecruiters.com/v1/companies/${b.slug}/postings/${id}`, text: (d) => cap(s(d).jobDescription?.text, s(d).qualifications?.text, s(d).additionalInformation?.text) };
        }
        case 'gem': {
            const id = own('gem');
            return id && { list: API.gem.url(b.slug), find: (d) => d?.find?.((j) => j.id === id), text: (j) => String(j.content_plain ?? '').slice(0, TEXT_CHARS).trim() };
        }
        case 'recruitee': {
            const id = own('recruitee');
            return id && { list: API.recruitee.url(b.slug), find: (d) => d?.offers?.find((o) => String(o.id) === id), text: (o) => cap(o.description, o.requirements) };
        }
        default: return null;
    }
}

const getJson = (url, deps) => safeFetch(url, deps).then((r) => (r?.status === 200 ? r.json() : null)).catch(() => null);

// What a posting itself says: { state: 'gone' | 'ok' | 'unread', text }. `boards` caches board lists per run (Ashby, Gem,
// Recruitee); `board` is the company's known board, for posting links that don't name it (Workable's /j/ links).
export async function readPosting(p, deps, { boards = new Map(), board = null } = {}) {
    const api = apiFor(p);
    const detail = api ? null : detailOf(p, board);
    const listed = async (url, find, text) => {
        if (!boards.has(url)) boards.set(url, getJson(url, deps));
        const d = await boards.get(url);
        if (!d) return { state: 'unread', text: '' };
        const job = find(d);
        return job ? { state: 'ok', text: text(job) } : { state: 'gone', text: '' };
    };
    try {
        if (api?.kind === 'ashby') return await listed(api.url, (d) => (Array.isArray(d.jobs) ? d.jobs.find((j) => String(j.id).toLowerCase() === api.uuid.toLowerCase()) : null),
            (j) => String(j.descriptionPlain ?? '').slice(0, TEXT_CHARS).trim());
        if (detail?.list) return await listed(detail.list, detail.find, detail.text);
        const r = await safeFetch(api?.url ?? detail?.url ?? p.url, deps);
        if (!r) return { state: 'unread', text: '' };
        if (r.status === 404 || r.status === 410) return { state: 'gone', text: '' };
        if (r.status !== 200) return { state: 'unread', text: '' };
        const body = (await r.text()).slice(0, 400_000);
        // A board API's 200 means the job is up, even when its body says nothing readable.
        const json = () => { try { return JSON.parse(body); } catch { return {}; } };
        if (detail) return { state: 'ok', text: detail.text(json()) };
        if (api) { // Greenhouse or Lever job JSON
            const j = json();
            return { state: 'ok', text: j.content != null ? cap(j.content) : cap(j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}: ${l.content}`), j.additionalPlain) };
        }
        const text = visibleText(body.replace(/<head[\s\S]*?<\/head>/i, ' '));
        if (CLOSED.test(text)) return { state: 'gone', text: '' };
        // A page that doesn't name the role (a redirect to a list, or one drawn by script) says nothing about it.
        return squash(body.slice(0, 200_000)).includes(squash(p.role)) ? { state: 'ok', text: focus(text, p.role) } : { state: 'unread', text: '' };
    } catch {
        return { state: 'unread', text: '' };
    }
}

const STILL_UP = { ok: 'yes', gone: 'no', unread: 'unknown' };
export const checkPosting = async (posting, deps, board) => STILL_UP[(await readPosting(posting, deps, { board })).state];

// A saved job or application with a link but no posting gets a stub, so it is checked like any other.
function addStubs(companies, postings) {
    const out = [...postings];
    const have = (id, key) => out.some((p) => p.id === id || p.leadKey === key);
    for (const company of companies) {
        const entries = [
            ...Object.values(company.jobs ?? {}).map((e) => [e, 'owner']),
            ...(company.applications ?? []).map((e) => [e, 'application']),
        ];
        for (const [e, source] of entries) {
            if (!e.url) continue;
            const key = e.leadKey ?? leadKey(company.name, e.role);
            const id = e.postingId ?? postingId({ url: e.url, company: company.name, role: e.role });
            if (have(id, key)) continue;
            out.push({ ...blankPosting({ id, companyKey: company.key, leadKey: key, role: e.role ?? '', url: e.url, source }), wasLead: true });
        }
    }
    return out;
}

export async function pool(items, n, fn) {
    const q = [...items];
    await Promise.all(Array.from({ length: n }, async () => {
        for (let item = q.shift(); item; item = q.shift()) await fn(item);
    }));
}

export async function checkAll({ companies, postings }, { today, fetchImpl, lookup }) {
    const all = addStubs(companies, postings).map((p) => ({ ...p }));
    const queued = new Set(newQueue(companies, all).filter((i) => i.kind === 'dispute' || i.kind === 'lead').map((i) => i.postingId));
    const picked = all.filter((p) => {
        const c = companyOf(companies, p);
        if (!c || !p.url) return false;
        return queued.has(p.id) || ['saved', 'applying'].includes(jobEntry(c, p)?.state) || applicationFor(c, p)?.outcome === 'applied'
            || (p.posted === 'no' && day(p.postedCheckedAt) < day(today));
    });
    await pool(picked, 4, async (p) => {
        const v = await checkPosting(p, { fetchImpl, lookup }, knownBoard(companyOf(companies, p) ?? {}, all));
        if (v === 'unknown') return;
        if (v === 'no' && p.posted !== 'no') p.goneAt = day(today);
        if (v === 'yes') delete p.goneAt;
        p.posted = v;
        p.postedCheckedAt = today;
    });
    return all;
}

export function prune({ companies, postings }, today) {
    const limit = Date.parse(day(today)) - PRUNE_DAYS * 86_400_000;
    return postings.filter((p) => {
        if (p.wasLead || !(Date.parse(day(p.lastRun)) < limit)) return true;
        const c = companyOf(companies, p);
        return Boolean(c && (jobEntry(c, p) || applicationFor(c, p)));
    });
}
