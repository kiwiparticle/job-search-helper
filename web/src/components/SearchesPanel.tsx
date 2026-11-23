import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { rescoreCount } from '../../../lib/newQueue.js';
import { RECHECK, RUN_SEARCH } from '../actions';
import { useAct, useActivity, useCompanies, usePostings, useRuns, useSchedule } from '../data';
import { runWhen, scheduleText, whenText } from '../format';
import { searchSummary, useModels } from '../models';
import { ActionModal } from './ActionModal';
import { Tip } from './ui';

// id, name, whether models run. When each starts on its own comes from data/schedule.json (UTC), shown in the browser's time zone (scheduleText).
export const WORKFLOWS: { id: string; label: string; models: boolean }[] = [
    { id: 'daily', label: 'Daily role discovery', models: true },
    { id: 'tracked', label: 'Tracked companies check', models: true },
    { id: 'links', label: 'Find careers links', models: true },
    { id: 'culture', label: 'Weekly culture discovery', models: true },
    { id: 'vertical', label: 'Weekly vertical sweep', models: true },
    { id: 'reconcile', label: 'Weekly ledger reconcile', models: true },
    { id: 'sweep', label: 'Sweep job boards', models: false },
    { id: 'resolve', label: 'Find boards on careers pages', models: false },
    { id: 'find-boards', label: 'Find boards with a browser', models: false },
    { id: 'tune', label: 'Tune the search from your reasons', models: false },
    { id: 'triage', label: 'Triage swept roles (after each sweep)', models: false },
    { id: 'rescore', label: 'Re-check saved jobs', models: false },
];
type Row = (typeof WORKFLOWS)[number];

// The workflow name /api/activity reports for the script rows (the workflow file's `name:`).
const ACTIVITY_NAME: Record<string, string> = { sweep: 'sweep', resolve: 'resolve-links', tune: 'tune', triage: 'triage', rescore: 'rescore', 'find-boards': 'find-boards' };

// The rows live inside the popup so the 20s activity poll only runs while the panel is open.
function Rows({ onRun, onOther, onNav }: { onRun: (row: Row) => void; onOther: (row: Row) => void; onNav: () => void }) {
    const { data: runs = [] } = useRuns();
    const { data: activity = [] } = useActivity();
    const { defaults, label } = useModels();
    const schedule = useSchedule();
    return (
        <ul className="searches-list">
            {WORKFLOWS.map((row) => {
                const summary = searchSummary(defaults, row.id, label);
                const lastRun = row.models ? runs.find((r) => r.workflow === row.id)?.run : undefined;
                const last = row.models ? runWhen(lastRun) : (() => {
                    const a = activity.find((r) => r.workflow === ACTIVITY_NAME[row.id]);
                    return a ? whenText(new Date(a.createdAt)) : '';
                })();
                // Triage runs after each sweep, so it shows the sweep's times.
                const when = schedule[row.id === 'triage' ? 'sweep' : row.id];
                return (
                    <li key={row.id} className="searches-row">
                        <div className="searches-text">
                            <strong>{row.label}</strong>
                            <span className="muted small">{when ? `Runs ${scheduleText(when.days, when.hours)}` : 'Runs only when you start it'}</span>
                            <span className="muted small">Last run {last || '—'}</span>
                            {row.models && <Tip text={`Uses ${summary}.`}><span className="muted small">{summary}</span></Tip>}
                        </div>
                        <Menu.Root>
                            <Menu.Trigger className="menu-trigger" aria-label={`Actions for ${row.label}`}>⋯</Menu.Trigger>
                            <Menu.Portal>
                                <Menu.Positioner className="pop-pos" sideOffset={6} align="end">
                                    <Menu.Popup className="menu">
                                        <Menu.Item className="menu-item" onClick={() => onRun(row)}>Run now</Menu.Item>
                                        {row.models && <Menu.Item className="menu-item" onClick={() => onOther(row)}>Run with other models…</Menu.Item>}
                                        {lastRun && <Menu.Item className="menu-item" render={<Link to={`/runs/${lastRun}`} onClick={onNav} />}>View last report</Menu.Item>}
                                    </Menu.Popup>
                                </Menu.Positioner>
                            </Menu.Portal>
                        </Menu.Root>
                    </li>
                );
            })}
        </ul>
    );
}

// Header panel: each search with its schedule, last run and models, and a menu to start it. `onStarted` lets the status line check right away.
// The bar owns `open` so More ▾ can open it on narrow screens, where `anchor` (the More trigger) stands in for the hidden trigger,
// for placement and for where focus goes back on close.
export function SearchesPanel({ onStarted, open, setOpen, anchor }: {
    onStarted: () => void; open: boolean; setOpen: (open: boolean) => void; anchor?: RefObject<HTMLElement | null>;
}) {
    const [chosen, setChosen] = useState<Row | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const act = useAct();
    const { data: companies = [] } = useCompanies();
    const { data: postings = [] } = usePostings();
    const recheckCount = useMemo(() => (chosen?.id === 'rescore' ? rescoreCount(companies, postings) : 0), [chosen, companies, postings]);
    const runNow = async (row: Row) => {
        setOpen(false);
        // Re-check spends a Claude run: it confirms with the job count first.
        if (row.id === 'rescore') { setChosen(row); return; }
        if (await act({ type: 'run', workflow: row.id }, 'Run started. Progress shows in the bar.')) onStarted();
    };
    return (
        <>
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Tip text="Start and schedule searches"><Popover.Trigger ref={trigger} className="menu-trigger searches-trigger">Searches ▾</Popover.Trigger></Tip>
                <Popover.Portal>
                    <Popover.Positioner className="pop-pos" sideOffset={6} align="end" anchor={anchor}>
                        <Popover.Popup className="menu searches-panel" aria-label="Searches" finalFocus={anchor ?? trigger}>
                            <Rows onNav={() => setOpen(false)} onRun={runNow} onOther={(row) => { setOpen(false); setChosen(row); }} />
                        </Popover.Popup>
                    </Popover.Positioner>
                </Popover.Portal>
            </Popover.Root>
            {chosen && <ActionModal def={chosen.id === 'rescore' ? RECHECK : RUN_SEARCH} ctx={{ company: '', workflow: chosen.id, workflowLabel: chosen.id === 'rescore' ? String(recheckCount) : chosen.label }} finalFocus={anchor ?? trigger} onDone={onStarted} onClose={() => setChosen(null)} />}
        </>
    );
}
