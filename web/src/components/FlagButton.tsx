import { Popover } from '@base-ui/react/popover';
import { useId, useState } from 'react';
import { useAct } from '../data';
import type { Company } from '../model';
import { Tip } from './ui';
import type { JobRef } from './JobPage';

// Flag a job or a company to come back to. Unflagged: a popover takes an optional note. Flagged: one click unflags.
export function FlagButton({ company, job }: { company: Company; job?: JobRef }) {
    const act = useAct();
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState('');
    const id = useId();
    const flagged = Boolean(job ? company.jobFlags?.[job.id] : company.flag);
    const body = {
        type: 'setFlag', company: company.name,
        ...(job && { postingId: job.id, role: job.role, leadKey: job.leadKey, ...(job.url && { url: job.url }) }),
    };
    const tip = job
        ? 'Come back to this later. It shows at the top of New until you unflag, skip or apply.'
        : 'Come back to this later. It shows at the top of New until you unflag or rule it out.';
    if (flagged) {
        return <Tip text={tip}><button type="button" aria-pressed="true" onClick={() => act({ ...body, on: false }, 'Unflagged.')}>Flagged ⚑</button></Tip>;
    }
    const send = () => act({ ...body, on: true, ...(note.trim() && { note: note.trim() }) }, 'Flagged.').then((ok) => { if (ok) { setOpen(false); setNote(''); } });
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip text={tip}><Popover.Trigger>Flag</Popover.Trigger></Tip>
            <Popover.Portal>
                <Popover.Positioner className="pop-pos" sideOffset={6} align="end">
                    <Popover.Popup className="menu flag-pop" aria-label="Flag">
                        <form className="flag-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
                            <label htmlFor={id} className="small">Note (optional)</label>
                            <textarea id={id} value={note} maxLength={1500} rows={3} onChange={(e) => setNote(e.target.value)} />
                            <button type="submit" className="primary">Flag</button>
                        </form>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
