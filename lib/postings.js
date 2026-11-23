import { blankCompany, findCompany, possibleDuplicate } from './companies.js';
import { CAPS } from './caps.js';
import { sameCompany } from './keys.js';
import { blankPosting } from './postingsFile.js';
import { boardId, postingId, sameLink } from './postingId.js';
import { isProtected, jobEntry, applicationFor, companyOf } from './tags.js';

// A find is a role (gets a posting) or company-only (no posting). Board id wins, then the model's kind, then the verdict.
// A "role" like "No qualifying opening" is a note about the company, never a job, whatever the model says.
const NO_ROLE = /^(no|none|n\/a|not)\b|\b(no (qualifying|current|open|engineering|matching) (opening|role|position)s?)\b/i;
export const findKind = (lead, isLead) => (!String(lead.role ?? '').trim() || NO_ROLE.test(String(lead.role).trim()) ? 'company' : boardId(lead.url) ? 'role' : lead.kind ?? (isLead ? 'role' : 'company'));

// Run names sort by date, then by the HHMM suffix when there is one ("2026-11-16-daily-1000").
const order = (r) => String(r).slice(0, 10) + (String(r).match(/-(\d{4,6})$/)?.[1] ?? '');

// Pure: returns new companies and postings, never mutates the input. Idempotent per run.
export function attachRun({ companies, postings }, { run, leads = [], nearMisses = [], newestRunOf = (p) => p.lastRun, models = ['claude', 'codex'], newAllowance = CAPS.newCompanies, blocked = [] }) {
    let allowance = newAllowance;
    const over = new Set();
    const cos = structuredClone(companies);
    const posts = structuredClone(postings);
    const notes = [];
    // Company facts a find filled in, logged like patch changes so Undo covers them.
    const changes = [];
    const items = [...leads.map((l) => [l, true]), ...nearMisses.map((l) => [l, false])];
    for (const [lead, isLead] of items) {
        let co = findCompany(cos, lead.company);
        if (!co) {
            // Shared limit with the patches: no company or posting for a find past it (blocked names were already refused).
            if (blocked.some((n) => sameCompany(n, lead.company))) continue;
            if (allowance <= 0) {
                if (!over.has(lead.company)) notes.push(`${lead.company}: over the ${CAPS.newCompanies}-new-companies limit`);
                over.add(lead.company);
                continue;
            }
            allowance--;
            co = { ...blankCompany(lead.company), newFromRun: true };
            const dup = possibleDuplicate(cos, lead.company);
            if (dup) co.possibleDuplicateOf = dup.key;
            cos.push(co);
        }
        if (co.stance === 'Ruled out') continue;
        if (!isProtected(co)) {
            const fields = {};
            for (const f of ['size', 'founded', 'facts', 'domain']) if (!co[f] && lead[f]) { fields[f] = { from: co[f] ?? '', to: lead[f] }; co[f] = lead[f]; }
            if (Object.keys(fields).length) changes.push({ company: co.name, by: lead.foundBy ?? 'run', fields });
        }
        if (findKind(lead, isLead) === 'company') continue;

        const id = postingId(lead);
        // The same job link at the company is the same job, whatever the model called the role this time.
        let p = posts.find((x) => x.id === id) ?? sameLink(posts, co.key, lead.url);
        if (p && order(run) < order(newestRunOf(p))) {
            // An older run never moves a posting backward.
            if (!p.firstRun || order(run) < order(p.firstRun)) p.firstRun = run;
            continue;
        }
        if (!p) {
            p = blankPosting({ id, companyKey: co.key, leadKey: lead.key, role: lead.role, url: lead.url ?? '', source: 'run' });
            p.firstRun = run;
            posts.push(p);
        } else {
            const owner = companyOf(cos, p);
            if (owner !== co) notes.push(`${id} reported under ${lead.company}, kept under ${owner?.name ?? p.companyKey}`);
            if (!p.firstRun) p.firstRun = run;
            // Owner-touched postings and finds under another company name keep their identity fields.
            if (owner === co && !(jobEntry(owner, p) || applicationFor(owner, p))) {
                if (lead.role) p.role = lead.role;
                if (lead.url) p.url = lead.url;
                p.leadKey = lead.key;
            }
        }
        p.lastRun = run;
        p.runs = [...new Set([...(p.runs ?? []), run])].slice(-20); // review history; the job page lists the earlier ones
        if (lead.pay) p.pay = lead.pay;
        if (lead.fit) p.fit = lead.fit;
        if (lead.payEstimate) p.payEstimate = lead.payEstimate; // unverified; the page shows it as "Est." when pay is empty
        p.modelSays = isLead ? 'lead' : 'pass';
        p.wasLead ||= isLead;
        delete p.disputed;
        for (const m of models) {
            const op = lead.opinions?.[m] ?? lead[m];
            if (op?.verdict) p.verdicts[m] = String(op.verdict).slice(0, 100);
        }
    }
    return { companies: cos, postings: posts, notes, changes };
}
