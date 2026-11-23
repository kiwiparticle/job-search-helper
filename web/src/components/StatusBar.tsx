import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { describeRun, useActiveRuns, type ActiveRun } from '../data';
import { useModels } from '../models';
import { ExtLink } from '../text';
import { RunLabel } from './StatusPage';

const STEP: Record<string, string> = {
    setup: 'Starting', finish: 'Merging results', kit: 'Drafting and reviewing', ask: 'Answering',
};
// `search (<id>)` and `review (<id>)` are the job names for any model in the registry.
const stepText = (step: string | null | undefined, label: (id: string) => string) => {
    const m = /^(search|review) \((.+)\)$/.exec(step ?? '');
    return m ? `${label(m[2])} is ${m[1] === 'search' ? 'searching' : 'reviewing'}` : STEP[step ?? ''] ?? step ?? 'Running';
};
const LABEL: Record<string, string> = { search: 'Search run', kit: 'Application kit', ask: 'Question' };
const elapsed = (iso: string, now: number) => {
    const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// The running-work toast. Shares the app's status poll; `poke` asks for a fresh look right away
// and onDone fires when the last run ends.
export function StatusBar({ poke, onDone, silent }: { poke: number; onDone: () => void; silent?: boolean }) {
    const client = useQueryClient();
    const active = useActiveRuns();
    const { label } = useModels();
    // A queue: waiting runs on top (the next one right above the running ones), running runs at the bottom.
    const by = (a: ActiveRun, b: ActiveRun) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '');
    const waiting = active.filter((r) => r.status === 'queued').sort(by);
    const runs = [...waiting.reverse(), ...active.filter((r) => r.status !== 'queued').sort(by)];
    const [now, setNow] = useState(Date.now());
    const was = useRef(0);
    const [min, setMin] = useState(true); // collapsed to a pill by default; in memory only
    const done = useRef(onDone);
    done.current = onDone;

    useEffect(() => { if (poke) client.invalidateQueries({ queryKey: ['status'] }); }, [poke, client]);
    useEffect(() => {
        if (was.current && !runs.length) done.current();
        if (runs.length > was.current && (was.current > 0 || poke)) setMin(false); // a run the owner starts, or one added while others show, opens the cards; the first load stays a pill
        was.current = runs.length;
    }, [runs.length, poke]);
    useEffect(() => {
        if (!runs.length) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [runs.length]);

    const running = runs.length - waiting.length;
    const pill = [running && `${running} running`, waiting.length && `${waiting.length} waiting`].filter(Boolean).join(' · ');
    if (silent) return null; // only the finish callback runs; the header's copy draws the cards
    return (
        <div className="status">
            {runs.length > 0 && min && <button type="button" className="status-pill" onClick={() => setMin(false)}>{pill}</button>}
            {runs.length > 0 && !min && <button type="button" className="status-pill" onClick={() => setMin(true)}>Minimize</button>}
            {!min && runs.map((r, i) => {
                const queued = r.status === 'queued';
                const place = waiting.length - i; // 1 = next up
                return (
                    <p key={r.url ?? r.title} className={queued ? 'running waiting' : 'running'} role="status">
                        <span className={queued ? 'pulse wait' : 'pulse'} aria-hidden="true" />
                        <RunLabel title={describeRun(r.title) ? r.title : (LABEL[r.workflow] ?? r.title)} fallback={r.workflow} />. {queued ? (place === 1 ? 'Next up, waiting for your PC.' : `Waiting for your PC, #${place} in line.`) : `${stepText(r.step, label)}.`}
                        {!queued && r.startedAt && <> <span className="num">{elapsed(r.startedAt, now)}</span></>}
                        {r.url && <> <ExtLink href={r.url}>Details</ExtLink></>}
                    </p>
                );
            })}
        </div>
    );
}
