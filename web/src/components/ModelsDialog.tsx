import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAct } from '../data';
import { useModels, type ModelEntry } from '../models';
import { Check, Popup } from './ui';

// Turn models on or off (data/models.json `enabled`). An off model leaves every picker and default,
// and "both" means only the one of Claude and Codex still on.
export function ModelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { all } = useModels();
    const act = useAct();
    const client = useQueryClient();
    const [picked, setPicked] = useState<Record<string, boolean>>({});
    const [sending, setSending] = useState(false);
    const listed = all.filter((m) => !m.missing);
    const isOn = (m: ModelEntry) => picked[m.id] ?? m.enabled !== false;
    const changed = Object.fromEntries(Object.entries(picked).filter(([id, v]) => v !== (all.find((m) => m.id === id)?.enabled !== false)));
    const close = (o: boolean) => { if (!o) setPicked({}); onOpenChange(o); };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!Object.keys(changed).length) { close(false); return; }
        setSending(true);
        try {
            if (await act({ type: 'setModels', enabled: changed }, 'Models saved. New runs use them.')) {
                // GitHub can serve the old file for a moment, so show the change now.
                client.setQueryData(['models'], (old: { models: ModelEntry[] } | null | undefined) =>
                    old && { ...old, models: old.models.map((m) => (m.id in changed ? { ...m, enabled: changed[m.id] } : m)) });
                close(false);
            }
        } finally { setSending(false); }
    };
    return (
        <Popup open={open} onOpenChange={close} title="Models">
            <form className="form" onSubmit={save}>
                <p className="muted small">Unchecked models leave every picker and default. Runs already started keep theirs.</p>
                <div className="models-list" role="group" aria-label="Models">
                    {listed.map((m) => <Check key={m.id} checked={isOn(m)} onChange={(v) => setPicked((p) => ({ ...p, [m.id]: v }))}>{m.label}</Check>)}
                </div>
                {!listed.some(isOn) && <p className="error" role="alert">Keep at least one model on.</p>}
                <div className="row">
                    <button type="submit" className="primary" disabled={sending || !listed.some(isOn)}>Save</button>
                    <button type="button" className="link" onClick={() => close(false)}>Cancel</button>
                </div>
            </form>
        </Popup>
    );
}
