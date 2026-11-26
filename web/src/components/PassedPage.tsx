import { useQueries } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { getJson } from '../api';
import { opinionsOf, useModels } from '../models';
import { useAct, useFloor, usePassed } from '../data';
import { belowFloor, dayText, shortPay } from '../format';
import type { Company, Posting, Report } from '../model';
import { PostingLink, RichText } from '../text';
import { CompanyLink } from './CompanyLink';
import { Decide } from './Decide';
import { ReviewJobButton } from './ReviewJobButton';
import { Chip, PostedNote } from './Tags';
import { ActionButton } from '../toast';

export function PassedPage() {
    const { jobs: modelJobs, filtered, dropped, dismissed, postings, isPending, isError } = usePassed();
    const act = useAct();
    const floor = useFloor();
    const { label } = useModels();
    const [params, setParams] = useSearchParams();
    const show = params.get('show');
    const tab = show === 'companies' ? 'companies' : show === 'dropped' ? 'dropped' : 'jobs';
    // The Filtered chip lists roles the sweep filter (data/sweep-filter.json) passed on, with its reason.
    const jobs = show === 'filtered' ? filtered : modelJobs;

    // The reason lives only in the run reports (postings are slim), so read the runs that judged the shown jobs.
    // `runs` lists the search runs that judged it; a sweep rewrites lastRun daily and has no report, so sweep names are left out.
    const judgedIn = (p: Posting) => [...new Set([...(p.runs ?? []).slice(-2).reverse(), p.lastRun, p.firstRun])].filter((r) => r && !r.includes('-sweep-'));
    const runs = [...new Set(postings.filter((p) => p.modelSays === 'pass').flatMap(judgedIn))];
    const reports = useQueries({ queries: tab === 'jobs' ? runs.map((run) => ({ queryKey: ['report', run], queryFn: () => getJson<Report>(`runs/${run}/report.json`), staleTime: Infinity, retry: false })) : [] });
    const byRun = new Map(runs.map((run, i) => [run, reports[i]?.data]));
    const reasonOf = (p: Posting) => {
        for (const run of judgedIn(p)) {
            const lead = [...(byRun.get(run)?.nearMisses ?? []), ...(byRun.get(run)?.leads ?? [])].find((l) => l.key === p.leadKey);
            const note = lead && opinionsOf(lead).find(([, v]) => v.note)?.[1].note;
            if (note) return String(note);
        }
        return reports.some((r) => r.isPending) ? 'Loading…' : '—';
    };

    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>;

    const readJob = ({ p, company }: (typeof jobs)[number]) => ({ company: company.name, jobs: [{ postingId: p.id, leadKey: p.leadKey, role: p.role, url: p.url }] });
    // Jobs of one company go in one entry: the server keeps a single entry per company.
    const merge = (rows: { company: string; jobs?: unknown[]; verdict?: boolean }[]) => [...rows.reduce((m, r) => {
        const o = m.get(r.company) ?? { company: r.company };
        m.set(r.company, { ...o, ...(r.jobs && { jobs: [...((o as { jobs?: unknown[] }).jobs ?? []), ...r.jobs] }), ...(r.verdict && { verdict: true }) });
        return m;
    }, new Map<string, object>()).values()];
    const markRead = (rows: Parameters<typeof merge>[0], done: string) => act({ type: 'markPassedRead', read: merge(rows) }, done);
    // Suggested rule-outs need a yes or no, so Mark all read leaves them.
    const readable = dismissed.filter((c) => !c.ruleOutSuggested);
    const says = (p: Posting) => Object.entries(p.verdicts ?? {}).map(([m, v]) => `${m}: ${v}`).join(', ');

    return (
        <>
            <div className="chips">
                <Chip on={tab === 'jobs' && show !== 'filtered'} onClick={() => setParams({}, { replace: true })}>Jobs ({modelJobs.length})</Chip>
                <Chip on={show === 'filtered'} onClick={() => setParams({ show: 'filtered' }, { replace: true })}>Filtered ({filtered.length})</Chip>
                <Chip on={tab === 'dropped'} onClick={() => setParams({ show: 'dropped' }, { replace: true })}>Dropped from Saved ({dropped.length})</Chip>
                <Chip on={tab === 'companies'} onClick={() => setParams({ show: 'companies' }, { replace: true })}>Companies ({dismissed.length})</Chip>
            </div>
            {tab !== 'dropped' && (tab === 'jobs' ? jobs.length : dismissed.length) > 0 && (
                <div className="actions">
                    <ActionButton
                        title="Mark everything listed here as read."
                        confirm={`Mark all ${tab === 'jobs' ? jobs.length : dismissed.length} as read?`}
                        action={() => tab === 'jobs'
                            ? markRead(jobs.map(readJob), `Marked ${jobs.length} read.`)
                            : readable.length ? markRead(readable.map((c) => ({ company: c.name, verdict: true })), 'Marked read. Suggested rule-outs still need your yes or no.') : Promise.resolve()}
                    >Mark all read</ActionButton>
                </div>
            )}
            {tab === 'dropped' ? (dropped.length === 0 ? <p className="empty">Nothing dropped from Saved.</p> : (
                <div className="table-box">
                    <table className="list">
                        <thead><tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Why</th><th scope="col">Skipped</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody>
                            {dropped.map((d) => (
                                <tr key={`${d.key}:${d.postingId}`}>
                                    <td><CompanyLink company={d.co} /></td>
                                    <td><strong>{d.role}</strong> <PostingLink url={d.url} /></td>
                                    <td className="small">{d.reasons.filter((r) => r.state === 'skipped' && r.at >= d.fromSaved).map((r) => r.reason).filter(Boolean).join(' · ') || '—'}</td>
                                    <td className="small nowrap">{dayText(d.fromSaved)}</td>
                                    <td><Decide kind="save" body={{ company: d.company, postingId: d.postingId, leadKey: d.leadKey, role: d.role, url: d.url }} done={`Saved ${d.role} again.`} title="Put this job back in Saved.">Save</Decide></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )) : tab === 'jobs' ? (jobs.length === 0 ? <p className="empty">Nothing passed.</p> : (
                <div className="table-box">
                    <table className="list">
                        <thead><tr><th scope="col">Job</th><th scope="col">Pay</th><th scope="col">Reason</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody>
                            {jobs.map(({ p, company }) => (
                                <tr key={p.id}>
                                    <td className="job-cell"><Link to={`/jobs/${p.id}`}><strong>{p.role}</strong></Link> <PostingLink url={p.url} /><div className="co muted"><CompanyLink company={company} /><PostedNote posting={p} /></div><div className="meta">{says(p)}</div></td>
                                    <td className={belowFloor(p, floor) ? 'small nowrap low' : 'small nowrap'}>{shortPay(p)}</td>
                                    <td className="small">{p.filteredBy != null ? <><span className="tag">Filtered</span> {p.filterReason}</> : p.triage?.keep === false ? <><span className="tag">Triaged out</span> {p.triage.reason}</> : <RichText text={reasonOf(p)} />}</td>
                                    <td>
                                        <div className="actions row-actions"><ActionButton title="Keep this job on your list despite the models." action={() => act({ type: 'saveJob', company: company.name, postingId: p.id, leadKey: p.leadKey, role: p.role, url: p.url }, `Saved ${p.role}.`)}>Save</ActionButton><ReviewJobButton company={company.name} role={p.role} url={p.url} />
                                        <ActionButton title="You agree with the models. Hides this job, like Skip this role." action={() => markRead([readJob({ p, company })], 'Marked read.')}>Mark read</ActionButton></div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )) : (dismissed.length === 0 ? <p className="empty">Nothing dismissed.</p> : (
                <div className="table-box">
                    <table className="list">
                        <thead><tr><th scope="col">Company</th><th scope="col">Stance</th><th scope="col">Models said</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody>
                            {dismissed.map((c) => (
                                <tr key={c.key}>
                                    <td><CompanyLink company={c}><strong>{c.name}</strong></CompanyLink></td>
                                    <td className="small">{c.stance || '—'}</td>
                                    {c.ruleOutSuggested && c.stance !== 'Ruled out' ? (
                                        <>
                                            <td className="small"><span className="tag">Rule out?</span> {label(c.ruleOutSuggested.by)} suggests ruling it out.{c.ruleOutSuggested.reason && <div className="meta"><RichText text={c.ruleOutSuggested.reason} /></div>}</td>
                                            <td className="nowrap"><ActionButton className="primary" title="Rule out the whole company. Its roles stop showing." confirm={`Rule out ${c.name}?`} action={() => act({ type: 'setStance', company: c.name, stance: 'Ruled out', ruleOutAsked: true }, `Ruled out ${c.name}.`)}>Rule out</ActionButton>{' '}
                                                <ActionButton title="Keep the company. Its stance becomes yours, so runs stop suggesting this." action={() => act({ type: 'keepCompany', company: c.name }, `Kept ${c.name}.`)}>Keep</ActionButton></td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="small">{c.verdict}{c.reason && <div className="meta"><RichText text={c.reason} /></div>}</td>
                                            <td className="nowrap"><ActionButton title="You agree with the models. Hides this company here until its verdict changes." action={() => markRead([{ company: c.name, verdict: true }], 'Marked read.')}>Mark read</ActionButton>{' '}
                                                <ActionButton title="Flag this company for you to look at later." action={() => act({ type: 'setStance', company: c.name, stance: 'To review' }, `${c.name}: Review later.`)}>Review later</ActionButton></td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </>
    );
}
