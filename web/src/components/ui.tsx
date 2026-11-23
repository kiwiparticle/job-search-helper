import { Checkbox } from '@base-ui/react/checkbox';
import { Select } from '@base-ui/react/select';
import { Collapsible } from '@base-ui/react/collapsible';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Tooltip } from '@base-ui/react/tooltip';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

// A section that folds. `heading` wraps the trigger in that heading level; without it the trigger stands alone.
// `aside` sits at the end of the heading row, outside the toggle (buttons can't nest in it).
export function Fold({ title, heading, defaultOpen = false, className, label, aside, onOpenChange, children }: {
    title: ReactNode; heading?: 'h2' | 'h3'; defaultOpen?: boolean; className?: string; label?: string; aside?: ReactNode;
    onOpenChange?: (open: boolean) => void; children: ReactNode;
}) {
    const trigger = <Collapsible.Trigger className="fold-trigger">{title}</Collapsible.Trigger>;
    const H = heading;
    return (
        <Collapsible.Root className={`fold ${className ?? ''}`} defaultOpen={defaultOpen} onOpenChange={onOpenChange} aria-label={label}>
            {H ? <H className={H === 'h2' ? 'group-label fold-heading' : 'fold-heading'}>{trigger}</H> : trigger}
            {aside && <div className="fold-aside">{aside}</div>}
            <Collapsible.Panel className="fold-panel">{children}</Collapsible.Panel>
        </Collapsible.Root>
    );
}

// A checkbox with its label.
export function Check({ checked, onChange, value, disabled, children }: { checked?: boolean; onChange?: (checked: boolean) => void; value?: string; disabled?: boolean; children: ReactNode }) {
    return (
        <label className="check">
            <Checkbox.Root className="check-box" checked={checked} onCheckedChange={onChange} value={value} disabled={disabled}>
                <Checkbox.Indicator className="check-mark">✓</Checkbox.Indicator>
            </Checkbox.Root>
            {children}
        </label>
    );
}

// A dropdown choice: Base UI Select. `label` is the accessible name (there is no visible label).
export function Choice({ value, onChange, options, label, className }: {
    value: string; onChange: (value: string) => void; options: { value: string; label: string; disabled?: boolean }[]; label: string; className?: string;
}) {
    return (
        <Select.Root items={options} value={value} onValueChange={(v) => { if (v !== null) onChange(v); }}>
            <Select.Trigger className={`select-trigger ${className ?? ''}`} aria-label={label}>
                <Select.Value />
                <Select.Icon className="select-icon">▾</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
                <Select.Positioner className="pop-pos" sideOffset={4} alignItemWithTrigger={false}>
                    <Select.Popup className="menu select-popup">
                        <Select.List className="select-list">
                            {options.map((o) => (
                                <Select.Item key={o.value} value={o.value} disabled={o.disabled} className="menu-item select-item">
                                    <Select.ItemText>{o.label}</Select.ItemText>
                                    <Select.ItemIndicator className="select-check">✓</Select.ItemIndicator>
                                </Select.Item>
                            ))}
                        </Select.List>
                    </Select.Popup>
                </Select.Positioner>
            </Select.Portal>
        </Select.Root>
    );
}

// A styled tooltip around one element (Base UI Tooltip). No text, no tooltip.
export function Tip({ text, children }: { text?: string; children: ReactElement }) {
    if (!text) return children;
    return (
        <Tooltip.Root>
            <Tooltip.Trigger render={children} />
            <Tooltip.Portal>
                <Tooltip.Positioner sideOffset={6} className="pop-pos">
                    <Tooltip.Popup className="tooltip">{text}</Tooltip.Popup>
                </Tooltip.Positioner>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

// A button with an optional tooltip: use it where a plain <button title="…"> would have gone.
export function Button({ title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
    return <Tip text={title}><button {...rest} /></Tip>;
}

// A modal popup (Base UI Dialog). `title` names it; `hideTitle` keeps that name for screen readers only.
export function Popup({ open, onOpenChange, title, hideTitle, className, children }: {
    open: boolean; onOpenChange: (open: boolean) => void; title: string; hideTitle?: boolean; className?: string; children: ReactNode;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className={`dialog ${className ?? ''}`}>
                    <Dialog.Title className={hideTitle ? 'sr-only' : 'dialog-title'}>{title}</Dialog.Title>
                    {children}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

// Tabs (Base UI). The chosen tab lives in this component's state, so a re-render keeps it. Only the open panel is mounted.
export function Tabs({ tabs, defaultValue, label }: { tabs: { value: string; label: ReactNode; panel: ReactNode }[]; defaultValue: string; label: string }) {
    return (
        <BaseTabs.Root className="tabs" defaultValue={defaultValue}>
            <BaseTabs.List className="tab-list" aria-label={label}>
                {tabs.map((t) => <BaseTabs.Tab key={t.value} value={t.value} className="tab">{t.label}</BaseTabs.Tab>)}
            </BaseTabs.List>
            {tabs.map((t) => <BaseTabs.Panel key={t.value} value={t.value} className="tab-panel">{t.panel}</BaseTabs.Panel>)}
        </BaseTabs.Root>
    );
}
