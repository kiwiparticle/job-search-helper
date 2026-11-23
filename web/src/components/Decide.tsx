import { Popover } from '@base-ui/react/popover';
import { useId, useState } from 'react';
import { useAct, useReasons } from '../data';
import { ActionButton } from '../toast';
import { Tip } from './ui';

// Skip or Save one role. The first click opens the reasons in a popover: one tap on a chip does it with that reason,
// "Other" takes the owner's own words, and "… without a reason" does it plain. Reasons feed the tune run.
export function Decide({ kind, body, done, title, className, children }: {
    kind: 'skip' | 'save'; body: Record<string, unknown>; done: string; title: string; className?: string; children: string;
}) {
    const act = useAct();
    const reasons = useReasons()[kind];
    const [open, setOpen] = useState(false);
    const [other, setOther] = useState('');
    const id = useId();
    const verb = kind === 'skip' ? 'Skip' : 'Save';
    // Closes once it worked; a failed send keeps the popover open to try again.
    const send = (reason?: string) => act({ type: kind === 'skip' ? 'skipJob' : 'saveJob', ...body, ...(reason && { reason }) }, done).then((ok) => { if (ok) setOpen(false); });
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip text={title}><Popover.Trigger className={className}>{children}</Popover.Trigger></Tip>
            <Popover.Portal>
                <Popover.Positioner className="pop-pos" sideOffset={6} align="end">
                    <Popover.Popup className="menu reasons" aria-label={`Why ${kind}?`}>
                        <span className="small">Why? One tap, or {kind} without one.</span>
                        <div className="chips">{reasons.map((r) => <ActionButton key={r} className="chip" action={() => send(r)}>{r}</ActionButton>)}</div>
                        <form className="row" onSubmit={(e) => { e.preventDefault(); if (other.trim()) send(other.trim()); }}>
                            <label htmlFor={id} className="small">Other</label>
                            <input id={id} value={other} maxLength={120} placeholder="say it in a few words" onChange={(e) => setOther(e.target.value)} />
                            <button type="submit" disabled={!other.trim()}>{verb}</button>
                        </form>
                        <ActionButton action={() => send()}>{verb} without a reason</ActionButton>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
