import { leadKey } from './keys.js';

const UUID = /^\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

// 32-bit FNV-1a over UTF-8 bytes, 8 hex chars.
export function fnv1a(text) {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(String(text))) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
}

// The board's own job id, or null when the URL is not a known board posting.
export function boardId(url) {
    let u;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const gh = u.searchParams.get('gh_jid');
    if (gh && /^\d+$/.test(gh)) return `greenhouse:${gh}`;
    const { host, pathname } = u;
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
        const job = pathname.match(/\/jobs\/(\d+)/);
        if (job) return `greenhouse:${job[1]}`;
    }
    if (host === 'jobs.lever.co') {
        const id = pathname.match(UUID);
        if (id) return `lever:${id[1]}`;
    }
    if (host === 'jobs.ashbyhq.com') {
        const id = pathname.match(UUID);
        if (id) return `ashby:${id[1]}`;
    }
    if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) {
        const id = pathname.match(/_((?:J?R|REQ)[-_]?\d+)(?:\/|$)/i);
        if (id) return `workday:${id[1].toUpperCase()}`;
    }
    const sub = host.match(/^([\w-]+)\.(bamboohr\.com|breezy\.hr|pinpointhq\.com)$/);
    if (sub?.[2] === 'bamboohr.com') {
        const id = pathname.match(/^\/careers\/(\d+)\/?$/);
        if (id) return `bamboohr:${sub[1]}:${id[1]}`;
    }
    if (sub?.[2] === 'breezy.hr') {
        const id = pathname.match(/^\/p\/([0-9a-f]+)(?:-|\/|$)/i);
        if (id) return `breezy:${id[1]}`;
    }
    if (sub?.[2] === 'pinpointhq.com') {
        const id = pathname.match(/^\/[^/]+\/postings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
        if (id) return `pinpoint:${id[1].toLowerCase()}`;
    }
    if (host === 'apply.workable.com') {
        const id = pathname.match(/^(?:\/[^/]+)?\/j\/([0-9a-z]+)(?:\/|$)/i);
        if (id) return `workable:${id[1].toUpperCase()}`;
    }
    if (host === 'recruiting.paylocity.com') {
        const id = pathname.match(/^\/recruiting\/jobs\/details\/(\d+)(?:\/|$)/i);
        if (id) return `paylocity:${id[1]}`;
    }
    // The boards the sweep reads since 2026-11-23: the same ids its fallback gives (lib/boardSweep.js fetchRoles).
    const one = (re) => pathname.match(re)?.[1];
    if (host === 'ats.rippling.com') { const id = one(/\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i); if (id) return `rippling:${id.toLowerCase()}`; }
    if (host === 'jobs.gem.com') { const id = one(/^\/[^/]+\/([\w-]{12,})\/?$/); if (id) return `gem:${id}`; }
    if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host)) { const id = one(/^\/[^/]+\/(\d{6,})(?:-|\/|$)/); if (id) return `smartrecruiters:${id}`; }
    if (host.endsWith('.teamtailor.com')) { const id = one(/^\/jobs\/(\d+)(?:-|\/|$)/); if (id) return `teamtailor:${id}`; }
    if (host.endsWith('.applytojob.com')) { const id = one(/^\/apply\/([A-Za-z0-9]{6,})(?:\/|$)/); if (id) return `applytojob:${id}`; }
    if (/\.jobs\.personio\.(de|com)$/.test(host)) { const id = one(/^\/job\/(\d+)(?:\/|$)/); if (id) return `personio:${id}`; }
    return null;
}

// Two links to the same job page, ignoring tracking parameters, a trailing /apply or /application and a trailing slash.
// '' for a link that names no single job (a careers or jobs index), so roles that share one never merge.
export function jobUrlKey(url) {
    let u;
    try { u = new URL(url); } catch { return ''; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|src$|gh_src$|lever-|trk)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const path = u.pathname.replace(/\/(application|apply)\/?$/i, '').replace(/\/+$/, '');
    // Board indexes whose link carries the company's own id, not a job's: ADP without jobId, Paylocity's All list, UltiPro's board.
    if ((/workforcenow\.adp\.com$/i.test(u.host) && !u.searchParams.has('jobId')) || /\/recruiting\/jobs\/all\//i.test(path + '/') || /\/jobboard\/[0-9a-f-]{36}$/i.test(path)) return '';
    const specific = boardId(url) || /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(path + u.search) || /[\w-]{16,}$/.test(path);
    return specific ? `${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}` : '';
}

// A posting at the same company with the same job link, if any.
export const sameLink = (postings, companyKey, url) => {
    const k = jobUrlKey(url);
    return k ? postings.find((p) => p.companyKey === companyKey && jobUrlKey(p.url) === k) : undefined;
};

export const postingId = ({ url, company, role }) => boardId(url) ?? `key:${fnv1a(leadKey(company, role))}`;
