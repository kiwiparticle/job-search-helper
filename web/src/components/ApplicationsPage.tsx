import { Menu } from '@base-ui/react/menu';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAct, useChecking, useCompanies, useFloor, usePostings } from '../data';
import { belowFloor, dayText, shortPay } from '../format';
import type { Application, Company, Outcome, Posting } from '../model';
import { daysBetween, localToday, needsFollowUp } from '../pipeline';
import { PostingLink } from '../text';
import { ActionButton } from '../toast';
import { FollowUpButton } from './FollowUp';
import { CompanyLink } from './CompanyLink';
import { InlineForm } from './CompanyPage';
import { Button, Choice, Tip } from './ui';

const STAGES = [['applied', 'Applied'], ['screening', 'Screening'], ['interviewing', 'Interviewing'], ['offer', 'Offer']] as const;
const CLOSED: [Outcome, string][] = [['rejected', 'Rejected'], ['no response', 'No response'], ['passed', 'I passed']];
const WAIT = 'Re-checking. Results show here in a few minutes.';

type Row = { company: Company; app: Application };

export function ApplicationsPage() {
    const { data: companies = [], isPending, isError } = useCompanies();
    const { data: postings = [] } = usePostings();
    const act = useAct();
    const checking = useChecking();
    const [params, setParams] = useSearchParams();
    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load. Reload to try again.</p>;

    const today = localToday();
    const all: Row[] = companies.flatMap((company) => company.applications.map((app) => ({ company, app })))
        .sort((a, b) => b.app.appliedOn.localeCompare(a.app.appliedOn));
    const open = all.filter((r) => r.app.outcome === 'applied');
    const closed = all.filter((r) => r.app.outcome !== 'applied');
    const due = open.filter((r) => needsFollowUp(r.app, today)).length;
    const showClosed = params.get('show') === 'closed';
    const card = (r: Row) => <AppCard key={r.app.id} row={r} posting={postings.find((p) => p.id === r.app.postingId)} today={today} />;

    return (
        <>
            <div className="head">
                <h1>Applications</h1>
                <p className="muted">{open.length} open, {closed.length} closed</p>
                <ActionButton title="Check every saved and applied job to see if it is still posted. Script, no model." className="head-end" disabled={checking} action={() => act({ type: 'recheck' }, WAIT)}>{checking ? 'Checking…' : 'Re-check all postings'}</ActionButton>
            </div>
            {due > 0 && <p className="muted">{due} need{due === 1 ? 's' : ''} a follow-up</p>}
            {all.length === 0 ? <p className="empty">No applications yet.</p> : (
                <div className="board">
                    {STAGES.map(([stage, label]) => {
                        const rows = open.filter((r) => (r.app.stage ?? 'applied') === stage);
                        return (
                            <section key={stage} className="board-col" aria-label={label}>
                                <h2 className="board-head">{label}<span className="n">{rows.length}</span></h2>
                                {rows.map(card)}
                            </section>
                        );
                    })}
                    <Button type="button" className="board-closed" title={showClosed ? 'Hide closed applications' : 'List closed applications below the board'} aria-expanded={showClosed}
                        onClick={() => setParams(showClosed ? {} : { show: 'closed' }, { replace: true })}>
                        <span className="board-head">Closed<span className="n">{closed.length}</span></span>
                        {CLOSED.map(([outcome, label]) => <span key={outcome} className="small muted">{label} {closed.filter((r) => r.app.outcome === outcome).length}</span>)}
                    </Button>
                </div>
            )}
            {showClosed && (
                <section aria-label="Closed applications">
                    <h2>Closed</h2>
                    {closed.length ? <div className="closed-list">{closed.map(card)}</div> : <p className="empty">No closed applications.</p>}
                </section>
            )}
        </>
    );
}

// One application. On the company page (onCompany) the role leads, since the company is the page.
export function AppCard({ row, posting, today = localToday(), onCompany }: { row: Row; posting?: Posting; today?: string; onCompany?: boolean }) {
    const { company, app } = row;
    const floor = useFloor();
    const jobId = posting?.id ?? app.postingId;
    const name = jobId ? <Link to={`/jobs/${jobId}`}>{app.role}</Link> : app.role;
    const act = useAct();
    const checking = useChecking();
    const trigger = useRef<HTMLButtonElement>(null);
    // The one inline form open on this card, if any.
    const [form, setForm] = useState<'pass' | 'link' | null>(null);
    const isOpen = app.outcome === 'applied';
    const [followOpen, setFollowOpen] = useState(false);
    const send = (body: Record<string, unknown>, done: string) => act({ type: 'setOutcome', company: company.name, applicationId: app.id, ...body }, done);
    const item = (label: string, onClick: () => void, tip: string, danger = false, disabled = false) => (
        <Tip key={label} text={tip}><Menu.Item className={danger ? 'menu-item danger' : 'menu-item'} disabled={disabled} onClick={onClick}>{label}</Menu.Item></Tip>
    );
    return (
        <article className="app-card">
            <div className="app-top">
                {onCompany ? <span><strong>{name}</strong> <PostingLink url={app.url} /></span> : <CompanyLink company={company}><strong>{company.name}</strong></CompanyLink>}
                {isOpen && <span className="muted small nowrap">{Math.max(0, daysBetween(app.stageOn ?? app.appliedOn, today))}d</span>}
            </div>
            {!onCompany && <div>{name} <PostingLink url={app.url} /></div>}
            <div className="small muted">applied {app.approx && 'about '}{dayText(app.appliedOn)}</div>
            {posting && <div className={belowFloor(posting, floor) ? 'small low' : 'small'}>{shortPay(posting)}</div>}
            {posting?.posted === 'no' && <div className="small muted">No longer posted</div>}
            {isOpen ? (
                <div className="small"><NextStep app={app} today={today} /></div>
            ) : (
                <div className="small muted">{CLOSED.find(([o]) => o === app.outcome)?.[1]}{app.outcomeOn && ` · ${app.outcomeOn}`}{app.reason && ` · ${app.reason}`}</div>
            )}
            <div className="actions">
                {isOpen ? (
                    <StageControls company={company} app={app} followUp={{ open: followOpen, setOpen: setFollowOpen }} />
                ) : <ActionButton title="Mark this application as open again." action={() => send({ outcome: 'applied' }, `${company.name}: Reopened.`)}>Reopen</ActionButton>}
                <Menu.Root>
                    <Tip text="Actions for this application"><Menu.Trigger ref={trigger} className="menu-trigger">Actions ▾</Menu.Trigger></Tip>
                    <Menu.Portal>
                        <Menu.Positioner className="pop-pos" sideOffset={6} align="start">
                            <Menu.Popup className="menu" finalFocus={trigger}>
                                {isOpen && [
                                    item('Rejected', () => send({ outcome: 'rejected' }, `${company.name}: Rejected.`), 'Record that the company turned you down.'),
                                    item('No response', () => send({ outcome: 'no response' }, `${company.name}: No response.`), 'Record that the company never replied.'),
                                    item('I passed…', () => setForm('pass'), 'Record that you chose not to continue. You will be asked why.'),
                                    item('Draft follow-up…', () => setFollowOpen(true), 'Draft a follow-up email for this application, due or not.'),
                                ]}
                                {!app.url && item('Add posting link…', () => setForm('link'), 'Attach the link to the posting you applied for.')}
                                {item(checking ? 'Checking…' : 'Re-check posting', () => act({ type: 'recheck', company: company.name }, WAIT), 'Check whether this job posting is still live. Script, no model.', false, checking)}
                                {item('Delete', () => act({ type: 'deleteApplication', company: company.name, applicationId: app.id }, 'Deleted.'), 'Remove this application record. You will be asked to confirm.', true)}
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>
            {form === 'pass' && <InlineForm title="I passed" onClose={() => setForm(null)} fields={[{ name: 'reason', label: 'Why did you pass?', required: true }]} submit={(v) => send({ outcome: 'passed', reason: v.reason }, `${company.name}: Passed.`)} />}
            {form === 'link' && <InlineForm title="Posting link" onClose={() => setForm(null)} fields={[{ name: 'url', label: 'Link to the posting', required: true, type: 'url' }]} submit={(v) => act({ type: 'addPostingLink', company: company.name, applicationId: app.id, url: v.url }, 'Link added.')} />}
        </article>
    );
}

// The next step and its date (muted), then an amber Follow up? when one is due. The card and the job pane header show it.
export function NextStep({ app, today = localToday() }: { app: Application; today?: string }) {
    return <>
        {app.next && <>{app.next.text}{app.next.on && <span className="muted"> · {app.next.on}</span>} </>}
        {needsFollowUp(app, today) && <span className="low nowrap">Follow up?</span>}
    </>;
}

// The stage dropdown and the Next step form for one open application. Used on the pipeline card and in the job pane header.
// Draft follow-up shows only when one is due; the card's menu passes `followUp` to open it any time.
export function StageControls({ company, app, followUp }: { company: Company; app: Application; followUp?: { open: boolean; setOpen: (open: boolean) => void } }) {
    const act = useAct();
    const [editing, setEditing] = useState(false);
    return (
        <>
            <Choice label={`Stage for ${app.role}`} value={app.stage ?? 'applied'} options={STAGES.map(([value, label]) => ({ value, label }))}
                onChange={(v) => act({ type: 'setStage', company: company.name, applicationId: app.id, stage: v === 'applied' ? '' : v }, `${company.name}: ${STAGES.find(([s]) => s === v)?.[1]}.`)} />
            <Button type="button" title="The next thing to do on this application, with an optional date." aria-expanded={editing} onClick={() => setEditing(true)}>Next step</Button>
            <FollowUpButton company={company} app={app} button={needsFollowUp(app, localToday())} open={followUp?.open} onOpenChange={followUp?.setOpen} />
            {editing && <InlineForm title="Next step" onClose={() => setEditing(false)} initial={{ text: app.next?.text ?? '', on: app.next?.on ?? '' }}
                fields={[{ name: 'text', label: 'Next step (empty clears it)' }, { name: 'on', label: 'By when', type: 'date' }]}
                check={(v) => (v.on && !v.text ? 'Write the next step for that date, or clear the date.' : '')}
                submit={(v) => act({ type: 'setNextStep', company: company.name, applicationId: app.id, text: v.text, ...(v.on && { on: v.on }) }, v.text ? 'Next step saved.' : 'Next step cleared.')} />}
        </>
    );
}
