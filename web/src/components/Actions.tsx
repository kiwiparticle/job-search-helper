import { Menu } from '@base-ui/react/menu';
import { useRef, useState, type ReactNode } from 'react';
import { actionsFor, isDirect, labelOf, type ActionDef, type Ctx, type ItemType } from '../actions';
import { useWorking } from '../data';
import { ActionModal, useDirectPost } from './ActionModal';
import { Tip } from './ui';

// The registry's actions for one item, then the page's own menu items. The modal sits beside the menu so closing the menu keeps it open.
// `omit`: action ids the page already shows as a button.
export function ActionsMenu({ item, ctx, children, onDone, omit = [] }: { item: ItemType; ctx: Ctx; children?: ReactNode; onDone?: () => void; omit?: string[] }) {
    const [chosen, setChosen] = useState<ActionDef | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const { post } = useDirectPost(ctx);
    const working = useWorking(ctx.company, ctx.role, true);
    const defs = actionsFor(item, ctx).filter((d) => !omit.includes(d.id));
    const entry = (def: ActionDef) => (
        <Tip key={def.id} text={def.tip}>
            <Menu.Item className={def.danger ? 'menu-item danger' : 'menu-item'} disabled={def.disabled?.(working)} onClick={() => (isDirect(def, ctx) ? post(def) : setChosen(def))}>{labelOf(def, ctx)}</Menu.Item>
        </Tip>
    );
    return (
        <>
            <Menu.Root>
                <Tip text="Actions for this item"><Menu.Trigger ref={trigger} className="menu-trigger">Actions ▾</Menu.Trigger></Tip>
                <Menu.Portal>
                    <Menu.Positioner className="pop-pos" sideOffset={6} align="start">
                        <Menu.Popup className="menu" finalFocus={trigger}>
                            {defs.filter((d) => !d.last).map(entry)}
                            {children}
                            {defs.filter((d) => d.last).map(entry)}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
            {chosen && <ActionModal def={chosen} ctx={ctx} finalFocus={trigger} onDone={onDone} onClose={() => setChosen(null)} />}
        </>
    );
}
