// Finds the job board (any kind `boardSweep.js` can read) embedded in a company's own careers page. Fetch and DNS lookup are injected.
import { eligible } from './rotation.js';
import { safeFetch, pool } from './postingCheck.js';
import { knownBoard, boardOf, fetchRoles } from './boardSweep.js';

const MAX_CHARS = 500_000;
// A slug ends at a non-slug character; a dot followed by more name (acme.evil) is a lookalike, a sentence-ending dot is not.
const END = '(?![\\w-]|\\.[\\w-])';
const SLUG = `([A-Za-z0-9_-]+)${END}`;
const SUB = '([\\w-]{1,63})'; // one DNS label
const SUBDOMAIN_RESERVED = /^(www|api|app|careers)$/;
// Words that sit where a slug would but are not one.
const NOT_SLUG = {
    greenhouse: /^embed$/,
    lever: /^embed$/,
    ashby: /^embed$/,
    bamboohr: SUBDOMAIN_RESERVED,
    breezy: SUBDOMAIN_RESERVED,
    pinpoint: SUBDOMAIN_RESERVED,
    workable: /^(j|api)$/,
};
const FORMS = [
    ['greenhouse', new RegExp(`(?<![\\w.-])(?:job-)?boards\\.greenhouse\\.io/embed/job_board(?:/js)?\\?(?:[^"'\\s<>]{0,200}?[&;])?for=${SLUG}`, 'gi')],
    ['greenhouse', new RegExp(`(?<![\\w.-])(?:job-)?boards\\.greenhouse\\.io/${SLUG}`, 'gi')],
    ['lever', new RegExp(`(?<![\\w.-])jobs\\.lever\\.co/${SLUG}`, 'gi')],
    ['ashby', new RegExp(`(?<![\\w.-])jobs\\.ashbyhq\\.com/${SLUG}`, 'gi')],
    ['bamboohr', new RegExp(`(?<![\\w.-])${SUB}\\.bamboohr\\.com${END}`, 'gi')],
    ['breezy', new RegExp(`(?<![\\w.-])${SUB}\\.breezy\\.hr${END}`, 'gi')],
    ['pinpoint', new RegExp(`(?<![\\w.-])${SUB}\\.pinpointhq\\.com${END}`, 'gi')],
    ['workable', new RegExp(`(?<![\\w.-])apply\\.workable\\.com/${SLUG}`, 'gi')],
];

export const boardUrl = ({ kind, slug }) => ({
    greenhouse: `https://boards.greenhouse.io/${slug}`,
    lever: `https://jobs.lever.co/${slug}`,
    ashby: `https://jobs.ashbyhq.com/${slug}`,
    bamboohr: `https://${slug}.bamboohr.com/careers`,
    breezy: `https://${slug}.breezy.hr`,
    workable: `https://apply.workable.com/${slug}`,
    pinpoint: `https://${slug}.pinpointhq.com`,
    rippling: `https://ats.rippling.com/${slug}/jobs`,
    gem: `https://jobs.gem.com/${slug}`,
    smartrecruiters: `https://jobs.smartrecruiters.com/${slug}`,
    recruitee: `https://${slug}.recruitee.com`,
    personio: `https://${slug}`,
    teamtailor: `https://${slug}.teamtailor.com/jobs`,
    applytojob: `https://${slug}.applytojob.com/apply`,
    paylocity: `https://recruiting.paylocity.com/recruiting/jobs/All/${slug}`,
    workday: (() => { const [host, tenant, site] = slug.split('/'); return host.endsWith('.myworkdaysite.com') ? `https://${host}/recruiting/${tenant}/${site}` : `https://${host}/${site}`; })(),
})[kind];

export function findBoards(html) {
    const seen = new Map();
    for (const [kind, re] of FORMS) {
        for (const m of html.matchAll(re)) {
            if (NOT_SLUG[kind]?.test(m[1].toLowerCase())) continue;
            const id = `${kind}:${m[1].toLowerCase()}`;
            if (!seen.has(id)) seen.set(id, { index: m.index, board: { kind, slug: m[1] } });
        }
    }
    // Boards with no short form above: any full link boardOf reads (Rippling, Workday, Paylocity, Gem, ...). Kept as found.
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]{1,300}/gi)) {
        const board = boardOf(m[0]);
        if (!board || FORMS.some(([k]) => k === board.kind)) continue;
        const id = `${board.kind}:${board.slug.toLowerCase()}`;
        if (!seen.has(id)) seen.set(id, { index: m.index, board: { ...board, url: m[0] } });
    }
    return [...seen.values()].sort((a, b) => a.index - b.index).map((s) => s.board);
}

const confirmed = async (board, deps) => (await fetchRoles(board, deps)) !== null;

// Reads at most MAX_CHARS of the body; a body without a stream (a test double) falls back to text().
async function readCapped(r) {
    if (!r.body?.[Symbol.asyncIterator]) return (await r.text()).slice(0, MAX_CHARS);
    const dec = new TextDecoder();
    let s = '';
    for await (const chunk of r.body) { // leaving the loop cancels the stream
        s += dec.decode(chunk, { stream: true });
        if (s.length >= MAX_CHARS) break;
    }
    return s.slice(0, MAX_CHARS);
}

export async function resolveBoard(pageUrl, deps) {
    const r = await safeFetch(pageUrl, deps);
    if (!r || r.status !== 200) return null;
    let html;
    try {
        html = await readCapped(r);
    } catch {
        return null;
    }
    const found = findBoards(html);
    if (found.length !== 1 || !(await confirmed(found[0], deps))) return null;
    const { kind, slug, url } = found[0];
    return { kind, slug, url: boardUrl(found[0]) ?? url };
}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

export async function resolveAll({ companies, postings }, deps) {
    const targets = companies.filter((c) => eligible(c) && !knownBoard(c, postings));
    const out = targets.map((c) => ({ key: c.key, company: c.name, board: null, source: '' }));
    await pool(targets.map((c, i) => ({ c, i })), 6, async ({ c, i }) => { // objects: pool stops on a falsy item
        for (const source of [c.careersUrl, c.jobsUrl, c.website].filter(isHttp)) {
            const board = await resolveBoard(source, deps);
            if (board) {
                out[i] = { key: c.key, company: c.name, board, source };
                return;
            }
        }
    });
    return out;
}

// Sets the board as the company's jobs link. A non-board jobs link moves to careersUrl when that is empty. Returns whether anything changed.
export function applyResolutions(company, board, today) {
    if (company.jobsUrl && boardOf(company.jobsUrl)) return false;
    if (company.jobsUrl && !company.careersUrl) company.careersUrl = company.jobsUrl;
    company.jobsUrl = board.url;
    company.events = [...(company.events ?? []), { date: today, text: `Found jobs board ${board.url}` }];
    return true;
}

// The board a URL a browser saw points at: a board link (boardOf), or a board API call a careers page's script made.
const API_FORMS = [
    ['greenhouse', /^https:\/\/(?:boards-api|api)\.greenhouse\.io\/v1\/boards\/([\w-]+)\//i],
    ['greenhouse', /^https:\/\/(?:job-)?boards\.greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:.*&)?for=([\w-]+)/i],
    ['lever', /^https:\/\/api\.lever\.co\/v0\/postings\/([\w-]+)/i],
    ['ashby', /^https:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/([\w.-]+)/i],
    ['ashby', /^https:\/\/jobs\.ashbyhq\.com\/api\/non-user-graphql\?(?:.*&)?organizationHostedJobsPageName=([\w.-]+)/i],
    ['rippling', /^https:\/\/api\.rippling\.com\/platform\/api\/ats\/v1\/board\/([\w-]+)\//i],
    ['gem', /^https:\/\/api\.gem\.com\/job_board\/v0\/([\w-]+)\//i],
    ['smartrecruiters', /^https:\/\/api\.smartrecruiters\.com\/v1\/companies\/([\w-]+)\//i],
    ['smartrecruiters', /^https:\/\/www\.smartrecruiters\.com\/job-api\/public\/search\/widgets\/([\w-]+)\//i],
    ['workable', /^https:\/\/apply\.workable\.com\/api\/v\d\/(?:widget\/)?accounts\/([\w-]+)/i],
];
export function boardFromUrl(url) {
    if (typeof url !== 'string' || url.length > 2000) return null;
    for (const [kind, re] of API_FORMS) {
        const m = url.match(re);
        if (m && !/^(embed|api|j)$/i.test(m[1])) return { kind, slug: m[1] };
    }
    const wd = url.match(/^https:\/\/([\w-]+\.wd\d+\.myworkdayjobs\.com|wd\d+\.myworkdaysite\.com)\/wday\/cxs\/([\w-]+)\/([\w-]+)\//i);
    if (wd) return { kind: 'workday', slug: `${wd[1].toLowerCase()}/${wd[2]}/${wd[3]}` };
    return boardOf(url);
}

// The one board a page's requests and links point at most, or null when none (or a tie between two).
export function pickBoard(urls) {
    const count = new Map();
    for (const u of urls) {
        const b = boardFromUrl(u);
        if (!b) continue;
        const id = `${b.kind}:${b.slug.toLowerCase()}`;
        count.set(id, { board: b, n: (count.get(id)?.n ?? 0) + 1 });
    }
    const ranked = [...count.values()].sort((a, b) => b.n - a.n);
    return ranked.length && (ranked.length === 1 || ranked[0].n > ranked[1].n) ? ranked[0].board : null;
}

// Companies whose page a browser should open: tracked, no known board, some page to open.
export const browserTargets = (companies, postings) => companies
    .filter((c) => eligible(c) && !knownBoard(c, postings))
    .flatMap((c) => {
        const url = [c.careersUrl, c.jobsUrl, c.website].find(isHttp);
        return url ? [{ key: c.key, name: c.name, url }] : [];
    });
