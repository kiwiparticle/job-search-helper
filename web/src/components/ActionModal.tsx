import { Dialog } from '@base-ui/react/dialog';
import { useId, useRef, useState, type RefObject } from 'react';
import { labelOf, type ActionDef, type Ctx, type Param } from '../actions';
import { useAct, useReasons } from '../data';
import { fitsBudget, useModels } from '../models';
import { useSearchModels } from './ModelPicker';
import { Check, Choice } from './ui';
import { VerticalPicker } from './VerticalPicker';

// Posts a direct action (no visible field) without a dialog. The ref blocks a second click while one is pending.
export function useDirectPost(ctx: Ctx) {
    const act = useAct();
    const { label } = useModels();
    const flag = useRef(false);
    const [sending, setSending] = useState(false);
    const post = async (def: ActionDef) => {
        if (flag.current) return;
        flag.current = true;
        setSending(true);
        try { await act(def.body(ctx, {}, {}), def.done(ctx, {}, label)); } finally { flag.current = false; setSending(false); }
    };
    return { post, sending };
}

// One dialog for every registry action: its text params, then the model fields when it asks for them.
export function ActionModal({ def, ctx, onClose, onDone, finalFocus }: { def: ActionDef; ctx: Ctx; onClose: () => void; onDone?: () => void; finalFocus?: RefObject<HTMLElement | null> }) {
    const id = useId();
    const act = useAct();
    const { fields, pick } = useSearchModels(ctx.workflow ?? def.workflow);
    const { models, defaults, label, allowed } = useModels();
    const [values, setValues] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);
    const reasons = useReasons();
    const base = labelOf(def, ctx).replace(/…$/, '');
    const title = def.title?.(ctx) ?? (ctx.role ? `${base} ${ctx.role}` : base);

    // The value a field shows, and posts when untouched. A model starts on the registry default if it is usable.
    const modelOptions = (p: Extract<Param, { kind: 'model' }>) => [
        ...models.map((m) => { const fit = fitsBudget(m, p.workflow); return { value: m.id, label: fit.ok ? m.label : `${m.label} (${fit.why})`, disabled: !fit.ok }; }),
        ...(p.extra ?? []).filter((o) => allowed(o.value)),
    ];
    const choiceOptions = (p: Extract<Param, { kind: 'choice' }>) => p.options.filter((o) => allowed(o.value));
    const current = (p: Param): string => {
        if (!('name' in p)) return '';
        if (p.name in values) return values[p.name];
        if (p.kind === 'choice') return allowed(p.default) ? p.default : choiceOptions(p)[0]?.value ?? p.default;
        if (p.kind === 'model') {
            const want = defaults[p.workflow].model;
            const usable = models.some((m) => m.id === want && fitsBudget(m, p.workflow).ok) || modelOptions(p).some((o) => o.value === want && !('disabled' in o && o.disabled));
            return usable ? want : modelOptions(p).find((o) => !('disabled' in o && o.disabled))?.value ?? 'claude';
        }
        return ('initial' in p && p.initial?.(ctx)) || '';
    };
    const shown = def.params.filter((p) => p.show?.(ctx) ?? true);
    const set = (name: string, v: string) => { setValues((o) => ({ ...o, [name]: v })); setError(''); };

    // A reason chip passes `chip`: it goes in front of the text its param points at.
    const submit = async (chip?: { into: string; reason: string }) => {
        const named = shown.filter((p): p is Exclude<Param, { kind: 'searchModels' | 'reasons' }> => 'name' in p && p.kind !== 'reasons');
        const clean = Object.fromEntries(named.map((p) => [p.name, current(p).trim()]));
        if (chip) clean[chip.into] = [chip.reason, clean[chip.into]].filter(Boolean).join('. ');
        const missing = named.find((p) => 'required' in p && p.required && !clean[p.name]);
        if (missing) { setError(`${missing.label} is required.`); return; }
        if (sending) return;
        setSending(true);
        try {
            if (await act(def.body(ctx, clean, pick), def.done(ctx, clean, label))) { onDone?.(); onClose(); }
        } finally { setSending(false); }
    };
    const onSubmit = (e: React.FormEvent) => { e.preventDefault(); submit(); };
    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog" finalFocus={finalFocus}>
                    <Dialog.Title className="dialog-title">{title}</Dialog.Title>
                    <form className="form" onSubmit={onSubmit} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
                        {shown.map((p) => {
                            if (p.kind === 'text') return (
                                <label key={p.name} htmlFor={`${id}-${p.name}`}>{p.label}
                                    <input id={`${id}-${p.name}`} type={p.type ?? 'text'} maxLength={500} value={current(p)} onChange={(e) => set(p.name, e.target.value)} />
                                </label>
                            );
                            if (p.kind === 'reasons') return reasons[p.list].length > 0 && (
                                <div key={p.name} className="chips" role="group" aria-label="Reasons">
                                    {reasons[p.list].map((r) => <button key={r} type="button" className="chip" disabled={sending} onClick={() => submit({ into: p.into, reason: r })}>{r}</button>)}
                                </div>
                            );
                            if (p.kind === 'textarea') return (
                                <label key={p.name} htmlFor={`${id}-${p.name}`}>{p.label}
                                    <textarea id={`${id}-${p.name}`} maxLength={p.max} rows={4} value={current(p)} onChange={(e) => set(p.name, e.target.value)} />
                                </label>
                            );
                            if (p.kind === 'choice' || p.kind === 'model') return (
                                <label key={p.name}>{p.label}
                                    <Choice label={p.label} value={current(p)} onChange={(v) => set(p.name, v)} options={p.kind === 'choice' ? choiceOptions(p) : modelOptions(p)} />
                                </label>
                            );
                            if (p.kind === 'checks') {
                                const on = current(p).split(',').filter(Boolean);
                                const opts = p.options(ctx);
                                return (
                                    <fieldset key={p.name}><legend>{p.label}</legend>
                                        {opts.map((o) => (
                                            <Check key={o.value} checked={on.includes(o.value)}
                                                onChange={(c) => set(p.name, opts.map((x) => x.value).filter((v) => (v === o.value ? c : on.includes(v))).join(','))}>{o.label}</Check>
                                        ))}
                                    </fieldset>
                                );
                            }
                            if (p.kind === 'verticals') return (
                                <div key={p.name}>{p.label}
                                    <VerticalPicker picked={current(p).split('; ').filter(Boolean)} setPicked={(v) => set(p.name, v.join('; '))} />
                                </div>
                            );
                            return null;
                        })}
                        {shown.some((p) => p.kind === 'searchModels') && fields}
                        {error && <p className="error" role="alert">{error}</p>}
                        <div className="row">
                            <button type="submit" className="primary" disabled={sending}>{def.submit}</button>
                            <span className="muted small">Ctrl+Enter</span>
                            <button type="button" className="link" onClick={onClose}>Cancel</button>
                        </div>
                    </form>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
