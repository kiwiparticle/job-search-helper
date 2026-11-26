import { Menu } from '@base-ui/react/menu';
import { CompanyLink } from './CompanyLink';
import { Link, useParams } from 'react-router';
import { ASSESSMENT_LISTS } from '../../../lib/assessment.js';
import { applicationFor, appliedTo, companyOf, jobEntry } from '../../../lib/tags.js';
import { NextStep, StageControls } from './ApplicationsPage';
import { companyAge } from '../format';
import { mergedChecks, Scorecard } from './Scorecard';
import { useAct, useActiveRuns, useCompanies, useKits, usePostings, useReport } from '../data';
import { FlagButton } from './FlagButton';
import { Decide } from './Decide';
import { ReviewJobButton } from './ReviewJobButton';
import { ActionsMenu } from './Actions';
import { ApplyButton, RetryKitButton } from './ApplyButton';
import { OpenAction } from './OpenAction';
import { MARK_APPLIED } from '../actions';
import { kitStatus } from '../pipeline';
import type { Application, Check, Company, JobEntry, Posting, RunLead, Verdict } from '../model';
import { ExtLink, PostingLink, RichText } from '../text';
import { safeHref } from '../../../lib/safe.js';
import { ActionButton } from '../toast';
import { AskPanel } from './AskPanel';
import { Notes } from './Notes';
import { CompanyPanel, dateOf, NotFound, useTimelineRows, Working } from './CompanyPage';
import { FactText as Fact, JobTags, PostedNote, SiteLink, Tag } from './Tags';
import { opinionsOf, useModels } from '../models';
import { Button, Fold, Tabs, Tip } from './ui';

import { useState, type ReactNode } from 'react';

const MARK = { good: '✓ good', concern: '! concern', unknown: '? unknown' } as Record<string, string>;
type Assessment = Partial<Record<'for' | 'against' | 'unknown', string[]>>;
type Estimate = { range: string; confidence: string; basis: string };
const text = (v: unknown) => (typeof v === 'string' ? v : '');

function CheckCell({ c }: { c?: Check }) {
    if (!c) return <td className="muted">Not checked</td>;
    return <td><span className={`m ${c.mark}`}>{MARK[c.mark] ?? c.mark}</span> {c.value}</td>;
}

type WriteUp = Pick<RunLead, 'claude' | 'codex' | 'opinions' | 'questions'>;

const ICON: Record<string, string> = { good: '✓', concern: '!', unknown: '?' };
const DOT: Record<string, string> = { good: 'good', concern: 'warn', unknown: 'unk', differ: 'warn' };
// Checks are grouped by what needs attention. Every row shows what each model said.
const CHECK_GROUPS = [['concern', 'Concerns'], ['differ', 'Models differ'], ['good', 'Looks fine'], ['unknown', "Couldn't verify"]] as const;

function Checks({ posting }: { posting: WriteUp }) {
    const { label } = useModels();
    const rows = mergedChecks(posting);
    if (!rows.length) return null;
    const line = (who: string, c?: Check) => (
        <div key={who}><em>{who}</em>{c ? <span><b className={`mk ${c.mark}`}>{ICON[c.mark] ?? '?'}</b> <RichText text={c.value} /></span> : <span className="muted">Not checked</span>}</div>
    );
    return (
        <div className="section checks">
            <h3>Checks</h3>
            {CHECK_GROUPS.map(([g, title]) => {
                const inGroup = rows.filter((r) => r.mark === g);
                if (!inGroup.length) return null;
                return (
                    <div key={g} className="check-group">
                        <h4>{title} <span className="muted">{inGroup.length}</span></h4>
                        <div className="check-rows">
                            {inGroup.map((r) => (
                                <div key={r.label} className={g === 'differ' ? 'check-row flag' : 'check-row'}>
                                    <span className="check-label"><i className={`dot ${DOT[g]}`} />{r.label}</span>
                                    <div className="check-say">{r.by.map((b) => line(label(b.id), b.check))}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function AssessmentBlock({ posting }: { posting: WriteUp }) {
    const { label } = useModels();
    const says = opinionsOf(posting);
    if (!says.some(([, v]) => v.assessment || v.payEstimate)) return null;
    return (
        <section className="section assessment" aria-label="Assessment"><h3>Assessment</h3>
            <div className="verdicts">
                {says.map(([id, v]) => {
                    const a = v.assessment as Assessment | undefined;
                    const est = v.payEstimate as Estimate | undefined;
                    return (
                        <div key={id}>
                            <h4>{label(id)}</h4>
                            {est && <p className="estimate"><strong>Pay estimate: {est.range}</strong> <span className="small">{est.confidence} confidence, unverified. <RichText text={est.basis} /></span></p>}
                            {(ASSESSMENT_LISTS as [keyof Assessment, string][]).map(([k, name]) => a?.[k]?.length ? <div key={k}><h5>{name}</h5><ul className="plain">{a[k]!.map((x) => <li key={x}><RichText text={x} /></li>)}</ul></div> : null)}
                            {!a && <p className="muted small">No assessment.</p>}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

// What the actions need to know about a job. A posting has all of it; a job entry with no posting yet has its key as id.
export type JobRef = { id: string; role: string; url?: string; leadKey: string };

// Save, Skip and the Actions menu. `review` (an unjudged role) puts Review first; `openLink` (the New pane) adds "Open in its own tab".
export function JobActions({ company, job, review, openLink }: { company: Company; job: JobRef; review?: boolean; openLink?: boolean }) {
    const ctx = { company: company.name, role: job.role, url: job.url, postingId: job.id, leadKey: job.leadKey };
    const body = { company: company.name, postingId: job.id, leadKey: job.leadKey, role: job.role, url: job.url };
    const kit = new URLSearchParams({ company: company.name, role: job.role, postingId: job.id, ...(job.url && { url: job.url }) });
    const state = company.jobs[job.id]?.state;
    // An application for this posting, or an open one for the same role (the same rule as the New queue).
    const open = Boolean(appliedTo(company, { id: job.id, leadKey: job.leadKey }));
    const applying = state === 'applying' && !open;
    const status = kitStatus(company.name, job.role, job.id, useKits().data ?? [], useActiveRuns(), company.jobs[job.id]?.kitStartedAt);
    return (
        <div className="actions row-actions">
            {review && <ReviewJobButton company={company.name} role={job.role} url={job.url} />}
            {applying ? (
                <>
                    <OpenAction def={MARK_APPLIED} ctx={ctx} className="primary">Mark applied</OpenAction>
                    {status.state === 'ready' ? <Link className="btn apply-kit-link" to={`/kits/${status.kit}`}>Open kit</Link>
                        : status.state === 'drafting' ? <Button disabled>Drafting kit…</Button>
                        : <RetryKitButton company={company} job={job} />}
                </>
            ) : (
                <>
                    {/* A kit already made for this job (from Kits): open it; starting another would replace it. */}
                    {!open && (status.state === 'ready' ? <Link className="btn apply-kit-link" to={`/kits/${status.kit}`}>Open kit</Link> : <ApplyButton company={company} job={job} />)}
                    {state !== 'saved' && <Decide kind="save" body={body} done={`Saved ${job.role}.`} title="Keep this job on your list. It shows as Saved.">Save</Decide>}
                    <FlagButton company={company} job={job} />
                </>
            )}
            <Decide kind="skip" body={body} done={`Skipped ${job.role} at ${company.name}.`} title="Hide this one role. The company stays tracked.">Skip this role</Decide>
            <ActionsMenu item="job" ctx={ctx} omit={[...(review ? ['reviewJob'] : []), ...(applying ? ['markApplied'] : [])]}>
                <Tip text="Draft a resume and cover letter for this job. One model writes, the other critiques."><Menu.Item className="menu-item" render={<Link to={`/kits?${kit}`} />}>Make application kit</Menu.Item></Tip>
                {openLink && <Menu.Item className="menu-item" render={<a href={`#/jobs/${job.id}`} target="_blank" rel="noopener" />}>Open in its own tab</Menu.Item>}
            </ActionsMenu>
        </div>
    );
}

// A passed job's write-up sits under nearMisses, a lead's under leads.
const findLead = (report: { leads?: RunLead[]; nearMisses?: RunLead[] } | undefined, key?: string) =>
    [...(report?.leads ?? []), ...(report?.nearMisses ?? [])].find((l) => l.key === key);

// The write-up lives in the run's report, so it loads on its own and is found by lead key.
function useWriteUp(posting?: Posting) {
    const { data: report, isPending, isError } = useReport(posting?.lastRun);
    // No run yet (a job the owner added): the query is disabled and would read as pending forever.
    return { pending: Boolean(posting?.lastRun) && isPending, lead: isError ? undefined : findLead(report, posting?.leadKey) };
}

function Verdicts({ lead }: { lead: RunLead }) {
    const { label } = useModels();
    // Old reports always had both columns, so a model that said nothing still reads "Not reviewed".
    const ids = lead.opinions ? Object.keys(lead.opinions) : ['claude', 'codex'];
    return (
        <>
            <section className="verdict-box" aria-label="Model verdicts">
                {ids.map((id) => {
                    const v = lead.opinions ? lead.opinions[id] : lead[id as 'claude' | 'codex'];
                    return <div key={id} className="v"><span className="who">{label(id)}</span><strong>{text(v?.verdict) || 'Not reviewed'}</strong><p className="small"><RichText text={text(v?.note)} /></p></div>;
                })}
            </section>
            {lead.reviewed === false && <p className="muted small">Unreviewed.</p>}
        </>
    );
}

// Earlier runs that reviewed this job, newest first. Each loads its own report only when opened.
function EarlierReview({ run, leadKey }: { run: string; leadKey: string }) {
    const { data: report, isPending } = useReport(run);
    const lead = findLead(report, leadKey);
    return <Fold className="earlier-run" title={`Run ${run}`}>{isPending ? <p className="muted small">Loading…</p> : lead ? <Verdicts lead={lead} /> : <p className="muted small">No write-up saved in this run.</p>}</Fold>;
}

// The History tab: the company timeline, this job's Skip/Save reasons, earlier reviews and the run that found it, newest first.
function useJobHistory(company: Company, posting?: Posting, entry?: JobEntry) {
    const postings = (usePostings().data ?? []).filter((p) => p.companyKey === company.key);
    const line = (text: ReactNode, date: string) => <><div className="timeline-text">{typeof text === 'string' ? <RichText text={text} /> : text}</div><span className="muted small">{date}</span></>;
    const earlier = posting ? [...new Set([posting.firstRun, ...(posting.runs ?? [])])].filter((r) => r && r !== posting.lastRun) : [];
    const rows: { date: string; node: ReactNode }[] = [
        ...(entry?.reasons ?? []).map((r) => ({ date: r.at, node: line(`${r.state === 'skipped' ? 'Skipped' : 'Saved'}: ${r.reason}`, r.at) })),
        ...useTimelineRows(company, postings).map((r) => ({ date: r.date, node: line(r.text, r.date) })),
        ...earlier.map((r) => ({ date: dateOf(r), node: line(<EarlierReview run={r} leadKey={posting!.leadKey} />, dateOf(r)) })),
        ...(posting?.firstRun ? [{ date: dateOf(posting.firstRun), node: line(<>Found in run <Link to={`/runs/${posting.firstRun}`}>{posting.firstRun}</Link></>, dateOf(posting.firstRun)) }] : []),
    ];
    return rows.sort((a, b) => b.date.localeCompare(a.date));
}

function JobTab({ posting, lead, pending }: { posting?: Posting; lead?: RunLead; pending: boolean }) {
    if (!posting) return <p className="muted">Waiting for the next posting check.</p>;
    if (pending) return <p className="muted small">Loading the write-up…</p>;
    if (!lead) return <p className="muted small">{posting.lastRun ? 'No write-up saved for this job.' : 'The models haven\'t reviewed this job yet. No write-up exists.'}</p>;
    return (
        <div className="job-cols">
            <div>
                {lead.overview && <section className="section" aria-label="Job overview"><h3>About the job</h3><p>{lead.overview}</p></section>}
                <AssessmentBlock posting={lead} />
                {(lead.questions ?? []).length > 0 && <div className="section"><h3>Questions for the recruiter screen</h3><ul className="plain">{(lead.questions ?? []).map((q) => <li key={q}>{q}</li>)}</ul></div>}
            </div>
            <div>
                <Verdicts lead={lead} />
                <Checks posting={lead} />
            </div>
        </div>
    );
}

// The company under the job title, in the order that helps the decision. A row with no value is left out.
function CompanyFacts({ company }: { company: Company }) {
    // Size, age and funding keep their "unverified" marking (FactText), joined by dots.
    const size = [company.size, companyAge(company.founded), company.funding].filter(Boolean);
    const rows: [string, ReactNode][] = [
        ['Fingerprint', company.fingerprint && <RichText text={company.fingerprint} />],
        ['Culture', company.culture && <RichText text={company.culture} />],
        ['What they do', company.domain && <RichText text={company.domain} />],
        ['Size', size.length > 0 && size.map((f, i) => <span key={i}>{i > 0 && ' · '}<Fact text={f} /></span>)],
    ];
    const shown = rows.filter(([, v]) => v);
    if (!shown.length) return null;
    return (
        <dl className="saved-facts" aria-label="Company">
            {shown.map(([label, v]) => <div key={label}><dt>{label}</dt><dd>{v}</dd></div>)}
        </dl>
    );
}

export function JobPanel({ company, posting, id, entry, openLink, unjudged }: { company: Company; posting?: Posting; id?: string; entry?: JobEntry; openLink?: boolean; unjudged?: boolean }) {
    const act = useAct();
    const { data: kits = [] } = useKits();
    const { lead, pending } = useWriteUp(posting);
    const e = entry ?? (posting && jobEntry(company, posting));
    const job: JobRef = posting ?? { id: id ?? '', role: e?.role ?? '', url: e?.url, leadKey: e?.leadKey ?? '' };
    const gone = posting?.posted === 'no';
    const app: Application | undefined = applicationFor(company, { id: job.id, leadKey: job.leadKey });
    const history = useJobHistory(company, posting, e);
    return (
        <article className="card" aria-label={`${job.role} job`}>
            {/* A direct child of the card, so it stays pinned while the whole card scrolls. */}
            <div className="head-line">
                <span className="head-who"><CompanyLink company={company} />{company.stance && <Tag>{company.stance}</Tag>}{posting && <JobTags company={company} posting={posting} kits={kits} />}</span>
                <JobActions company={company} job={job} review={unjudged} openLink={openLink} />
            </div>
            <header className="job-head">
                <h2>{job.role}</h2>
                {app?.outcome === 'applied' && <div className="actions"><StageControls company={company} app={app} /><span className="small"><NextStep app={app} /></span></div>}
            </header>
            {e?.state === 'skipped' && <p className="small"><Tag>Skipped</Tag> {e.reasons?.filter((r: { state: string; reason: string }) => r.state === 'skipped' && r.reason).pop()?.reason}</p>}
            <CompanyFacts company={company} />
            {gone && (
                <div className="gone-box" role="status">
                    <span><strong>This posting was taken down.</strong> {posting.postedCheckedAt && <span className="muted small">Found missing on the {posting.postedCheckedAt.slice(0, 10)} check.</span>}</span>
                    <ActionButton title="Acknowledge that this posting was taken down and clear it from New." className="primary" action={() => act({ type: 'markSeen', seen: [{ company: company.name, postingId: job.id, goneAt: posting.goneAt }] }, 'Marked seen.')}>Mark seen</ActionButton>
                </div>
            )}
            {posting && <Scorecard posting={posting} lead={lead} pending={pending} />}
            <p className="links-row">
                <PostingLink url={job.url} />
                <SiteLink company={company} />
                {safeHref(company.careersUrl) && <ExtLink href={company.careersUrl!}>Careers</ExtLink>}
                {posting && <PostedNote posting={posting} />}
            </p>
            <Notes company={company} postingId={job.id} />
            <Working company={company.name} role={job.role} />
            <Tabs label="Job sections" defaultValue="job" tabs={[
                { value: 'job', label: 'Job', panel: <JobTab posting={posting} lead={lead} pending={pending} /> },
                { value: 'company', label: 'Company', panel: <CompanyPanel company={company} bare /> },
                { value: 'ask', label: 'Ask', panel: <AskPanel company={company.name} open /> },
                { value: 'history', label: <>History <span className="muted">{history.length}</span></>, panel: history.length
                    ? <ul className="postings history">{history.map((r, i) => <li key={i}>{r.node}</li>)}</ul>
                    : <p className="muted small">No history yet.</p> },
            ]} />
        </article>
    );
}

export function JobPage() {
    const { id } = useParams();
    const companies = useCompanies();
    const postings = usePostings();
    if (companies.isPending || postings.isPending) return <p className="empty">Loading…</p>;
    const posting = postings.data?.find((p) => p.id === id);
    const company = posting ? companyOf(companies.data ?? [], posting) : companies.data?.find((c) => id && c.jobs[id]);
    if (company && (posting || (id && company.jobs[id]))) return <JobPanel company={company} posting={posting} id={id} entry={id ? company.jobs[id] : undefined} />;
    return <NotFound what="Job" to="/jobs" label="Back to Jobs" />;
}
