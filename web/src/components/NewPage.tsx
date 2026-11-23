import { CompanyLink, OutstandingMark } from './CompanyLink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { notesOf } from '../../../lib/notes.js';
import { belowFloor, dayText, FIT_LABEL, fitIndex, fingerprintScore, isOutstanding, rowStamp, shortPay, utcClock } from '../format';
import { rescoreCount } from '../../../lib/newQueue.js';
import { JUDGE_ROLES } from '../actions';
import { OpenAction } from './OpenAction';
import { useAct, useActiveRuns, useCompanies, useFloor, useNewQueue, usePostings, useSchedule, useSavedGroups } from '../data';
import type { Company, NewItem, Posting, SavedGroup } from '../model';
import { ActionButton } from '../toast';
import { CompanyPanel } from './CompanyPage';
import { FlagButton } from './FlagButton';
import { KitChip } from './ApplyButton';
import { JobPanel } from './JobPage';
import { TuneBox } from './TuneBox';
import { Button, Fold } from './ui';
import { Popover } from '@base-ui/react/popover';

const GROUPS: [NewItem['kind'], string, string][] = [
    ['flagged', 'Flagged', 'Jobs and companies you flagged to come back to.'],
    ['applying', 'Applying', 'You picked Apply. Send it, then Mark applied.'],
    ['lead', 'New leads', ''],
    ['unjudged', 'Found on boards, not reviewed', 'A script found these on companies\' own job boards. Triage gives each a quick keep and fit after every sweep; a Tracked run judges 30 a day, kept ones first. Judge one yourself any time.'],
    ['duplicate', 'Possible duplicates', 'A run found a company whose name is close to one you already track.'],
    ['gone', 'Postings taken down', 'The daily check found these postings gone. They stay here until you mark them seen.'],
    ['proposal', 'Proposals from your questions', ''],
];

// Which postings the owner has opened, kept in this browser only. The first visit marks everything already
// on the page as seen, so only jobs added later show as unread.
const SEEN_KEY = 'new-seen';
const loadSeen = (): Set<string> | null => {
    try { const v = localStorage.getItem(SEEN_KEY); return v ? new Set(JSON.parse(v)) : null; } catch { return null; }
};
const saveSeen = (seen: Set<string>) => {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* private window: the unread mark just comes back */ }
};

// Below the two-column breakpoint (.split in style.css) the detail sits under the list.
const isNarrow = () => Boolean(window.matchMedia?.('(max-width: 899px)').matches);

type Found ={ item: NewItem; id: string; company: Company; posting?: Posting };

// New leads by the model's fit score, best first, every bucket open. Leads from before the score come last.
const fitRank = (found: Found) => fitIndex(found.posting?.fit);

const goneEntry = ({ company, posting }: Found) => ({ company: company.name, postingId: posting!.id, goneAt: posting!.goneAt });

function LeadBuckets({ group, row }: { group: Found[]; row: (found: Found) => React.ReactNode }) {
    if (group.every((f) => f.posting?.fit == null)) return <ul className="queue">{group.map(row)}</ul>;
    return FIT_LABEL.map((name, i) => {
        const rows = group.filter((f) => fitRank(f) === i);
        if (!rows.length) return null;
        return (
            <section key={name} className="bucket" aria-label={name}>
                <h3 className="small bucket-head">{name} <span className="muted">{rows.length}</span></h3>
                <ul className="queue">{rows.map(row)}</ul>
            </section>
        );
    });
}

// The run title carries the chain (see run-name in search.yml): "search tracked (judging all, 4 more batches after this)".
function judgingText(run: { title?: string; status: string }) {
    const more = run.title?.match(/judging all, (\d+) more/)?.[1];
    const base = more == null ? 'Judging roles…' : `Judging all in batches… ${more === '0' ? '(last batch)' : `(${more} more after this)`}`;
    return run.status === 'queued' ? `${base} waiting for your PC` : base;
}

// One company with its saved roles. Rows hold no buttons: the pane has Apply, Flag and Skip.
function SavedBlock({ group, company, byId, selId, select }: { group: SavedGroup; company: Company; byId: Map<string, Posting>; selId?: string; select: (id: string) => void }) {
    const floor = useFloor();
    const score = fingerprintScore(company.fingerprint);
    const head = `savedco:${group.key}`;
    const line = [company.domain, company.size, company.founded].filter(Boolean).join(' · ');
    return (
        <section className="saved-co" aria-label={group.company}>
            <button type="button" className="saved-head" aria-current={head === selId} onClick={() => select(head)}>
                <span className="q-line"><span className="q-co">{group.company}{isOutstanding(company) && <OutstandingMark />}</span><span className="muted small nowrap">fp {score === null ? '—' : `${score}/5`}</span></span>
                {company.culture && <span className="saved-line">{company.culture}</span>}
                {line && <span className="saved-line">{line}</span>}
            </button>
            <ul className="queue">
                {group.roles.map((r) => {
                    const id = `saved:${group.key}:${r.postingId}`;
                    const posting = r.postingRowId ? byId.get(r.postingRowId) : undefined;
                    return (
                        <li key={id}>
                            <button type="button" aria-current={id === selId} onClick={() => select(id)}>
                                <span className="q-line">
                                    <span className="q-role">{r.role}{r.flagged && ' ⚑'}</span>
                                    <span className={`small nowrap ${r.move === 'up' ? 'saved-up' : r.move === 'down' ? 'saved-down' : 'saved-fit'}`}>{r.fit == null ? 'fit —' : `fit ${r.fit}`}{r.move === 'up' ? ' ↑' : r.move === 'down' ? ' ↓' : ''}</span>
                                    <span className={posting && belowFloor(posting, floor) ? 'small num nowrap low' : 'muted small num nowrap'}>{r.gone ? 'taken down' : posting ? shortPay(posting) : '—'}</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

// Confirms first: a re-check spends one Claude run.
function RecheckButton({ count, running }: { count: number; running: boolean }) {
    const act = useAct();
    const [open, setOpen] = useState(false);
    if (running) return <Button disabled>Re-checking…</Button>;
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger className="menu-trigger">Re-check saved…</Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner className="pop-pos" sideOffset={6} align="end">
                    <Popover.Popup className="menu rescore-confirm" aria-label="Re-check saved jobs">
                        <span className="small">Re-score {count} saved, applying and flagged jobs against today's rules? One Claude run, no web searches.</span>
                        <div className="row">
                            <ActionButton action={() => act({ type: 'run', workflow: 'rescore' }, 'Re-check started. Scores update when it finishes.').then((ok) => { if (ok) setOpen(false); })}>Re-check</ActionButton>
                            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                        </div>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

export function NewPage() {
    const floor = useFloor();
    const nextRun = useSchedule().tracked?.hours[0];
    const { items, isPending, isError } = useNewQueue();
    const { groups: saved } = useSavedGroups();
    const { data: companies = [] } = useCompanies();
    const { data: postings = [] } = usePostings();
    const byId = useMemo(() => new Map(postings.map((p) => [p.id, p])), [postings]);
    // Each saved group with its company record; a group whose company isn't loaded is left out of the list and the ids alike.
    const shown = useMemo(() => {
        const byKey = new Map(companies.map((c) => [c.key, c]));
        return saved.flatMap((group) => { const company = byKey.get(group.key); return company ? [{ group, company }] : []; });
    }, [saved, companies]);
    const act = useAct();
    const active = useActiveRuns();
    const judging = active.find((r) => r.title?.startsWith('search tracked'));
    const rechecking = active.some((r) => r.title === 'rescore');
    const recheckCount = useMemo(() => rescoreCount(companies, postings), [companies, postings]);
    const [params, setParams] = useSearchParams();
    const detail = useRef<HTMLDivElement>(null);
    const bringDetail = useRef(false);
    const [seen, setSeen] = useState(loadSeen);
    const item = params.get('item');
    // Runs after the new detail has mounted (it remounts on each pick), so the scroll hits the right node.
    useEffect(() => {
        if (!bringDetail.current) return;
        bringDetail.current = false;
        detail.current?.scrollIntoView?.({ block: 'start' });
    }, [item]);

    // Each item gets a URL-safe id: kind, company key, then the posting id (or proposal id).
    const groupRank = (kind: string) => GROUPS.findIndex(([k]) => k === kind);
    const rows: Found[] = items.flatMap((item) => {
        const company = companies.find((c) => c.name === item.company);
        if (!company) return [];
        const id = [item.kind, company.key, item.postingId ?? item.proposalId].filter((x) => x !== undefined).join(':');
        return [{ item, id, company, posting: postings.find((p) => p.id === item.postingId) }];
    }).sort((a, b) => groupRank(a.item.kind) - groupRank(b.item.kind) || (a.item.kind === 'lead' ? fitRank(a) - fitRank(b) : 0)); // same order as the list on screen
    // Saved rows follow the queue rows: each company header, then its roles, in the order on screen.
    const savedIds = shown.flatMap(({ group: g }) => [`savedco:${g.key}`, ...g.roles.map((r) => `saved:${g.key}:${r.postingId}`)]);
    const ids = [...rows.map((r) => r.id), ...savedIds];
    // When the picked item leaves the queue (dismissed, saved...), land on the one that took its place, not the first.
    const lastIds = useRef<string[]>([]);
    const gone = item ? lastIds.current.indexOf(item) : -1;
    const selId = item && ids.includes(item) ? item : gone >= 0 ? ids[Math.min(gone, ids.length - 1)] : ids[0];
    const selected = rows.find((r) => r.id === selId);
    useEffect(() => {
        lastIds.current = ids;
        if (item && selId && selId !== item) {
            if (gone >= 0 && isNarrow()) bringDetail.current = true; // on mobile, show the job that took its place from the top
            setParams({ item: selId }, { replace: true }); // keep the URL on the new pick
        }
    });
    useEffect(() => {
        if (isPending || seen) return;
        const all = new Set(rows.flatMap((r) => (r.posting ? [r.posting.id] : [])));
        saveSeen(all);
        setSeen(all);
    });
    const markRead = (id?: string) => {
        if (!id || !seen || seen.has(id)) return;
        const next = new Set(seen).add(id);
        saveSeen(next);
        setSeen(next);
    };
    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>;

    const select = (id: string, postingId?: string) => {
        markRead(postingId);
        setParams({ item: id }, { replace: true });
        // Below the two-column breakpoint the detail sits under the list, so bring it into view.
        if (isNarrow()) bringDetail.current = true;
    };
    const markSeen = (found: Found[]) => act({ type: 'markSeen', seen: found.map(goneEntry) }, found.length === 1 ? 'Marked seen.' : `Marked ${found.length} postings seen.`);

    // One row of the queue, two lines: company and time, then role and pay (a new company shows what it does).
    const queueRow = (found: Found) => {
        const { id, company, posting } = found;
        if (found.item.kind === 'flagged') {
            const note = (notesOf(company, found.item.postingId) as { text: string }[]).at(-1)?.text;
            return (
                <li key={id}>
                    <button type="button" aria-current={id === selId} onClick={() => select(id)}>
                        <span className="q-line"><CompanyLink plain className="q-co" company={company} /><span className="muted small nowrap">{dayText((found.item.at ?? '').slice(0, 10))}</span></span>
                        <span className="q-line"><span className="q-role">{found.item.postingId ? company.jobFlags?.[found.item.postingId]?.role : 'Company'}</span></span>
                        {note && <span className="q-line"><span className="q-role flag-note">{note}</span></span>}
                    </button>
                </li>
            );
        }
        if (found.item.kind === 'applying') {
            const role = company.jobs[found.item.postingId ?? '']?.role ?? posting?.role ?? '';
            return (
                <li key={id}>
                    <button type="button" aria-current={id === selId} onClick={() => select(id)}>
                        <span className="q-line"><CompanyLink plain className="q-co" company={company} /><span className="muted small nowrap">{dayText((found.item.at ?? '').slice(0, 10))}</span></span>
                        <span className="q-line"><span className="q-role">{role}</span><KitChip company={company.name} role={role} postingId={found.item.postingId ?? ''} kitStartedAt={company.jobs[found.item.postingId ?? '']?.kitStartedAt} /></span>
                    </button>
                </li>
            );
        }
        const unread = Boolean(posting && seen && !seen.has(posting.id));
        return (
            <li key={id} className={unread ? 'unread' : undefined}>
                <button type="button" aria-current={id === selId} onClick={() => select(id, posting?.id)}>
                    <span className="q-line"><CompanyLink plain className="q-co" company={company} /><span className="muted small nowrap">{rowStamp(posting?.firstRun)}</span></span>
                    <span className="q-line">
                        <span className="q-role">{posting ? posting.role : company.domain || company.facts.match(/^.*?[.!?](?=\s|$)/)?.[0] || company.facts || 'New company'}</span>
                        {posting && <span className={belowFloor(posting, floor) ? 'small num nowrap low' : 'muted small num nowrap'}>{shortPay(posting)}</span>}
                    </span>
                    {found.item.kind === 'unjudged' && posting?.triage?.keep && <span className="q-line"><span className="q-role muted small">Triage: fit {posting.triage.fit ?? '?'}{posting.triage.reason ? `, ${posting.triage.reason}` : ''}</span></span>}
                </button>
            </li>
        );
    };

    const savedPanel = () => {
        const [kind, key, ...rest] = selId.split(':');
        const postingId = rest.join(':'); // posting ids hold colons (greenhouse:123)
        const found = shown.find(({ group }) => group.key === key);
        if (!found) return null;
        const { group, company } = found;
        const role = kind === 'saved' ? group.roles.find((r) => r.postingId === postingId) : undefined;
        const posting = role?.postingRowId ? byId.get(role.postingRowId) : undefined;
        return posting ? <JobPanel company={company} posting={posting} openLink /> : <CompanyPanel company={company} openLink />;
    };

    const panel = () => {
        if (!selected) return selId ? savedPanel() : null;
        const { item, company, posting } = selected;
        if (posting) return <JobPanel company={company} posting={posting} openLink unjudged={item.kind === 'unjudged'} />;
        if (item.kind === 'applying' && item.postingId && company.jobs[item.postingId]) return <JobPanel company={company} id={item.postingId} entry={company.jobs[item.postingId]} openLink />;
        const f = item.postingId ? company.jobFlags?.[item.postingId] : undefined;
        if (item.kind === 'flagged' && item.postingId && f) {
            return (
                <>
                    <div className="actions row-actions"><FlagButton company={company} job={{ id: item.postingId, role: f.role, leadKey: f.leadKey, url: f.url }} /></div>
                    <p className="muted small">{f.role}: this posting is no longer listed.</p>
                    <CompanyPanel company={company} openLink />
                </>
            );
        }
        return <CompanyPanel company={company} openLink />;
    };

    return (
        <>
            {ids.length === 0 ? <><TuneBox /><p className="empty">{`Nothing is waiting for you.${nextRun === undefined ? '' : ` The next run is at ${utcClock(nextRun)}.`}`}</p></> : (
                <div className="split fill">
                    <div className="split-list" role="region" aria-label="Waiting for you">
                        <TuneBox />
                        {GROUPS.map(([kind, label, why]) => {
                            const group = rows.filter((r) => r.item.kind === kind);
                            if (!group.length) return null;
                            return (
                                <Fold key={kind} className="group" defaultOpen heading="h2" label={label} title={<>{label}<span className="n">{group.length}</span></>}
                                    aside={kind === 'unjudged' ? (judging ? <Button disabled>{judgingText(judging)}</Button> : <OpenAction def={JUDGE_ROLES} ctx={{ company: '', workflow: 'tracked' }}>Judge roles…</OpenAction>)
                                        : kind === 'gone' ? <ActionButton title="Acknowledge every taken-down posting in this list." action={() => markSeen(group)}>Mark all seen</ActionButton> : null}>
                                    {why && <p className="small muted group-why">{why}</p>}
                                    {kind === 'lead' ? <LeadBuckets group={group} row={queueRow} /> : (
                                        <ul className="queue">
                                            {group.map(queueRow)}
                                        </ul>
                                    )}
                                </Fold>
                            );
                        })}
                        {shown.length > 0 && (
                            <Fold className="group" defaultOpen heading="h2" label="Saved" title={<>Saved<span className="n">{shown.reduce((n, { group }) => n + group.roles.length, 0)}</span></>}
                                aside={<RecheckButton count={recheckCount} running={rechecking} />}>
                                <p className="small muted group-why">Companies by their best saved role.</p>
                                {shown.map(({ group, company }) => <SavedBlock key={group.key} group={group} company={company} byId={byId} selId={selId} select={select} />)}
                            </Fold>
                        )}
                    </div>
                    <div className="split-detail" ref={detail} key={selId}>{panel()}</div>
                </div>
            )}
        </>
    );
}
