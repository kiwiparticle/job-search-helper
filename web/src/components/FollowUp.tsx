import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { followUpName, useAct, useActiveRuns, useFollowUp } from '../data';
import type { Application, Company } from '../model';
import { addDays, localToday } from '../pipeline';
import { useToast } from '../toast';
import { Button, Popup } from './ui';

// Draft follow-up on an open application: who it goes to, the newest drafted email, Copy, and I sent it (next step in a week).
// `button` false hides the button (no follow-up due); the card's menu then opens the popup through `open`/`onOpenChange`.
export function FollowUpButton({ company, app, button = true, open: openProp, onOpenChange }: {
    company: Company; app: Application; button?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const setOpen = onOpenChange ?? setOpenState;
    const act = useAct();
    const client = useQueryClient();
    const toast = useToast();
    const runs = useActiveRuns();
    const draft = useFollowUp(company.name, app.role, app.id, open);
    const [sendTo, setSendTo] = useState(app.sendTo ?? '');
    const [sending, setSending] = useState(false);
    const drafting = runs.some((r) => r.title === `followup ${company.name} | ${app.role}`);
    // A finished run leaves a new file: look again, for this application only.
    const was = useRef(false);
    useEffect(() => {
        if (drafting) setSending(false);
        if (was.current && !drafting) client.invalidateQueries({ queryKey: ['followup', followUpName(company.name, app.role, app.id)] });
        was.current = drafting;
    }, [drafting, client, company.name, app.role, app.id]);
    if (app.outcome !== 'applied') return null;
    const ids = { company: company.name, applicationId: app.id };
    const text = draft.data;
    return (
        <>
            {button && <Button type="button" title="Draft a follow-up email for this application." onClick={() => setOpen(true)}>Draft follow-up</Button>}
            <Popup open={open} onOpenChange={setOpen} title={`Follow up: ${company.name}`} className="followup-pop">
                <form className="form followup-to" onSubmit={(e) => { e.preventDefault(); if (sendTo.trim() !== (app.sendTo ?? '')) act({ type: 'setSendTo', ...ids, sendTo: sendTo.trim() }, 'Saved.'); }}>
                    <label>Send to (name or role)
                        <input value={sendTo} maxLength={200} onChange={(e) => setSendTo(e.target.value)} />
                    </label>
                    <div className="row"><button type="submit">Save</button></div>
                </form>
                {text ? <pre className="followup-draft">{text}</pre> : <p className="muted small">{draft.isPending ? 'Loading…' : 'No draft yet.'}</p>}
                <div className="row followup-actions">
                    <Button type="button" disabled={drafting || sending} onClick={async () => {
                        setSending(true);
                        // GitHub takes a few seconds to list the run: stay disabled until it shows, so a second click can't start another.
                        if (!(await act({ type: 'followup', ...ids }, 'Drafting a follow-up. It shows here in a few minutes.'))) setSending(false);
                    }}>
                        {drafting || sending ? 'Drafting…' : text ? 'Draft again' : 'Draft it'}
                    </Button>
                    {text && <Button type="button" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied.'), () => toast("Couldn't copy. Select the text instead."))}>Copy</Button>}
                    {text && <Button type="button" onClick={async () => { const on = addDays(localToday(), 7); if (await act({ type: 'setNextStep', ...ids, text: 'Followed up', on }, `Next follow-up set for ${on}.`)) setOpen(false); }}>I sent it</Button>}
                </div>
            </Popup>
        </>
    );
}
