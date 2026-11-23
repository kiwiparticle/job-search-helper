// Scheduling and evidence metadata. Dates from model reports never become script verification.
import { activeApplication, hasActiveLead } from './tags.js';
import { knownBoard, API } from './boardSweep.js';
import { findCompany } from './companies.js';

export const MANUAL_SLOTS = 15;
export const ROLE_SLOTS = 30;
const groups = ['lead', 'application', 'watch'];
export const tracked = (c, postings) => c.stance !== 'Ruled out' && (hasActiveLead(c, postings) || Boolean(activeApplication(c)) || ['Watching', 'Dormant', 'To review'].includes(c.stance));
export function dueTargets(companies, postings, at) {
    return companies.filter(c => tracked(c, postings)).flatMap(c => {
        const group = hasActiveLead(c, postings) ? 'lead' : activeApplication(c) ? 'application' : 'watch';
        if (group === 'watch' && c.stance === 'Dormant') return []; // Dormant: monthly sweep only (bin/sweep.js), no rotation slot
        const board = knownBoard(c, postings);
        const api = Boolean(board && API[board.kind]);
        const m = c.monitoring ?? {};
        const last = api ? m.lastBoardVerifiedAt : m.lastBoardReportedAt;
        const due = last ? Date.parse(last.slice(0,10)) + (group === 'lead' ? 1 : 7) * 864e5 : 0;
        return due <= Date.parse(at.slice(0,10)) ? [{ company: c.name, key: c.key, group, api, due, lastTriedAt: m.lastBoardTriedAt ?? '' }] : [];
    });
}
export function manualTargets(targets) {
    const pools = groups.map(g => targets.filter(t => t.group === g).sort((a,b) => a.lastTriedAt.localeCompare(b.lastTriedAt) || a.due-b.due || a.key.localeCompare(b.key)));
    const out = pools.flatMap(p => p.splice(0,5));
    for (const p of pools) while (p.length && out.length < MANUAL_SLOTS) out.push(p.shift());
    return out;
}
export function selectRoles(entries, companies, postings, limit = ROLE_SLOTS) {
    const byId = new Map(postings.map(p => [p.id,p]));
    const tried = r => byId.get(r.id)?.screening?.lastTriedAt ?? '';
    // Roles title triage kept (lib/triage.js) go first, highest fit first across companies; the rest round-robin by company.
    const kept = r => { const t = byId.get(r.id)?.triage; return t?.keep ? t.fit ?? 3 : 0; };
    const pools = entries.filter(e => findCompany(companies,e.company)?.stance !== 'Ruled out').map(e => ({ ...e, roles: [...e.roles].sort((a,b) => kept(b)-kept(a) || tried(a).localeCompare(tried(b)) || a.id.localeCompare(b.id)), selected: [] }));
    const last = e => findCompany(companies,e.company)?.monitoring?.lastSweepScheduledAt ?? '';
    pools.sort((a,b) => last(a).localeCompare(last(b)) || a.company.localeCompare(b.company));
    let left = limit;
    const keptRoles = pools.flatMap(e => e.roles.filter(kept).map(r => ({ e, r }))).sort((a,b) => kept(b.r)-kept(a.r));
    for (const { e, r } of keptRoles.slice(0, left)) { e.selected.push(r); e.roles.splice(e.roles.indexOf(r), 1); left--; }
    while (left && pools.some(e => e.roles.length)) for (const e of pools) if (left && e.roles.length) { e.selected.push(e.roles.shift()); left--; }
    return pools.filter(e => e.selected.length).map(({selected,roles,...e}) => ({...e,roles:selected}));
}
export function mergeDate(record, bucket, field, at) {
    if (!Number.isFinite(Date.parse(at))) return;
    const old = record[bucket]?.[field];
    if (!old || Date.parse(at) > Date.parse(old)) record[bucket] = {...record[bucket], [field]:at};
}
export function cleanCoverage(raw, targets, date) {
    if (!Array.isArray(raw)) return [];
    const assigned = new Set(targets.map(t => t.company));
    const seen = new Set();
    return raw.slice(0,MANUAL_SLOTS).flatMap(r => {
        if (!r || !assigned.has(r.company) || seen.has(r.company) || !['completed','blocked','unfinished'].includes(r.status) || r.date !== date) return [];
        try { const u = new URL(r.url); if (!['http:','https:'].includes(u.protocol) || r.url.length > 500) return []; } catch { return []; }
        seen.add(r.company);
        return [{company:r.company,status:r.status,url:r.url,date,source:'model-reported'}];
    });
}
