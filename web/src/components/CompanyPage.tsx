import { OutstandingMark } from './CompanyLink';
import { FlagButton } from './FlagButton';
import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { safeHref } from '../../../lib/safe.js';
import { applicationFor, jobEntry } from '../../../lib/tags.js';
import { belowFloor, companyAge, isOutstanding, hasRecentAwards, shortPay } from '../format';
import { useAct, useChecking, useCompanies, useFloor, useHistory, useKits, usePostings, useWorking } from '../data';
import type { Company, Posting, Stance } from '../model';
import { ExtLink, PostingLink, RichText } from '../text';
import { ActionButton } from '../toast';
import { AppCard } from './ApplicationsPage';
import { AskPanel } from './AskPanel';
import { DuplicateBox } from './DuplicateBox';
import { ProposalBox } from './ProposalBox';
import { CompanyTags, FactText as Fact, FingerprintFact, SiteLink } from './Tags';
import { ActionsMenu } from './Actions';
import { OpenAction } from './OpenAction';
import { FILL_FACTS, RULE_OUT } from '../actions';
import { ActionModal } from './ActionModal';
import { Notes } from './Notes';
import { Button, Fold, Tip } from './ui';

const STANCES: [Stance, string, string, string][] = [
    ['Watching', 'Watching', 'Watching', 'Track this company. Its job board is checked twice a day, or a run opens its careers page about once a week.'],
    ['Dormant', 'Dormant', 'Dormant', 'Keep this company on file but check it rarely: its job board on the 1st of each month, and runs skip it unless it has a lead.'],
    ['To review', 'Review later', 'To review', 'Flag this company for you to look at later. It stays in the regular checks, and searches will not change this flag.'],
];

// One line per thing running for this company (or job): "Searching a job…". Nothing when idle.
export function Working({ company, role }: { company: string; role?: string }) {
    const labels = useWorking(company, role);
    return <>{labels.map((l) => <p key={l} className="running" role="status"><span className="pulse" aria-hidden="true" />{l}…</p>)}</>;
}

// The stance as one menu; the trigger shows the current stance, marked a guess while only a model set it.
// Picking the guessed stance confirms it (it becomes the owner's, and the company leaves New). The server asks before changing a company with an open application.
// Rule out opens the Rule out dialog, which is the confirm.
export function StanceMenu({ company }: { company: Company }) {
    const act = useAct();
    const [ruling, setRuling] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    return (
        <>
            <Menu.Root>
                <Tip text="This company's stance"><Menu.Trigger ref={trigger} className="menu-trigger">{company.stance || 'No stance'}{company.stanceBy && company.stance ? ' (guess)' : ''} ▾</Menu.Trigger></Tip>
                <Menu.Portal>
                    <Menu.Positioner className="pop-pos" sideOffset={6} align="start">
                        <Menu.Popup className="menu" finalFocus={trigger}>
                            <Menu.RadioGroup value={company.stance}>
                                {STANCES.map(([stance, label, done, hint]) => (
                                    <Tip key={stance} text={hint}>
                                        <Menu.RadioItem value={stance} className="menu-item" closeOnClick onClick={() => { if (stance !== company.stance || company.stanceBy) act({ type: 'setStance', company: company.name, stance }, `${company.name}: ${done}.`); }}>
                                            {label}<Menu.RadioItemIndicator className="check" aria-hidden="true">✓</Menu.RadioItemIndicator>
                                        </Menu.RadioItem>
                                    </Tip>
                                ))}
                            </Menu.RadioGroup>
                            <Tip text={RULE_OUT.tip}><Menu.Item className="menu-item danger" onClick={() => setRuling(true)}>Rule out</Menu.Item></Tip>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
            {ruling && <ActionModal def={RULE_OUT} ctx={{ company: company.name }} finalFocus={trigger} onClose={() => setRuling(false)} />}
        </>
    );
}

type Field = { name: string; label: string; required?: boolean; type?: string; long?: boolean; max?: number };

// A small form in a dialog: a title, some fields, a Save, a Cancel. An empty required field shows an error and sends nothing.
// It is open while mounted: the caller mounts it to open and unmounts it from onClose.
// `check` returns an error message for values that are filled in but don't fit together, else ''.
export function InlineForm({ title, fields, submit, onClose, initial, check }: { title: string; fields: Field[]; initial?: Record<string, string>; submit: (v: Record<string, string>) => Promise<boolean>; onClose: () => void; check?: (v: Record<string, string>) => string }) {
    const id = useId();
    const [values, setValues] = useState<Record<string, string>>(initial ?? {});
    const [error, setError] = useState('');
    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const clean = Object.fromEntries(fields.map((f) => [f.name, (values[f.name] ?? '').trim()]));
        const missing = fields.find((f) => f.required && !clean[f.name]);
        if (missing) { setError(`${missing.label} is required.`); return; }
        const wrong = check?.(clean);
        if (wrong) { setError(wrong); return; }
        if (await submit(clean)) onClose();
    };
    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog">
                    <Dialog.Title className="dialog-title">{title}</Dialog.Title>
        <form className="form" onSubmit={onSubmit}>
            {fields.map((f) => (
                <label key={f.name} htmlFor={`${id}-${f.name}`}>{f.label}
                    {f.long
                        ? <textarea id={`${id}-${f.name}`} rows={3} value={values[f.name] ?? ''} maxLength={f.max ?? 600} onChange={(e) => { setValues({ ...values, [f.name]: e.target.value }); setError(''); }} />
                        : <input id={`${id}-${f.name}`} type={f.type ?? 'text'} value={values[f.name] ?? ''} maxLength={500} onChange={(e) => { setValues({ ...values, [f.name]: e.target.value }); setError(''); }} />}
                </label>
            ))}
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row">
                <button type="submit" className="primary">Save</button>
                <button type="button" className="link" onClick={onClose}>Cancel</button>
            </div>
        </form>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

// Kits made for this company, found in applications/*/meta.json.
function CompanyKits({ company }: { company: Company }) {
    const { data } = useKits();
    const mine = (data ?? []).filter((k) => k.meta.company === company.name);
    if (!mine.length) return null;
    return (
        <div className="section"><h3>Application kits</h3>
            <ul className="postings">{mine.map((k) => <li key={k.name}><Link to={`/kits/${k.name}`}>{k.meta.role ?? k.name}</Link></li>)}</ul>
        </div>
    );
}

export const dateOf = (s?: string) => s?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';

// Owner events, posting sightings and history excerpts in one list, newest first. The job pane's History tab uses it too.
export function useTimelineRows(company: Company, postings: Posting[]) {
    const { data: history = [] } = useHistory(company.key);
    return [
        ...company.events.map((e) => ({ date: e.date, text: e.text })),
        ...postings.flatMap((p) => [
            { date: dateOf(p.firstRun), text: `First seen: ${p.role}` },
            ...(p.lastRun && p.lastRun !== p.firstRun ? [{ date: dateOf(p.lastRun), text: `Last seen: ${p.role}` }] : []),
        ]),
        ...history.map((h) => ({ date: dateOf(h.heading), text: h.text })),
    ].sort((a, b) => b.date.localeCompare(a.date));
}

function Timeline({ company, postings }: { company: Company; postings: Posting[] }) {
    const rows = useTimelineRows(company, postings);
    return (
        <Fold className="section group" defaultOpen heading="h3" title={<>Timeline<span className="count-chip">{rows.length}</span></>}>
            {rows.length ? <ul className="postings">{rows.map((r, i) => <li key={i}><span className="timeline-text"><RichText text={r.text} /></span><span className="muted small">{r.date}</span></li>)}</ul> : <p className="muted small">No history yet.</p>}
        </Fold>
    );
}

// `bare`: the body only, for the job pane's Company tab. No header, Timeline or Ask (the pane has its own).
export function CompanyPanel({ company, openLink, bare: inPane }: { company: Company; openLink?: boolean; bare?: boolean }) {
    const floor = useFloor();
    const act = useAct();
    const checking = useChecking();
    const [form, setForm] = useState<'culture' | null>(null);
    const postings = (usePostings().data ?? []).filter((p) => p.companyKey === company.key).reverse();
    const careers = safeHref(company.careersUrl);
    const jobsBoard = safeHref(company.jobsUrl);
    // Job entries that no posting has matched yet still belong on the page.
    const bare = Object.entries(company.jobs).filter(([id, j]) => !postings.some((p) => p.id === id || p.leadKey === j.leadKey));
    const toggle = (f: 'culture') => setForm((x) => (x === f ? null : f));
    const state = (p: Posting) => {
        const e = jobEntry(company, p);
        const app = applicationFor(company, p);
        if (app) return app.outcome === 'applied' ? 'Applied' : 'Application closed';
        return p.posted === 'no' ? 'Gone' : e?.state === 'skipped' ? 'Skipped' : e?.state === 'saved' ? 'Saved' : e?.state === 'applying' ? 'Applying' : p.wasLead ? 'Lead' : 'Seen';
    };
    const fill = (label: string, className?: string) => <OpenAction def={FILL_FACTS} ctx={{ company: company.name }} className={className} busyText="Looking up…">{label}</OpenAction>;
    const facts = [company.size, companyAge(company.founded), company.funding].filter((f): f is string => Boolean(f));

    // Culture, stability and facts: in the left column on the page, after the pane's own size and links rows.
    const factRows = <>
        {company.fingerprint && <div className="wide"><dt>Fingerprint</dt><dd><RichText text={company.fingerprint} />{isOutstanding(company) && <> <span className="tag">Outstanding</span></>}</dd></div>}
        <div className="wide"><dt>Culture</dt><dd>{company.culture && <><RichText text={company.culture} /> </>}{!company.culture && <span className="muted">not recorded {fill('Look up culture')}</span>}{' '}<Button type="button" title="Type in what you found, like a Glassdoor rating. Models can't always read Glassdoor." onClick={() => toggle('culture')}>{company.culture ? 'Edit' : 'Enter it yourself'}</Button></dd></div>
        <div className="wide"><dt>Stability</dt><dd>{company.stability ? <RichText text={company.stability} /> : <span className="muted">not recorded {fill('Look up stability')}</span>}</dd></div>
        {company.facts && <div className="wide"><dt>Facts</dt><dd><RichText text={company.facts} /></dd></div>}
        {company.rolesSkipped.length > 0 && <div className="wide"><dt>Roles skipped</dt><dd>{company.rolesSkipped.join('; ')}</dd></div>}
        {company.awards && <div className="wide"><dt>Awards</dt><dd><RichText text={company.awards} />{hasRecentAwards(company.awards) && <> <span className="tag">Recent awards</span></>}</dd></div>}
    </>;
    const standing = (company.verdict || company.reason || company.recheckTrigger) && (
        <section className="standing" aria-label="Where it stands">
            {company.verdict && <strong>{company.verdict}</strong>}
            {company.reason && <p><RichText text={company.reason} /></p>}
            {company.recheckTrigger && <p className="muted"><b>Next check</b> <RichText text={company.recheckTrigger} /></p>}
        </section>
    );
    const forms = <>
        {form === 'culture' && (
            <InlineForm title="Culture" onClose={() => setForm(null)}
                initial={{ culture: company.culture ?? '' }}
                fields={[{ name: 'culture', label: 'Culture evidence (Glassdoor rating, review count and date, source)', long: true }]}
                submit={(v) => act({ type: 'setCulture', company: company.name, culture: v.culture }, 'Culture saved.')} />
        )}
    </>;
    const jobs = (() => {
        const isSkipped = (p: Posting) => jobEntry(company, p)?.state === 'skipped';
        const current = postings.filter((p) => !isSkipped(p));
        const skippedPostings = postings.filter(isSkipped);
        const bareCurrent = bare.filter(([, j]) => j.state !== 'skipped');
        const bareSkipped = bare.filter(([, j]) => j.state === 'skipped');
        const skippedCount = skippedPostings.length + bareSkipped.length;
        // A row like the Jobs table: the role opens the job page, which has Skip and Review. Pay is amber under the floor.
        const meta = (p: Posting, text?: string) => <span className="muted small"><span className={belowFloor(p, floor) ? 'low' : undefined}>{shortPay(p)}</span>{text && <> · {text}</>}</span>;
        return <>
            <div className="section">
                <div className="group-head"><h3>Jobs<span className="count-chip">{current.length + bareCurrent.length}</span></h3>
                    {current.length + bareCurrent.length > 0 && <ActionButton title="Check whether saved and applied job postings are still live. Script, no model. Results show here in a few minutes." disabled={checking} action={() => act({ type: 'recheck', company: company.name }, 'Checking. Results show here in a few minutes.')}>{checking ? 'Checking…' : 'Check postings'}</ActionButton>}
                </div>
                {current.length + bareCurrent.length ? (
                    <ul className="postings">
                        {current.map((p) => (
                            <li key={p.id}>
                                <span className="row"><Link to={`/jobs/${p.id}`}>{p.role}</Link><PostingLink url={p.url} /></span>
                                {meta(p, state(p))}
                            </li>
                        ))}
                        {bareCurrent.map(([id, j]) => (
                            <li key={id}>
                                <span className="row"><Link to={`/jobs/${id}`}>{j.role}</Link><PostingLink url={j.url} /></span>
                                <span className="muted small">Saved · waiting for a posting check</span>
                            </li>
                        ))}
                    </ul>
                ) : <p className="muted small">No current jobs.</p>}
            </div>
            {skippedCount > 0 && (
                <div className="section"><h3>Skipped<span className="count-chip">{skippedCount}</span></h3>
                    <ul className="postings muted">
                        {skippedPostings.map((p) => (
                            <li key={p.id}>
                                <span className="row"><Link to={`/jobs/${p.id}`}>{p.role}</Link><PostingLink url={p.url} /></span>
                                {meta(p)}
                            </li>
                        ))}
                        {bareSkipped.map(([id, j]) => (
                            <li key={id}>
                                <span className="row"><Link to={`/jobs/${id}`}>{j.role}</Link><PostingLink url={j.url} /></span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>;
    })();
    // Open applications first, then newest. Stage, next step and outcome are set right on the card.
    const apps = [...company.applications].sort((a, b) => Number(b.outcome === 'applied') - Number(a.outcome === 'applied') || b.appliedOn.localeCompare(a.appliedOn));
    const status = <>
        {apps.length > 0 && (
            <section className="company-apps" aria-label="Applications">
                {apps.map((a) => <AppCard key={a.id} row={{ company, app: a }} posting={postings.find((p) => applicationFor(company, p) === a)} onCompany />)}
            </section>
        )}
        {standing || (!apps.length && !company.proposals.length && <p className="muted small">No verdict yet.</p>)}
        {company.proposals.map((p) => <ProposalBox key={p.id} company={company} proposal={p} />)}
        <DuplicateBox company={company} />
    </>;
    const boxes = <>{status}<CompanyKits company={company} /></>;

    if (inPane) return (
        <div className="company-body">
            <Notes company={company} />
            <dl className="overview">
                {company.domain && <div className="wide"><dt>What they do</dt><dd><RichText text={company.domain} /></dd></div>}
                <div><dt>Size</dt><dd>{company.size || <span className="muted">not recorded {fill('Fill in company facts')}</span>}</dd></div>
                <div><dt>Age</dt><dd>{companyAge(company.founded) || <span className="muted">not recorded{company.size && <> {fill('Fill in')}</>}</span>}</dd></div>
                {company.funding && <div><dt>Funding</dt><dd>{company.funding}</dd></div>}
                <div><dt>Last checked</dt><dd>{company.lastChecked || 'never'}</dd></div>
                {(careers || jobsBoard) && <div><dt>Links</dt><dd>
                    {careers && <ExtLink href={careers}>Careers</ExtLink>}{careers && jobsBoard && ' · '}
                    {jobsBoard && <ExtLink href={jobsBoard}>Jobs</ExtLink>}
                </dd></div>}
                {factRows}
            </dl>
            {boxes}
            {forms}
            {jobs}
        </div>
    );

    return (
        <article className="card" aria-label={`${company.name} company`}>
            {/* A direct child of the card, so it stays pinned while the whole card scrolls. */}
            <div className="head-line">
                <span className="head-who"><Link to="/companies">Companies</Link><CompanyTags company={company} postings={postings} /></span>
                <div className="actions row-actions">
                    <FlagButton company={company} />
                    <StanceMenu company={company} />
                    <ActionsMenu item="company" ctx={{ company: company.name, careersUrl: company.careersUrl, jobsUrl: company.jobsUrl, sweepOff: company.sweepOff }} />
                </div>
            </div>
            <header className="job-head">
                <h2>{openLink ? <a href={`#/companies/${company.key}`} target="_blank" rel="noopener">{company.name}</a> : company.name}{isOutstanding(company) && <OutstandingMark />}</h2>
                <p className="meta facts-line">
                    {facts.map((f, i) => <Fact key={i} text={f} />)}
                    <FingerprintFact company={company} />
                    {company.lastChecked && <span>checked {dateOf(company.lastChecked) || company.lastChecked}</span>}
                    {(!company.size || !company.founded) && fill('Fill in company facts', 'link')}
                </p>
                {company.domain && <p className="meta"><RichText text={company.domain} /></p>}
            </header>
            <p className="links-row">
                <SiteLink company={company} />
                {careers && <ExtLink href={careers}>Careers</ExtLink>}
                {jobsBoard && <ExtLink href={jobsBoard}>Jobs</ExtLink>}
            </p>
            <Notes company={company} />
            <Working company={company.name} />
            <div className="job-cols">
                <div>
                    {jobs}
                    <div className="section"><h3>Facts</h3><dl className="overview">{factRows}</dl></div>
                    <Timeline company={company} postings={postings} />
                </div>
                <div>
                    <section className="section company-status" aria-label="Status"><h3>Status</h3>{status}</section>
                    <CompanyKits company={company} />
                </div>
            </div>
            {forms}
            <AskPanel company={company.name} />
        </article>
    );
}

export function NotFound({ what, to, label }: { what: string; to: string; label: string }) {
    return <div className="empty"><p>{what} not found.</p><Link to={to}>{label}</Link></div>;
}

export function CompanyPage() {
    const { key } = useParams();
    const { data, isPending } = useCompanies();
    if (isPending) return <p className="empty">Loading…</p>;
    const company = data?.find((c) => c.key === key);
    return company ? <CompanyPanel company={company} /> : <NotFound what="Company" to="/companies" label="Back to Companies" />;
}
