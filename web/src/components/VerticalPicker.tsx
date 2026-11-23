import { Popover } from '@base-ui/react/popover';
import { useVerticals } from '../data';
import { Check, Tip } from './ui';

// A dropdown of checkboxes for the verticals in data/verticals.json, grouped.
export function VerticalPicker({ picked, setPicked }: { picked: string[]; setPicked: (v: string[]) => void }) {
    const { data: verticals = [] } = useVerticals();
    const groups = [...new Set(verticals.map((v) => v.group))];
    const toggle = (name: string) => setPicked(picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name]);
    if (!verticals.length) return null;
    return (
        <Popover.Root>
            <Tip text="Choose which verticals to sweep. Leave empty for the usual weekly queue."><Popover.Trigger className="menu-trigger">{picked.length ? `${picked.length} selected` : 'Pick verticals'} ▾</Popover.Trigger></Tip>
            <Popover.Portal>
                <Popover.Positioner className="pop-pos" sideOffset={6} align="start">
                    <Popover.Popup className="menu vertical-menu">
                        {groups.map((g) => (
                            <fieldset key={g}>
                                <legend>{g}</legend>
                                {verticals.filter((v) => v.group === g).map((v) => (
                                    <Check key={v.name} checked={picked.includes(v.name)} onChange={() => toggle(v.name)}>{v.name}</Check>
                                ))}
                            </fieldset>
                        ))}
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
