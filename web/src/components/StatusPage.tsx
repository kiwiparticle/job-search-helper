import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CompanyLink } from './CompanyLink';
import { describeRun, useActivity, useCompanies, usePostings, useRuns, type ActivityRun } from '../data';
import type { RunSummary } from '../model';
import { useModels } from '../models';
import { STATUS_SEEN_KEY, dismissRun, failedSearchers, readDismissed, runsWithFailedSearchers } from '../status';
import { ExtLink } from '../text';

const ago = (iso: string) => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};

const outcome = (r: ActivityRun) =>
    r.conclusion === 'success' ? 'Done' : r.conclusion === 'cancelled' ? 'Cancelled' : r.conclusion === 'skipped' ? 'Skipped' : 'Failed';

// What a run is, in words: "Revising a resume: Acme | Staff Engineer", or the workflow's own title.
// The company and role link to their pages when the data has them.
export function RunLabel({ title, fallback }: { title?: string; fallback?: string }) {
    const d = describeRun(title);
    const companies = useCompanies().data ?? [];
    const postings = usePostings().data ?? [];
    if (!d) return <>{title ?? fallback}</>;
    const company = companies.find((c) => c.name.toLowerCase() === d.company.toLowerCase());
    const posting = company && d.role ? postings.find((p) => p.companyKey === company.key && p.role.toLowerCase() === d.role!.toLowerCase()) : undefined;
    return (
        <>
            {d.what}: {company ? <CompanyLink company={company}><strong>{d.company}</strong></CompanyLink> : <strong>{d.company}</strong>}
            {d.role && <> | {posting ? <Link to={`/jobs/${posting.id}`}>{d.role}</Link> : d.role}</>}
        </>
    );
}

// One line of what a finished search found, from its stored report.
const result = (c: NonNullable<RunSummary['counts']>) => `${c.leads ?? 0} leads · ${c.nearMisses ?? 0} near-misses · ${c.changes ?? 0} changes`;

function Section({ title, runs, state, folders }: { title: string; runs: ActivityRun[]; state: (r: ActivityRun) => string; folders?: Map<number, RunSummary> }) {
    return (
        <section className="status-section">
            <h2>{title} <span className="muted small count">{runs.length}</span></h2>
            {runs.length === 0 ? <p className="muted small">Nothing.</p> : (
                <ul className="plain">
                    {runs.map((r) => {
                        const f = folders?.get(r.id);
                        return (
                            <li key={r.id}>
                                <RunLabel title={r.title} fallback={r.workflow} /> <span className="muted small">{state(r)} · {ago(r.updatedAt)}</span>{' '}
                                {f && <><Link to={`/runs/${f.run}`} className="ext inline">Details</Link>{' '}</>}
                                <ExtLink href={r.url} className="inline">GitHub</ExtLink>
                                {f?.counts && <div className="muted small">{result(f.counts)}</div>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

// Search runs that finished, but where a searcher didn't: GitHub calls those runs a success.
// The last day, plus older ones not yet seen here (at most 3 days back). `seen` is read before this visit marks it.
function FailedSearchers({ seen }: { seen: string | null }) {
    const { data: runs } = useRuns();
    const { label } = useModels();
    const [dismissed, setDismissed] = useState(readDismissed);
    const now = Date.now();
    const since = Math.max(now - 3 * DAY, Math.min(now - DAY, seen ? Date.parse(seen) : 0));
    const list = runsWithFailedSearchers(runs, since, dismissed);
    const dismiss = (run: string) => { dismissRun(run); setDismissed(readDismissed()); };
    return (
        <section className="status-section">
            <h2>Searchers that failed <span className="muted small count">{list.length}</span></h2>
            <p className="muted small">{list.length ? 'The run finished with the other searchers.' : 'None lately.'}</p>
            <ul className="plain">
                {list.map((r) => (
                    <li key={r.run}>
                        <Link to={`/runs/${r.run}`}>{r.run}</Link>{' '}
                        <span className="muted small">{ago(r.finishedAt!)}</span>{' '}
                        <button type="button" className="status-seen" onClick={() => dismiss(r.run)}>Seen</button>
                        <ul className="plain small">
                            {failedSearchers(r.models).map(([id, m]) => <li key={id}><strong>{label(id)}</strong> {m.status}{m.reason && <>: {m.reason}</>}</li>)}
                        </ul>
                    </li>
                ))}
            </ul>
        </section>
    );
}

const DAY = 24 * 3600_000;
const readSeen = () => { try { return localStorage.getItem(STATUS_SEEN_KEY); } catch { return null; } };

// Opening Status (and leaving it) marks the failures shown as seen, so the bar's red dot goes out.
const markSeen = () => { try { localStorage.setItem(STATUS_SEEN_KEY, new Date().toISOString()); } catch { /* private window */ } };

export function StatusPage() {
    const { data: runs, isPending, isError } = useActivity();
    // Run folders by GitHub run id: ghUrl ends in /actions/runs/<id>.
    const folders = new Map((useRuns().data ?? []).flatMap((f) => { const id = Number(f.ghUrl?.split('/').pop()); return id ? [[id, f] as const] : []; }));
    // When the owner last looked, kept from before this visit marks it seen.
    const [seen] = useState(readSeen);
    // Only once the list has loaded: a failed load must not hide failures the owner never saw.
    const loaded = Boolean(runs);
    useEffect(() => { if (!loaded) return; markSeen(); return markSeen; }, [loaded]);
    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>;
    const by = (...s: string[]) => runs.filter((r) => s.includes(r.status));
    return (
        <>
            <div className="head"><h1>Status</h1><p className="muted">Everything started lately, newest first. Updates by itself.</p></div>
            <div className="status-cols">
                <div>
                    <Section title="In progress" runs={by('in_progress')} state={() => 'Running'} />
                    <Section title="Queued" runs={by('queued', 'waiting', 'pending', 'requested')} state={() => 'Waiting for your PC'} />
                    <Section title="Finished" runs={by('completed')} state={outcome} folders={folders} />
                </div>
                <aside className="status-side"><FailedSearchers seen={seen} /></aside>
            </div>
        </>
    );
}
