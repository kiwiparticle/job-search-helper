import { Popover } from '@base-ui/react/popover';
import { useId, useState } from 'react';
import { useAct, useActiveRuns, useKits } from '../data';
import type { Company } from '../model';
import { kitStatus } from '../pipeline';
import { ActionButton } from '../toast';
import type { JobRef } from './JobPage';
import { Check, Tip } from './ui';

// The kit action for one job. Apply and Retry kit both send it; `applying` moves the job to Applying.
const kitBody = (company: Company, job: JobRef, pieces: string, note?: string) => ({
    type: 'kit', company: company.name, role: job.role, url: job.url, postingId: job.id, pieces, drafter: 'claude', ...(note && { note }), applying: true,
});

// Apply: pick the kit pieces, then start the kit. The job moves to Applying until Mark applied.
export function ApplyButton({ company, job }: { company: Company; job: JobRef }) {
    const act = useAct();
    const [open, setOpen] = useState(false);
    const [letter, setLetter] = useState(false);
    const [answers, setAnswers] = useState(false);
    const [note, setNote] = useState('');
    const [sending, setSending] = useState(false);
    const id = useId();
    if (!job.url) return <Tip text="Add the posting link first (Actions ▾ → Edit posting link)."><button type="button" className="primary" disabled>Apply</button></Tip>;
    const pieces = ['resume', letter && 'cover-letter', answers && 'answers'].filter(Boolean).join(',');
    // One kit per click: the button stays off while the request is out.
    const send = () => { setSending(true); act(kitBody(company, job, pieces, note.trim()), `Kit started for ${job.role}. It shows under Applying.`).then((ok) => { setSending(false); if (ok) setOpen(false); }); };
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip text="Start the application kit. The job moves to Applying."><Popover.Trigger className="primary">Apply</Popover.Trigger></Tip>
            <Popover.Portal>
                <Popover.Positioner className="pop-pos" sideOffset={6} align="end">
                    <Popover.Popup className="menu apply-pop" aria-label="Apply">
                        <form className="apply-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
                            <Check checked disabled>Resume</Check>
                            <Check checked={letter} onChange={setLetter}>Cover letter</Check>
                            <Check checked={answers} onChange={setAnswers}>Answers</Check>
                            <label htmlFor={id} className="small">Note for the drafter</label>
                            <textarea id={id} value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} />
                            <button type="submit" className="primary" disabled={sending}>{sending ? 'Starting…' : 'Start kit'}</button>
                        </form>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

// An applying job with no kit and none drafting: send the kit again (a resume; the pieces of the first try are not kept).
export function RetryKitButton({ company, job }: { company: Company; job: JobRef }) {
    const act = useAct();
    return <ActionButton action={() => act(kitBody(company, job, 'resume'), 'Kit started again.')}>Retry kit</ActionButton>;
}

// Kit status as a chip on New's Applying rows.
export function KitChip({ company, role, postingId, kitStartedAt }: { company: string; role: string; postingId: string; kitStartedAt?: string }) {
    const { data: kits = [] } = useKits();
    const { state } = kitStatus(company, role, postingId, kits, useActiveRuns(), kitStartedAt);
    return state === 'drafting' ? <span className="apply-chip small nowrap">Kit drafting…</span>
        : state === 'ready' ? <span className="apply-chip apply-chip-ready small nowrap">Kit ready</span>
        : <span className="apply-chip apply-chip-missing small nowrap">No kit yet</span>;
}
