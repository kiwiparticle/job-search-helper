// Lists open roles on a tracked company's own job board. Fetch and DNS lookup are injected.
import { eligible } from './rotation.js';
import { boardId, fnv1a } from './postingId.js';
import { safeFetch, pool } from './postingCheck.js';
import { hasWord, DEFAULT_DROP } from './sweepFilter.js';
import { companyOf, jobEntry } from './tags.js';

const HOSTS = {
    'boards.greenhouse.io': 'greenhouse',
    'job-boards.greenhouse.io': 'greenhouse',
    'jobs.lever.co': 'lever',
    'jobs.ashbyhq.com': 'ashby',
};

const SUBDOMAIN_KINDS = { 'bamboohr.com': 'bamboohr', 'breezy.hr': 'breezy', 'pinpointhq.com': 'pinpoint', 'recruitee.com': 'recruitee', 'applytojob.com': 'applytojob' };
const LOCALE = /^[a-z]{2}(-[a-z]{2})?$/i;

export function boardOf(url) {
    try {
        const u = new URL(url);
        const host = u.host.toLowerCase();
        const segs = u.pathname.split('/').filter(Boolean);
        const sub = host.match(/^([\w-]+)\.(bamboohr\.com|breezy\.hr|pinpointhq\.com|recruitee\.com|applytojob\.com)$/);
        if (sub) return /^(www|api|app|careers)$/.test(sub[1]) ? null : { kind: SUBDOMAIN_KINDS[sub[2]], slug: sub[1] };
        const [slug] = segs;
        if (host === 'apply.workable.com') return slug && /^[\w-]+$/.test(slug) && slug !== 'j' && slug !== 'api' ? { kind: 'workable', slug } : null;
        const tt = host.match(/^([\w-]+(?:\.na)?)\.teamtailor\.com$/);
        if (tt) return /^(www|api|app|careers)$/.test(tt[1]) ? null : { kind: 'teamtailor', slug: tt[1] };
        const pers = host.match(/^([\w-]+)\.jobs\.personio\.(de|com)$/);
        if (pers) return { kind: 'personio', slug: `${pers[1]}.jobs.personio.${pers[2]}` };
        if (host === 'ats.rippling.com') {
            const s = segs.find((x) => !LOCALE.test(x));
            return s && /^[\w-]+$/.test(s) ? { kind: 'rippling', slug: s } : null;
        }
        if (host === 'jobs.gem.com') return slug && /^[\w-]+$/.test(slug) ? { kind: 'gem', slug } : null;
        if (/^(jobs|careers|www)\.smartrecruiters\.com$/.test(host)) return slug && /^[\w-]+$/.test(slug) && !/^(job-api|api|job-widget)$/i.test(slug) ? { kind: 'smartrecruiters', slug } : null;
        if (host === 'recruiting.paylocity.com') {
            const m = u.pathname.match(/^\/recruiting\/jobs\/all\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
            return m ? { kind: 'paylocity', slug: m[1].toLowerCase() } : null;
        }
        // Workday: tenant.wdN.myworkdayjobs.com/[locale/]site, or wdN.myworkdaysite.com/recruiting/tenant/site. Slug: host/tenant/site.
        const wd = host.match(/^([\w-]+)\.wd\d+\.myworkdayjobs\.com$/);
        if (wd) {
            const site = segs.find((x) => !LOCALE.test(x));
            return site && /^[\w-]+$/.test(site) && site !== 'wday' ? { kind: 'workday', slug: `${host}/${wd[1]}/${site}` } : null;
        }
        if (/^wd\d+\.myworkdaysite\.com$/.test(host)) {
            const i = segs.indexOf('recruiting');
            const [tenant, site] = i < 0 ? [] : segs.slice(i + 1);
            return tenant && site && /^[\w-]+$/.test(tenant + site) ? { kind: 'workday', slug: `${host}/${tenant}/${site}` } : null;
        }
        const kind = HOSTS[host];
        return kind && slug && slug !== 'embed' ? { kind, slug } : null;
    } catch {
        return null;
    }
}

// Wide on purpose: the sweep filter and title triage narrow it. Any level (sweepBoards drops titleDrop words); no managers or non-engineering jobs.
export const isEngineering = (t) => /\b(engineers?|developers?|swe|sde|programmer|architect|technologist|tech(nical)? lead|member of technical staff|mts|front[\s-]?end|full[\s-]?stack|back[\s-]?end)\b/i.test(t)
    && !/\b(manager|director|head|vp|recruit\w*|sales|support|accountant|designer|analyst)\b/i.test(t);

export function knownBoard(company, postings) {
    for (const url of [company.jobsUrl, company.careersUrl]) {
        const b = url && boardOf(url);
        if (b) return b;
    }
    const mine = postings.filter((p) => p.companyKey === company.key).sort((a, b) => String(b.lastRun ?? '').localeCompare(String(a.lastRun ?? '')));
    for (const p of mine) {
        const b = boardOf(p.url);
        if (b) return b;
    }
    for (const j of Object.values(company.jobs ?? {})) {
        const b = boardOf(j.url);
        if (b) return b;
    }
    return null;
}

export const LINK_SLICE = 40;

// Eligible companies with no stored link and no known board, oldest check first.
export const pickLinkTargets = (companies, postings, n = LINK_SLICE) => companies
    .filter((c) => eligible(c) && !c.careersUrl && !c.jobsUrl && !knownBoard(c, postings))
    .sort((a, b) => (a.monitoring?.lastLinksTriedAt ?? '').localeCompare(b.monitoring?.lastLinksTriedAt ?? '') || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((c) => c.name);

// The location text a board gives, or '' (some boards give none).
const place = (...parts) => parts.filter((p) => typeof p === 'string' && p.trim()).join(', ');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescape = (t) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
const MAX_PAGE = 2_000_000;
const getText = async (url, deps) => {
    const r = await safeFetch(url, deps);
    return r?.status === 200 ? (await r.text()).slice(0, MAX_PAGE) : null;
};
const getJson = async (url, deps, init) => {
    const r = await safeFetch(url, deps, init);
    return r?.status === 200 ? r.json() : null;
};
const workdayParts = (slug) => {
    const [host, tenant, site] = slug.split('/');
    return { host, tenant, site, page: host.endsWith('.myworkdaysite.com') ? `https://${host}/recruiting/${tenant}/${site}` : `https://${host}/${site}` };
};
const WORKDAY_PAGES = 10; // ponytail: 200 roles max; a board bigger than that is far outside the size target anyway

// map: a board job → [id, title, url, location]. `url` + `list` read a JSON API with GET; `read` returns the job list itself (or null).
export const API = {
    // Greenhouse's absolute_url is often the company's own careers page (?gh_jid=), which may redirect or not render: link the board.
    greenhouse: { url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, list: (d) => d?.jobs, map: (j, s) => [j.id, j.title, `https://job-boards.greenhouse.io/${s}/jobs/${j.id}`, place(j.location?.name)] },
    lever: { url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`, list: (d) => d, map: (j) => [j.id, j.text, j.hostedUrl, place(j.categories?.location, j.workplaceType === 'remote' ? 'Remote' : '')] },
    ashby: { url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`, list: (d) => d?.jobs, map: (j) => [j.id, j.title, j.jobUrl, place(j.location, j.isRemote ? 'Remote' : '')] },
    bamboohr: { url: (s) => `https://${s}.bamboohr.com/careers/list`, list: (d) => d?.result, map: (j, s) => [/^\d+$/.test(String(j.id)) ? j.id : null, j.jobOpeningName, `https://${s}.bamboohr.com/careers/${j.id}`, place(j.location?.city, j.location?.state, j.isRemote ? 'Remote' : '')] },
    breezy: { url: (s) => `https://${s}.breezy.hr/json`, list: (d) => d, map: (j) => [j.id, j.name, j.url, place(j.location?.name, j.location?.is_remote ? 'Remote' : '')] },
    workable: { url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`, list: (d) => d?.jobs, map: (j) => [j.shortcode, j.title, j.url, place(j.city, j.state, j.country, j.telecommuting ? 'Remote' : '')] },
    pinpoint: { url: (s) => `https://${s}.pinpointhq.com/postings.json`, list: (d) => d?.data, map: (j) => [j.id, j.title, j.url, place(j.location?.name, j.workplace_type === 'remote' ? 'Remote' : '')] },
    rippling: { url: (s) => `https://api.rippling.com/platform/api/ats/v1/board/${s}/jobs`, list: (d) => d, map: (j) => [j.uuid, j.name, j.url, place(j.workLocation?.label)] },
    gem: { url: (s) => `https://api.gem.com/job_board/v0/${s}/job_posts/`, list: (d) => d, map: (j) => [j.id, j.title, j.absolute_url, place(j.location?.name, j.location_type === 'remote' ? 'Remote' : '')] },
    smartrecruiters: { url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`, list: (d) => d?.content, map: (j, s) => [j.id, j.name, `https://jobs.smartrecruiters.com/${s}/${j.id}`, place(j.location?.fullLocation, j.location?.remote ? 'Remote' : '')] },
    recruitee: { url: (s) => `https://${s}.recruitee.com/api/offers/`, list: (d) => d?.offers, map: (j) => [j.id, j.title, j.careers_url, place(j.location, j.remote ? 'Remote' : '')] },
    personio: { url: (s) => `https://${s}/search.json`, list: (d) => d, map: (j, s) => [j.id, j.name, `https://${s}/job/${j.id}`, place(j.office)] },
    workday: {
        read: async (s, deps) => {
            const { host, tenant, site } = workdayParts(s);
            const jobs = [];
            let total = Infinity;
            for (let page = 0; page < WORKDAY_PAGES && jobs.length < total; page++) {
                const d = await getJson(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, deps, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 20, offset: jobs.length, searchText: '', appliedFacets: {} }) });
                if (!Array.isArray(d?.jobPostings)) return page ? jobs : null;
                if (page === 0) total = Number(d.total) || 0; // later pages may report 0
                if (!d.jobPostings.length) break;
                jobs.push(...d.jobPostings);
            }
            return jobs;
        },
        map: (j, s) => [j.externalPath, j.title, typeof j.externalPath === 'string' ? workdayParts(s).page + j.externalPath : null, place(j.locationsText)],
    },
    // Paylocity's board page carries its jobs as one JSON line: window.pageData = {...};
    paylocity: {
        read: async (s, deps) => {
            const html = await getText(`https://recruiting.paylocity.com/recruiting/jobs/All/${s}`, deps);
            const line = html?.match(/window\.pageData\s*=\s*(\{.*\});\s*$/m);
            return line ? JSON.parse(line[1]).Jobs ?? null : null;
        },
        map: (j) => [j.JobId, j.JobTitle, `https://recruiting.paylocity.com/Recruiting/Jobs/Details/${j.JobId}`, place(j.LocationName, j.IsRemote ? 'Remote' : '')],
    },
    teamtailor: {
        read: async (s, deps) => {
            const xml = await getText(`https://${s}.teamtailor.com/jobs.rss`, deps);
            if (!xml?.includes('<rss')) return null;
            return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
                const tag = (t) => unescape(it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? '');
                return { title: tag('title'), link: tag('link'), where: [...it.matchAll(/<tt:city>([\s\S]*?)<\/tt:city>/g)].map((m) => unescape(m[1])).join(', '), remote: tag('remoteStatus') };
            });
        },
        map: (j) => [j.link.match(/\/jobs\/(\d+)/)?.[1] ?? null, j.title, j.link, place(j.where, /fully|remote/i.test(j.remote) ? 'Remote' : '')],
    },
    // JazzHR: the /apply page lists each job as a link to /apply/<id>/<slug>.
    applytojob: {
        read: async (s, deps) => {
            const html = await getText(`https://${s}.applytojob.com/apply`, deps);
            if (html === null) return null;
            const re = new RegExp(`<a href="(https?://${s.replace(/[-]/g, '\\-')}\\.applytojob\\.com/apply/([A-Za-z0-9]+)/[^"]*)"[^>]*>([^<]+)</a>`, 'gi');
            return [...html.matchAll(re)].map((m) => ({ url: m[1].replace(/^http:/, 'https:'), id: m[2], title: unescape(m[3]) }));
        },
        map: (j) => [j.id, j.title, j.url, ''],
    },
};

// A company's own careers page, for one with no known board: the sweep lists the engineering-looking links on it.
// A page drawn by script shows none, which reads like an empty board; the tracked rotation still covers it.
export function pageOf(company) {
    for (const url of [company.jobsUrl, company.careersUrl]) if (typeof url === 'string' && /^https?:\/\//i.test(url)) return { kind: 'page', slug: url };
    return null;
}
// Nav and docs links that name engineers but aren't jobs ("Developers", "Developer API", "Meet our engineers").
const NOT_A_JOB = /\b(developers|engineers|architects|blog|meet|our|team|culture|life at|stories?|podcast|webinar|events?|news|how|why|learn|read|guide|faq|api|docs?|documentation|portal|resources|forum|community|marketing|sdk)\b/i;
API.page = {
    read: async (s, deps) => {
        const html = await getText(s, deps);
        if (html === null) return null;
        const seen = new Map();
        for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{1,600}?)<\/a>/gi)) {
            // Cards often run on into their tags ("Frontend Engineer · Full-time · Remote"): keep the title.
            const title = unescape(m[2].replace(/<[^>]*>/g, ' ')).split(/\s+[·|•]\s+|\s+(?:full|part)[- ]time\b/i)[0].trim();
            if (!title || title.length > 120 || NOT_A_JOB.test(title) || !isEngineering(title)) continue;
            let url;
            try { url = new URL(unescape(m[1]), s).href; } catch { continue; }
            if (/^https?:/.test(url) && url !== s && !seen.has(url)) seen.set(url, { url, title });
        }
        return [...seen.values()];
    },
    map: (j) => [fnv1a(j.url), j.title, j.url, ''],
};

// The board's jobs as { id, title, url, location? }, or null when the board couldn't be read.
export async function fetchRoles({ kind, slug }, deps) {
    const api = API[kind];
    try {
        const list = api.read ? await api.read(slug, deps) : api.list(await getJson(api.url(slug), deps));
        if (!Array.isArray(list)) return null;
        return list.map((j) => api.map(j, slug)).filter(([id, title, url]) => id != null && typeof title === 'string' && typeof url === 'string')
            .map(([id, title, url, location]) => ({ id: boardId(url) ?? `${kind}:${id}`, title, url, ...(location && { location }) }));
    } catch {
        return null;
    }
}

// `judge`: list roles still waiting for a model verdict too (postings with an empty `modelSays`), except ones the owner skipped.
// `dormant`: include Dormant companies (bin/sweep.js passes it on the 1st of the month only).
export async function sweepBoards({ companies, postings, judge = false, targets: selected, dormant = false, drop = DEFAULT_DROP }, deps) {
    const settled = (p) => !judge || p.modelSays !== '' || jobEntry(companyOf(companies, p) ?? {}, p)?.state === 'skipped';
    const have = new Set(postings.filter(settled).map((p) => p.id));
    const targets = companies.filter(c => c.stance !== 'Ruled out' && !c.sweepOff && (selected ? selected.includes(c.name) : eligible(c) && (dormant || c.stance !== 'Dormant'))).map((c) => ({ c, board: knownBoard(c, postings) ?? (selected ? null : pageOf(c)) })).filter((t) => t.board);
    const out = targets.map(({ c, board }) => ({ company: c.name, ...board, status: 'error', roles: [] }));
    await pool(targets.map((t, i) => ({ t, i })), 6, async ({ t, i }) => { // objects: pool stops on a falsy item
        const roles = await fetchRoles(t.board, deps);
        if (!roles) return;
        const senior = roles.filter((r) => isEngineering(r.title) && !hasWord(r.title, drop));
        out[i].total = senior.length;
        out[i].status = 'ok';
        out[i].seen = senior.map((r) => r.id);
        out[i].urls = Object.fromEntries(senior.map((r) => [r.id, r.url]));
        out[i].roles = senior.filter((r) => !have.has(r.id));
    });
    return out;
}
