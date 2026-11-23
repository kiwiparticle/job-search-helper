import { useState } from 'react';
import { CAPS } from '../../../lib/caps.js';
import { notesOf } from '../../../lib/notes.js';
import { useAct } from '../data';
import { dayText } from '../format';
import type { Company } from '../model';
import { Button, Popup } from './ui';
import { InlineForm } from './CompanyPage';

// The owner's dated notes on a company, or on one job when `postingId` is given. Newest first.
// `index` sent to the server is the stored (oldest-first) position; an empty note deletes.
const when = (n: { at: string }) => (n.at ? dayText(n.at.slice(0, 10)) : 'earlier');

export function Notes({ company, postingId }: { company: Company; postingId?: string }) {
    const act = useAct();
    // `was` is the text the owner saw when the form opened, so the server can tell if the list moved.
    const [dropping, setDropping] = useState<{ index: number; was: string } | null>(null);
    const [open, setOpen] = useState<{ index: number; was: string } | 'new' | null>(null);
    const notes = notesOf(company, postingId) as { at: string; text: string }[];
    const what = postingId ? 'job' : 'company';
    const send = (note: string, done: string, index?: number, was?: string) =>
        act({ type: 'setNote', company: company.name, ...(postingId && { postingId }), ...(index !== undefined && { index, was }), note }, done);
    return (
        <div className="notes">
            <Button type="button" title={`Your own notes on this ${what}. Models never change them.`} className="link small note-btn" onClick={() => setOpen('new')}>+ note</Button>
            {notes.length > 0 && (
                <ul className="notes-list">
                    {notes.map((n, i) => ({ n, i })).reverse().map(({ n, i }) => (
                        <li key={i} className="job-note">
                            <span className="muted small">{when(n)}</span>{' '}
                            <span className="pre">{n.text}</span>{' '}
                            <Button type="button" className="link small" aria-label={`Edit note from ${when(n)}`} onClick={() => setOpen({ index: i, was: n.text })}>Edit</Button>{' '}
                            <Button type="button" className="link small" aria-label={`Delete note from ${when(n)}`} onClick={() => { setOpen(null); setDropping({ index: i, was: n.text }); }}>Delete</Button>
                        </li>
                    ))}
                </ul>
            )}
            <Popup open={dropping !== null} onOpenChange={(o) => { if (!o) setDropping(null); }} title="Delete this note?">
                <div className="row">
                    <Button type="button" className="primary" onClick={() => { if (dropping) send('', 'Note deleted.', dropping.index, dropping.was); setDropping(null); }}>Delete</Button>
                    <Button type="button" className="link" onClick={() => setDropping(null)}>Cancel</Button>
                </div>
            </Popup>
            {open !== null && (
                <InlineForm key={open === 'new' ? 'new' : open.index} title="My notes" onClose={() => setOpen(null)}
                    initial={{ note: open === 'new' ? '' : open.was }}
                    fields={[{ name: 'note', label: 'Note', long: true, required: true, max: CAPS.notes }]}
                    submit={(v) => open === 'new' ? send(v.note, 'Note added.') : send(v.note, 'Note saved.', open.index, open.was)} />
            )}
        </div>
    );
}
