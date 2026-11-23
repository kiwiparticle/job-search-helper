import { useState, type ReactNode } from 'react';
import { isDirect, type ActionDef, type Ctx } from '../actions';
import { useWorking } from '../data';
import { ActionModal, useDirectPost } from './ActionModal';
import { Button } from './ui';

// A button that opens one registry action's modal. Disabled per def.disabled while a run for this role is active.
export function OpenAction({ def, ctx, children, className, onDone, busyText }: {
    def: ActionDef; ctx: Ctx; children: ReactNode; className?: string; onDone?: () => void; busyText?: string;
}) {
    const [open, setOpen] = useState(false);
    const working = useWorking(ctx.company, ctx.role, true);
    const { post, sending } = useDirectPost(ctx);
    const busy = Boolean(def.disabled?.(working));
    return (
        <>
            <Button title={def.tip} className={className} disabled={busy || sending} onClick={() => (isDirect(def, ctx) ? post(def) : setOpen(true))}>{busy && busyText ? busyText : children}</Button>
            {open && <ActionModal def={def} ctx={ctx} onDone={onDone} onClose={() => setOpen(false)} />}
        </>
    );
}
