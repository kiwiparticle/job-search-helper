import { CompanyLink } from './CompanyLink';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { findCompany } from '../../../lib/companies.js';
import { useAct, useCompanies, usePostings, useReport, useRuns, useUnfiled } from '../data';
import { formatDuration } from '../format';
import type { Company, Posting, Report, RunLead } from '../model';
import { ExtLink, PostingLink, RichText } from '../text';
import { opinionsOf, runModelsText, useModels } from '../models';
import { failedSearchers } from '../status';
import { Tabs } from '@base-ui/react/tabs';
import { Button, Choice } from './ui';

const when = (run: string) => run.slice(0, 10);

// How the search did on jobs the owner added by hand: did it miss them, or see them first?
function Coverage() {
    const { data: companies = [] } = useCompanies();
    const counts: Record<string, number> = {};
    for (const c of companies) for (const j of Object.values(c.jobs ?? {})) if (j.coverage) counts[j.coverage] = (counts[j.coverage] ?? 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) return null;
    const parts = [['unseen', 'the search never saw'], ['unjudged', 'found on a board, not judged yet'], ['filtered', 'your sweep filter dropped'], ['passed', 'a model passed on'], ['lead', 'already a lead']]
        .filter(([k]) => counts[k]).map(([k, text]) => `${counts[k]} ${text}`);
    return <p className="muted">Jobs you added by hand: {total}. {parts.join(', ')}.</p>;
}

export function RunsPage() {
    const { data: runs, isPending, isError } = useRuns();
    const { data: unfiled = [] } = useUnfiled();
    const { label } = useModels();
    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>;
    return (
        <>
            <div className="head"><h1>Runs</h1><p className="muted">What each search found, newest first.</p></div>
            <Coverage />
            {runs.length === 0 ? <p className="empty">No runs yet. Start one from the bar above.</p> : (
                <div className="table-box">
                    <table className="list">
                        <thead><tr><th scope="col">Run</th><th scope="col">Date</th><th scope="col">Workflow</th><th scope="col">Models</th><th scope="col">Took</th><th scope="col">Leads</th><th scope="col">Skipped</th><th scope="col">Changes</th><th scope="col">GitHub</th></tr></thead>
                        <tbody>
                            {runs.map((r) => (
                                <tr key={r.run}>
                                    <td><Link to={`/runs/${r.run}`}>{r.run}</Link>{failedSearchers(r.models).length > 0 && <> <span className="tag tag-bad">{failedSearchers(r.models).length} failed</span></>}</td>
                                    <td className="nowrap small num">{when(r.run)}</td>
                                    <td>{r.workflow}</td>
                                    <td className="small">{runModelsText(r.models, r.reviewers, label)}</td>
                                    <td className="nowrap small">{formatDuration(r.durationMs)}</td>
                                    <td className="num">{r.counts?.leads ?? 0}</td>
                                    <td className="num">{r.counts?.nearMisses ?? 0}</td>
                                    <td className="num">{r.counts?.changes ?? 0}</td>
                                    <td className="small">{r.ghUrl && <ExtLink href={r.ghUrl}>log</ExtLink>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {unfiled.length > 0 && (
                <section className="section unfiled">
                    <h2>Unfiled history</h2>
                    <p className="muted small">Old notes the migration could not file under a company.</p>
                    {unfiled.map((u, i) => <div key={i} className="stack"><h3>{u.heading}</h3><p className="prose">{u.text}</p></div>)}
                </section>
            )}
        </>
    );
}

// A searcher that didn't finish ok contributed nothing to this run: say which and why, above the results.
export function SearcherFailures({ report }: { report: Report }) {
    const { label } = useModels();
    const failed = failedSearchers(report.models);
    if (!failed.length) return null;
    return (
        <ul className="plain run-failed" role="status">
            {failed.map(([id, m]) => <li key={id}><strong>{label(id)}</strong> {m.status}, so it added nothing{m.reason && <>: {m.reason}</>}.</li>)}
        </ul>
    );
}

// Names a lead's company page, and its job page when the company holds a posting with the same lead key.
function LeadLinks({ lead, companies, postings }: { lead: RunLead; companies: Company[]; postings: Posting[] }) {
    const company = findCompany(companies, lead.company) as Company | undefined;
    const posting = postings.find((p) => p.companyKey === company?.key && p.leadKey === lead.key);
    return (
        <>
            {company ? <CompanyLink company={company}><strong>{lead.company}</strong></CompanyLink> : <strong>{lead.company}</strong>}
            {posting
                ? <div><Link to={`/jobs/${posting.id}`}>{lead.role}</Link></div>
                : <div className="meta">{lead.role}</div>}
            <PostingLink url={lead.url} />
        </>
    );
}


export function LeadsTable({ rows, companies, why }: { rows: RunLead[]; companies: Company[]; why?: boolean }) {
    const { data: postings = [] } = usePostings();
    const { label } = useModels();
    const finder = (l: RunLead) => (l.foundBy === 'both' ? 'Both' : label(l.foundBy));
    return (
        <div className="table-box">
            <table className="list">
                <thead><tr><th scope="col">Company and role</th><th scope="col">Pay</th>{why && <th scope="col">Why skipped</th>}<th scope="col">Found by</th></tr></thead>
                <tbody>
                    {rows.map((l) => (
                        <tr key={l.key}>
                            <td><LeadLinks lead={l} companies={companies} postings={postings} /></td>
                            <td className="small">{l.pay || 'No salary posted'}</td>
                            {why && <td className="small">{String(opinionsOf(l).find(([, v]) => v.note)?.[1].note ?? '')}</td>}
                            <td className="nowrap small">{finder(l)}{l.disputed && <> <span className="tag">Models disagree</span></>}{l.reviewed === false && <> <span className="tag">Unreviewed</span></>}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ChangesList({ run, report, companies }: { run: string; report: Report; companies: Company[] }) {
    const act = useAct();
    const { label } = useModels();
    const companyLink = (name: string) => {
        const c = findCompany(companies, name) as Company | undefined;
        return c ? <CompanyLink company={c}><strong>{name}</strong></CompanyLink> : <strong>{name}</strong>;
    };
    const show = (v: unknown) => (Array.isArray(v) ? v.join('; ') : String(v ?? '') || 'empty');
    // Runs before 2026-11-20 may still list held changes.
    const held = (report.held ?? []).filter((c) => !c.kept);
    if (!report.changes.length && !held.length && !report.refused.length) return <p className="empty">No ledger changes this run.</p>;
    return (
        <ul className="changes">
            {held.map((c) => (
                <li key={`h|${c.company}`}><div className="what">{companyLink(c.company)}<span className="meta">Held for you: {c.reason ?? 'models disagree'}. Decide it under New.</span></div></li>
            ))}
            {report.changes.map((c) => {
                // New shape: fields is { name: { from, to } }. Anything else is from before the redesign.
                const fields = c.fields && !Array.isArray(c.fields) ? Object.entries(c.fields) : null;
                return (
                    <li key={`c|${c.company}`}>
                        <div className="what">
                            {companyLink(c.company)}
                            {fields ? <ul className="plain">{fields.map(([f, { from, to }]) => <li key={f}><strong>{f}: </strong>{show(from)} → {show(to)}</li>)}</ul> : <span className="meta">From before the redesign</span>}
                            {c.reason && <span className="meta">Applied. <RichText text={c.reason} /></span>}
                        </div>
                        {fields && <Button title="Revert this run's change to the company, if nothing has changed it since." type="button" onClick={() => act({ type: 'undo', run, company: c.company }, `Undid the change to ${c.company}.`)}>Undo</Button>}
                    </li>
                );
            })}
            {report.refused.map((c) => (
                <li key={`r|${c.company}`}>
                    <div className="what">{companyLink(c.company)}<span className="meta">Not changed: {c.reason}. {label(c.by ?? '')} wanted {c.after?.Status ?? 'an edit'}.</span></div>
                </li>
            ))}
        </ul>
    );
}

const TABS = [['leads', 'Leads'], ['skipped', 'Skipped'], ['changes', 'Ledger changes']] as const;

// One run: pick it in the title bar, then look at what it found, what it skipped and what it changed.
export function RunPage() {
    const { run = '' } = useParams();
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const { data: runs = [] } = useRuns();
    const { data: companies = [] } = useCompanies();
    const { data: report, isPending, isError } = useReport(run);
    const { label } = useModels();

    const tab = TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'leads';
    const at = runs.findIndex((r) => r.run === run);
    const go = (name: string | undefined) => name && navigate({ pathname: `/runs/${name}`, search: params.toString() ? `?${params}` : '' });
    const counts = { leads: report?.leads.length, skipped: report?.nearMisses.length, changes: report && report.changes.length + (report.held ?? []).filter((c) => !c.kept).length };

    return (
        <section className="viewer" aria-label="Run viewer">
            <div className="viewer-bar">
                <div className="stepper">
                    <Button type="button" aria-label="Older run" title="Older run" disabled={at < 0 || at >= runs.length - 1} onClick={() => go(runs[at + 1]?.run)}>◀</Button>
                    <Choice label="Run to show" value={run} onChange={go} options={[...(at < 0 ? [{ value: run, label: run }] : []), ...runs.map((r) => ({ value: r.run, label: r.run }))]} />
                    <Button type="button" aria-label="Newer run" title="Newer run" disabled={at <= 0} onClick={() => go(runs[at - 1]?.run)}>▶</Button>
                </div>
                {report && (
                    <span className="meta">
                        {report.workflow}, finished {new Date(report.finishedAt).toLocaleString()}{report.durationMs != null && `, took ${formatDuration(report.durationMs)}`}{report.models && Object.keys(report.models).length > 0 && `. ${runModelsText(report.models, report.reviewers, label)}`}
                    </span>
                )}
                {report?.ghUrl && <ExtLink href={report.ghUrl}>GitHub run</ExtLink>}
                <Link to="/runs" className="small">All runs</Link>
            </div>
            {report && <SearcherFailures report={report} />}
            <Tabs.Root value={tab} onValueChange={(id) => setParams({ tab: id }, { replace: true })}>
            <Tabs.List className="folder" aria-label="Run results">
                {TABS.map(([id, label]) => (
                    <Tabs.Tab key={id} value={id}>
                        {label}<span className="n">{counts[id] ?? ''}</span>
                    </Tabs.Tab>
                ))}
            </Tabs.List>
            <Tabs.Panel value={tab} className="viewer-body">
                {isPending ? <p className="empty">Loading…</p>
                    : isError || !report ? <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>
                        : tab === 'leads' ? (report.leads.length ? <LeadsTable rows={report.leads} companies={companies} /> : <p className="empty">No leads this run.</p>)
                            : tab === 'skipped' ? (report.nearMisses.length ? <LeadsTable rows={report.nearMisses} companies={companies} why /> : <p className="empty">Nothing was skipped this run.</p>)
                                : <ChangesList run={run} report={report} companies={companies} />}
            </Tabs.Panel>
            </Tabs.Root>
        </section>
    );
}
