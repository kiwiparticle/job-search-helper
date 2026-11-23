import { parseLedger, rowCells, COLUMNS, exportLedger } from './ledger.js';
import { blankCompany, findCompany, possibleDuplicate } from './companies.js';
import { attachRun, findKind } from './postings.js';
import { blankPosting } from './postingsFile.js';
import { fnv1a, postingId } from './postingId.js';
import { companyKey, leadKey, sameCompany } from './keys.js';
import { MODEL_FIELDS } from './caps.js';
import { companyOf, hasActiveLead, isProtected, jobEntry, applicationFor, sameRole, squash } from './tags.js';
import { newQueue } from './newQueue.js';

const FIELDS = { Verdict: 'verdict', Fingerprint: 'fingerprint', Domain: 'domain', Awards: 'awards', Reason: 'reason', 'Re-check trigger': 'recheckTrigger' };
const STANCE = { Applied: 'Watching', Rejected: 'Watching', 'Ruled out (company)': 'Ruled out', 'Active lead': 'Watching', 'Skip current role': 'Watching', Watching: 'Watching', Dormant: 'Dormant', 'To review': 'To review' };
const NOT_RECORDED = 'Role not recorded';
const DATE = /\d{4}-\d{2}-\d{2}/;
const NEWEST_RUNS = 3;
const OLD_BOARD_RUNS = 10;
const PROTECTED = ['Applied', 'Rejected', 'Ruled out (company)'];

// Splits on ';' outside parentheses.
export function splitRoles(cell) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(cell ?? '')) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
}

const dateFor = (word) => (row) => {
    const re = new RegExp(`${word} (around )?(${DATE.source})`);
    for (const cell of [row.Verdict, row.Reason]) {
        const m = String(cell ?? '').match(re);
        if (m) return { date: m[2], approx: Boolean(m[1]) };
    }
    return { date: String(row['Last checked'] ?? '').match(DATE)?.[0] ?? '', approx: true };
};
export const appliedDate = dateFor('Applied');
export const rejectedDate = dateFor('Rejected');

function fromRow(row, columns) {
    const rec = blankCompany(row.Company);
    for (const [col, f] of Object.entries(FIELDS)) rec[f] = row[col] ?? '';
    rec.stance = STANCE[row.Status] ?? '';
    rec.lastChecked = String(row['Last checked'] ?? '').match(DATE)?.[0] ?? String(row['Last checked'] ?? '');
    rec.rolesSkipped = splitRoles(row['Roles skipped']);
    const info = { approx: null, notRecorded: false };
    if (row.Status === 'Applied' || row.Status === 'Rejected') {
        const i = rec.rolesSkipped.findIndex((e) => /\(applied/i.test(e));
        const role = i >= 0 ? rec.rolesSkipped[i].replace(/\s*\([^)]*\bapplied[^)]*\)/i, '').trim() : '';
        if (i >= 0) rec.rolesSkipped.splice(i, 1);
        const applied = appliedDate(row);
        const rejected = row.Status === 'Rejected' ? rejectedDate(row) : null;
        const app = { id: `mig:${rec.key}:1`, ...(role && { leadKey: leadKey(row.Company, role) }), role: role || NOT_RECORDED, appliedOn: applied.date, outcome: row.Status === 'Applied' ? 'applied' : 'rejected' };
        if (rejected) app.outcomeOn = rejected.date;
        if (applied.approx || rejected?.approx) app.approx = true;
        rec.applications.push(app);
        info.approx = app.approx ? `${row.Company}: ${app.outcome} ${rejected ? rejected.date : applied.date}` : null;
        info.notRecorded = !role;
    }
    const bad = rowCells(row).length !== columns.length;
    return { rec, bad, info };
}

// Absorb row b into a: a keeps its values, b fills blanks, and anything that differs is kept as an event.
function absorb(a, b, diffs) {
    const diff = [];
    for (const f of [...Object.values(FIELDS), 'website', 'size', 'funding', 'facts']) {
        if (!b[f]) continue;
        if (!a[f]) a[f] = b[f];
        else if (a[f] !== b[f]) diff.push(`${f}: ${b[f]}`);
    }
    if (!a.stance) a.stance = b.stance;
    else if (b.stance && a.stance !== b.stance) diff.push(`stance: ${b.stance}`);
    for (const r of b.rolesSkipped) if (!a.rolesSkipped.includes(r)) a.rolesSkipped.push(r);
    for (const app of b.applications) a.applications.push({ ...app, id: `mig:${a.key}:${a.applications.length + 1}` });
    for (const n of [b.name, ...b.aliases]) if (!a.aliases.includes(n) && n !== a.name) a.aliases.push(n);
    for (const k of b.distinctFrom) if (!a.distinctFrom.includes(k)) a.distinctFrom.push(k);
    if (diff.length) diffs.push(`${a.name} <- ${b.name}: ${diff.join('; ')}`);
    a.events.push({ date: b.lastChecked, text: `Merged ledger row "${b.name}"${diff.length ? ` (differing: ${diff.join('; ')})` : ''}` });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word, case-sensitive: "Linear" the company must not match "linear" in prose.
const wordRe = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'gu');
// Variants shorter than 4 characters never match on their own.
const nameVariants = (r) => [...new Set([r.name, ...r.aliases]
    .flatMap((n) => [n.replace(/\([^)]*\)/g, ' ').trim(), ...n.replace(/\([^)]*\)/g, ' ').split(' / ').map((x) => x.trim())])
    .filter((n) => n.length >= 4))];

// Lines of a section naming each company. A match inside a longer match of another company ("Quillfeather" in "Quillfeather PBC") is dropped.
function filedLines(lines, matchers) {
    const out = new Map();
    for (const line of lines) {
        const found = [];
        for (const m of matchers) for (const re of m.res) for (const x of line.matchAll(re)) found.push({ m, start: x.index, end: x.index + x[0].length });
        for (const f of found) {
            if (found.some((g) => g.m !== f.m && g.start <= f.start && g.end >= f.end && g.end - g.start > f.end - f.start)) continue;
            if (!out.has(f.m.rec)) out.set(f.m.rec, []);
            const l = out.get(f.m.rec);
            if (l.at(-1) !== line) l.push(line);
        }
    }
    return out;
}

const cap = (t, n = 600) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const splitHistory = (md) => {
    const parts = md.split(/^## /m);
    const out = [];
    if (parts[0].trim()) out.push({ heading: '(preamble)', text: parts[0].trim() });
    for (const p of parts.slice(1)) {
        const nl = p.indexOf('\n');
        out.push({ heading: (nl < 0 ? p : p.slice(0, nl)).trim(), text: (nl < 0 ? '' : p.slice(nl + 1)).trim() });
    }
    return out;
};


const LEVELS = new Set(['intern', 'junior', 'mid', 'senior', 'sr', 'staff', 'principal', 'lead', 'distinguished', 'architect']);
const senior = (t) => squash(String(t).replace(/\bsr\b\.?/gi, 'senior'));
const levels = (text) => [...new Set((String(text).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => LEVELS.has(w)).map((w) => (w === 'sr' ? 'senior' : w)))].sort().join(',');

// The one posting a Roles skipped entry is about, or undefined when none or several could be.
// A requisition or board id in the entry decides alone; else exact role, then sameRole on the part before any parenthesis.
function matchPosting(entry, postings) {
    const ids = String(entry).match(/\b(?:J?REQ|JR|R)[-_]?\d{3,}\b|\b\d{7,}\b/gi);
    if (ids) {
        const hit = postings.filter((p) => ids.some((i) => p.id.toLowerCase().includes(i.toLowerCase())));
        return hit.length === 1 ? hit[0] : undefined;
    }
    const part = String(entry).split('(')[0];
    const e = senior(part);
    if (!e) return undefined;
    // A different seniority is a different role, whatever the rest of the words say.
    const roles = postings.filter((p) => senior(p.role) && levels(p.role) === levels(part));
    for (const hit of [roles.filter((p) => senior(p.role) === e), roles.filter((p) => sameRole(e, senior(p.role)))]) if (hit.length === 1) return hit[0];
    return undefined;
}

const byFinished = (a, b) => a.report.finishedAt.localeCompare(b.report.finishedAt);

// Ledger-row view of a company's fields, as the old board compared and proposed them.
const ROW_FIELD = { status: 'stance', verdict: 'verdict', fingerprint: 'fingerprint', domain: 'domain', awards: 'awards', reason: 'reason', recheck_trigger: 'recheckTrigger', roles_skipped: 'rolesSkipped' };
const COL_FIELD = { Status: 'stance', Verdict: 'verdict', Fingerprint: 'fingerprint', Domain: 'domain', Awards: 'awards', Reason: 'reason', 'Re-check trigger': 'recheckTrigger', 'Roles skipped': 'rolesSkipped' };

// Old status text -> a stance change, or null when it is not one (Applied, Rejected become applications, not stances).
const stanceOf = (status) => (['Applied', 'Rejected'].includes(status) ? null : STANCE[status] ?? null);

// One row-shaped record -> field-level values for the new model. `cols` names the keys.
function fieldsOf(rec, cols) {
    const out = {};
    for (const [k, f] of Object.entries(cols)) {
        if (rec?.[k] === undefined) continue;
        if (f === 'stance') { const s = stanceOf(rec[k]); if (s) out.stance = s; } else if (f === 'rolesSkipped') out.rolesSkipped = splitRoles(rec[k]); else out[f] = String(rec[k] ?? '');
    }
    return out;
}

// Only fields that would change the company; rolesSkipped is add-only.
function diffFields(company, proposed) {
    const out = {};
    for (const [f, v] of Object.entries(proposed)) {
        if (!MODEL_FIELDS.includes(f)) continue;
        if (f === 'rolesSkipped') { const add = v.filter((r) => !company.rolesSkipped.includes(r)); if (add.length) out[f] = add; } else if ((company[f] ?? '') !== v) out[f] = v;
    }
    return out;
}

const baseOf = (company, fields) => Object.fromEntries(Object.keys(fields).map((f) => [f, company[f] ?? (f === 'rolesSkipped' ? [] : '')]));

const sameRow = (a, b) => COLUMNS.every((c) => c === 'Last checked' || (a?.[c] ?? '') === (b?.[c] ?? ''));

// What the old board's Needs you tab would show: disputes and held changes from the 10 newest runs, and open Ask proposals.
export function oldPending({ ledgerMd, reports = [], threads = [] }) {
    const rows = parseLedger(ledgerMd).rows;
    const rowOf = (company) => rows.find((r) => sameCompany(r.Company, company)) ?? null;
    const newest = [...reports].sort(byFinished).reverse().slice(0, OLD_BOARD_RUNS);
    const disputed = [];
    const held = [];
    const seenLeads = new Set();
    const seenHeld = [];
    for (const { run, report } of newest) {
        for (const l of [...(report.leads ?? []), ...(report.nearMisses ?? [])]) {
            if (!l.disputed || seenLeads.has(l.key)) continue;
            seenLeads.add(l.key);
            const row = rowOf(l.company);
            const skipped = Boolean(squash(l.role)) && splitRoles(row?.['Roles skipped']).map(squash).some((r) => r && sameRole(r, squash(l.role)));
            if (!PROTECTED.includes(row?.Status) && !skipped) disputed.push({ run, company: l.company, key: l.key, role: l.role, url: l.url });
        }
        for (const c of report.held ?? []) {
            if (seenHeld.some((x) => sameCompany(x, c.company))) continue;
            seenHeld.push(c.company);
            if (!c.kept && sameRow(rowOf(c.company), c.before)) held.push({ run, ...c });
        }
    }
    const proposals = [];
    for (const t of threads) t.messages?.forEach((m) => { if (m.proposal?.status === 'open') proposals.push({ company: t.company, by: m.by, at: m.at, text: m.text, patch: m.proposal.patch }); });
    return { disputed, held, proposals };
}

export function migrate({ ledgerMd, historyMd = '', reports = [], aliases = {}, threads = [], attach = attachRun }) {
    const { columns, rows } = parseLedger(ledgerMd);
    const badRows = [];
    const approxDates = [];
    const notRecorded = [];
    const origStatus = new Map();
    let list = rows.map((row) => {
        const { rec, bad, info } = fromRow(row, columns);
        if (bad) badRows.push(rec.name);
        if (info.approx) approxDates.push(info.approx);
        if (info.notRecorded) notRecorded.push(rec.name);
        origStatus.set(row.Company, row.Status);
        return rec;
    });

    // Identity from the owner's aliases file.
    const merges = [];
    const diffs = [];
    for (const [first, second] of aliases.same ?? []) {
        const a = findCompany(list, first) ?? findCompany(list, second);
        if (!a) continue;
        const b = list.find((r) => r !== a && (findCompany([r], second) || findCompany([r], first)));
        if (b) {
            absorb(a, b, diffs);
            list = list.filter((r) => r !== b);
            merges.push(`${b.name} into ${a.name}`);
        } else if (!findCompany([a], second)) a.aliases.push(second);
    }
    for (const [x, y] of aliases.different ?? []) {
        const a = findCompany(list, x);
        const b = findCompany(list, y);
        if (a && !a.distinctFrom.includes(companyKey(y))) a.distinctFrom.push(companyKey(y));
        if (b && !b.distinctFrom.includes(companyKey(x))) b.distinctFrom.push(companyKey(x));
    }
    const ledgerNames = list.map((c) => c.name);

    // Replay every report, oldest first. Finds are counted independently of attachRun so the gate can catch drops.
    const ordered = [...reports].sort(byFinished);
    let state = { companies: list, postings: [] };
    const seen = new Set();
    const finds = { in: 0, merged: [], companyOnly: [], ids: new Set() };
    for (const { run, report } of ordered) {
        const leads = report.leads ?? [];
        const nearMisses = report.nearMisses ?? [];
        for (const [item, isLead] of [...leads.map((l) => [l, true]), ...nearMisses.map((l) => [l, false])]) {
            finds.in++;
            if (findKind(item, isLead) === 'company') { finds.companyOnly.push(`${item.company}: ${item.role} (${run})`); continue; }
            const id = postingId(item);
            finds.ids.add(id);
            if (seen.has(id)) finds.merged.push(`${id} (${item.company}, ${run})`);
            seen.add(id);
        }
        const out = attach(state, { run, leads, nearMisses, newAllowance: 0 });
        state = { companies: out.companies, postings: out.postings };
    }
    list = state.companies;
    const postings = state.postings;
    const extraCompanies = list.filter((c) => !ledgerNames.includes(c.name)).map((c) => c.name);

    // Roles skipped that match a posting at that company become skipped jobs.
    let skippedJobs = 0;
    for (const c of list) {
        const mine = postings.filter((p) => companyOf([c], p) === c);
        c.rolesSkipped = c.rolesSkipped.filter((entry) => {
            const p = matchPosting(entry, mine);
            if (!p || jobEntry(c, p)) return true;
            c.jobs[p.id] = { state: 'skipped', role: p.role, note: entry, leadKey: p.leadKey, ...(p.url && { url: p.url }), at: c.lastChecked || p.lastRun.slice(0, 10) };
            skippedJobs++;
            return false;
        });
    }

    // Leads from the three newest runs stay new; older undisputed ones are saved.
    const newest = new Set(ordered.slice(-NEWEST_RUNS).map((r) => r.run));
    const pending = oldPending({ ledgerMd, reports, threads });
    // An open dispute on the old board stays in New whatever its age.
    const openDispute = (p) => pending.disputed.some((d) => p.id === postingId(d) || (d.key && p.leadKey === d.key));
    let savedJobs = 0;
    for (const p of postings) {
        const c = companyOf(list, p);
        if (!c || !p.wasLead || p.disputed || newest.has(p.lastRun) || openDispute(p) || isProtected(c) || jobEntry(c, p) || applicationFor(c, p)) continue;
        c.jobs[p.id] = { state: 'saved', role: p.role, leadKey: p.leadKey, ...(p.url && { url: p.url }), at: p.lastRun.slice(0, 10) };
        savedJobs++;
    }

    // Active lead rows nothing else covers get one saved job on a stub posting.
    const stubs = [];
    rows.forEach((row) => {
        if (row.Status !== 'Active lead') return;
        const c = findCompany(list, row.Company);
        if (!c || hasActiveLead(c, postings)) return;
        const id = postingId({ company: c.name, role: NOT_RECORDED });
        const lk = leadKey(c.name, NOT_RECORDED);
        postings.push({ ...blankPosting({ id, companyKey: c.key, leadKey: lk, role: NOT_RECORDED, url: '', source: 'migration' }), wasLead: true, modelSays: 'lead', posted: 'unknown' });
        c.jobs[id] = { state: 'saved', role: NOT_RECORDED, leadKey: lk, at: c.lastChecked };
        stubs.push(c.name);
    });

    // Pending decisions, as field-level updates with base taken from the current row.
    const lost = [];
    for (const h of pending.held) {
        let c = findCompany(list, h.company);
        // A held find for a company the ledger doesn't have yet: keep it as a new company waiting on the owner.
        if (!c && h.before == null) { c = blankCompany(h.company); list.push(c); }
        const models = ['claude', 'codex'].filter((m) => h[m]);
        const sources = models.length ? models.map((m) => [m, h[m]]) : [[['claude', 'codex'].includes(h.by) ? h.by : 'claude', h.after]];
        const proposed = {};
        for (const [m, r] of sources) { const f = diffFields(c ?? blankCompany(h.company), fieldsOf(r, COL_FIELD)); if (Object.keys(f).length) proposed[m] = f; }
        if (!c || !Object.keys(proposed).length) { lost.push(`held change for ${h.company}`); continue; }
        const fields = [...new Set(Object.values(proposed).flatMap(Object.keys))];
        c.heldUpdate = { run: h.run, reason: h.reason ?? '', base: baseOf(c, Object.fromEntries(fields.map((f) => [f, 1]))), proposed };
    }
    for (const p of pending.proposals) {
        const c = findCompany(list, p.company);
        const changes = c ? diffFields(c, fieldsOf(p.patch, ROW_FIELD)) : {};
        if (!c || !Object.keys(changes).length) { lost.push(`proposal for ${p.company}`); continue; }
        const text = String(p.text ?? '').trim().split('\n')[0].slice(0, 300);
        c.proposals.push({ id: fnv1a(p.by + p.at + JSON.stringify(changes)), by: p.by, at: p.at, text, base: baseOf(c, changes), changes });
    }

    // History: conservative whole-word filing.
    const sections = splitHistory(historyMd);
    const unfiled = [];
    const matchers = list.map((rec) => ({ rec, res: nameVariants(rec).map(wordRe) }));
    const filed = new Map();
    let onManyCompanies = 0;
    for (const s of sections) {
        const hits = filedLines([s.heading, ...s.text.split('\n')], matchers);
        if (!hits.size) { unfiled.push(s); continue; }
        if (hits.size >= 3) onManyCompanies++;
        for (const [r, lines] of hits) {
            if (!filed.has(r.key)) filed.set(r.key, []);
            filed.get(r.key).push({ heading: s.heading, text: cap([s.heading, ...lines.filter((l) => l !== s.heading)].join('\n')) });
        }
    }
    const history = [...filed].map(([key, hrows]) => ({ companyKey: key, rows: hrows })).sort((a, b) => (a.companyKey < b.companyKey ? -1 : 1));

    // Name pairs that still look like duplicates.
    const unresolved = new Set();
    for (const r of list) {
        const dup = possibleDuplicate(list.filter((o) => o !== r), r.name);
        if (dup) { unresolved.add(r.name); unresolved.add(dup.name); }
    }

    return {
        companies: list,
        postings,
        history,
        unfiled,
        report: {
            rows: { in: rows.length, out: rows.filter((r) => findCompany(list, r.Company)).length, merges },
            finds: { in: finds.in, postings: finds.ids.size, merged: finds.merged, companyOnly: finds.companyOnly, ids: [...finds.ids] },
            history: { sections: sections.length, filed: sections.length - unfiled.length, unfiled: unfiled.length, onManyCompanies, rows: history.reduce((n, h) => n + h.rows.length, 0) },
            counts: {
                companies: list.length,
                postings: postings.length,
                applied: list.reduce((n, c) => n + c.applications.filter((a) => a.outcome === 'applied').length, 0),
                rejected: list.reduce((n, c) => n + c.applications.filter((a) => a.outcome === 'rejected').length, 0),
                activeLeadStubs: stubs.length,
                skippedJobs,
                savedJobs,
                held: list.filter((c) => c.heldUpdate).length,
                proposals: list.reduce((n, c) => n + c.proposals.length, 0),
            },
            stubs,
            openLeads: rows.filter((r) => r.Status === 'Watching' && findCompany(list, r.Company) && hasActiveLead(findCompany(list, r.Company), postings)).map((r) => r.Company),
            possiblyApplied: list.filter((c) => notRecorded.includes(c.name) && c.rolesSkipped.length).map((c) => `${c.name}: ${c.rolesSkipped.join('; ')}`),
            approxDates,
            notRecorded,
            extraCompanies,
            lost,
            diffs,
            badRows,
            unresolved: [...unresolved].sort(),
        },
    };
}

const statusOf = (row) => row.Status;

// The gate. Empty means every check holds. `oldPending` is the old board's pending list (see oldPending()).
export function problems(result, { ledgerMd, oldPending: pending = { disputed: [], held: [], proposals: [] }, hashBefore, hashAfter }) {
    const out = [];
    const { companies, postings, report } = result;
    const { rows } = parseLedger(ledgerMd);

    for (const r of rows) if (!findCompany(companies, r.Company)) out.push(`ledger row has no record: ${r.Company}`);
    for (const n of report.extraCompanies ?? []) out.push(`a find created a company that is not in the ledger: ${n}`);

    const ids = new Set(postings.map((p) => p.id));
    for (const id of report.finds.ids) if (!ids.has(id)) out.push(`find has no posting: ${id}`);
    if (report.finds.in !== report.finds.ids.length + report.finds.merged.length + report.finds.companyOnly.length) out.push(`finds in ${report.finds.in} != postings ${report.finds.ids.length} + merged ${report.finds.merged.length} + company-only ${report.finds.companyOnly.length}`);

    const queue = newQueue(companies, postings);
    for (const d of pending.disputed) {
        const p = postings.find((x) => x.id === postingId(d) || (d.key && x.leadKey === d.key));
        if (!p || !queue.some((q) => ['dispute', 'lead'].includes(q.kind) && q.postingId === p.id)) out.push(`open dispute is not in New: ${d.company}, ${d.role}`);
    }
    for (const p of pending.proposals) {
        const had = pending.proposals.filter((x) => sameCompany(x.company, p.company)).length;
        if (queue.filter((q) => q.kind === 'proposal' && sameCompany(q.company, p.company)).length < had) out.push(`Ask proposal is not in New: ${p.company}`);
    }
    for (const l of report.lost ?? []) out.push(`pending decision could not be carried over: ${l}`);

    for (const r of rows.filter((x) => x.Status === 'Active lead')) {
        const c = findCompany(companies, r.Company);
        if (c && !hasActiveLead(c, postings)) out.push(`Active lead row has no Active lead tag: ${r.Company}`);
    }
    for (const c of companies) for (const a of c.applications ?? []) if (!a.role || !a.appliedOn) out.push(`application without a ${a.role ? 'date' : 'role'}: ${c.name}`);

    const exported = parseLedger(exportLedger(companies, postings)).rows;
    for (const r of rows) {
        const want = statusOf(r) === 'Skip current role' ? 'Watching' : statusOf(r);
        const c = findCompany(companies, r.Company);
        const got = exported.find((x) => x.Company === c?.name);
        // A Watching row whose company has an open lead may export as Active lead; nothing else may differ.
        if (r.Status === 'Watching' && got?.Status === 'Active lead' && c && hasActiveLead(c, postings)) continue;
        if (!got || got.Status !== want) out.push(`export Status differs for ${r.Company}: expected "${want}", got "${got?.Status ?? 'no row'}"`);
    }

    if (report.unresolved.length) out.push(`unresolved name pairs: ${report.unresolved.join(', ')}`);
    if (hashBefore !== undefined && hashBefore !== hashAfter) out.push(`ledger.md changed during the migration (${hashBefore} -> ${hashAfter})`);
    return out;
}
