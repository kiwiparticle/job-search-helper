import { useState } from 'react';
import Markdown from 'react-markdown';
import { getJson, getText } from '../api';
import { useQuery } from '@tanstack/react-query';
import { useAct, useSupplement } from '../data';
import type { SupplementEntry } from '../model';
import { ActionButton, useConfirm } from '../toast';
import { Choice, Fold } from './ui';

// The owner lists the headings code may add to. A missing file just means none: nothing can be merged.
const useSections = () => useQuery({ queryKey: ['master-sections'], queryFn: () => getJson<string[]>('data/master-sections.json').catch(() => [] as string[]) });

// master-resume.md as plain text, loaded only when the owner opens it.
function MasterPreview() {
    const [open, setOpen] = useState(false);
    const { data, isError } = useQuery({ queryKey: ['master-md'], queryFn: () => getText('master-resume.md'), enabled: open });
    return (
        <Fold className="group" heading="h2" title="master-resume.md" onOpenChange={setOpen}>
            {isError ? <p className="meta" role="alert">Couldn't load master-resume.md.</p>
                : data === undefined ? <p className="muted small">Loading…</p>
                : <div className="md"><Markdown>{data}</Markdown></div>}
        </Fold>
    );
}

function Fact({ entry, sections }: { entry: SupplementEntry; sections: string[] }) {
    const act = useAct();
    const ask = useConfirm();
    const [text, setText] = useState(entry.text);
    const [section, setSection] = useState(entry.section ?? sections[0] ?? '');
    const merging = entry.status === 'merging';
    return (
        <li className="card stack">
            {entry.question && <p className="meta">Asked: {entry.question}</p>}
            <textarea rows={3} aria-label="The fact, as it will read in your master resume" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row">
                <span className="row">Add under <Choice label="Heading to add under" value={section} onChange={setSection} options={sections.map((s) => ({ value: s, label: s }))} /></span>
                <ActionButton
                    className="primary"
                    disabled={!section || !text.trim()}
                    title="A short job adds this line to master-resume.md under that heading, commits it, and marks the fact merged. Script, no model."
                    action={async () => { if (await ask(`Add this line to master-resume.md under "${section}"?`)) await act({ type: 'mergeSupplement', id: entry.id, section, text: text.trim() }, 'Merging. The line lands in master-resume.md in a minute.'); }}
                >{merging ? 'Try the merge again' : 'Add to master'}</ActionButton>
                {!merging && text.trim() !== entry.text && <ActionButton title="Keep this wording as a supplemental fact." action={() => act({ type: 'editSupplement', id: entry.id, text: text.trim() }, 'Saved.')}>Save wording</ActionButton>}
                <ActionButton title="Stop using this fact in kits." action={() => act({ type: 'dismissSupplement', id: entry.id }, 'Dismissed.')}>Dismiss</ActionButton>
            </div>
            {entry.error && <p className="meta" role="alert">Last merge failed: {entry.error}</p>}
            {merging && <p className="meta" role="status">Merge started{entry.section ? ` under "${entry.section}"` : ''}. If it doesn't finish, look at the merge-master run on GitHub, then try again.</p>}
        </li>
    );
}

export function MasterPage() {
    const { data: facts = [], isPending } = useSupplement();
    const { data: sections = [] } = useSections();
    const act = useAct();
    const [added, setAdded] = useState('');
    if (isPending) return <p className="empty">Loading…</p>;
    const live = facts.filter((f) => f.status === 'open' || f.status === 'merging').sort((a, b) => b.at.localeCompare(a.at));
    const done = facts.filter((f) => f.status === 'merged').sort((a, b) => b.at.localeCompare(a.at));
    return (
        <main className="page">
            <div className="head"><h1>Master</h1><p className="muted">Facts you supplied outside master-resume.md. Kits use them as true until you add one to the master or dismiss it.</p></div>
            <section className="card stack" aria-label="Add a fact">
                <h3>Add a fact</h3>
                <textarea rows={2} aria-label="A true fact about your work" placeholder="A true fact the master doesn't say yet" value={added} onChange={(e) => setAdded(e.target.value)} />
                <div className="row"><ActionButton disabled={!added.trim()} action={async () => { if (await act({ type: 'addSupplement', text: added.trim() }, 'Saved. Kits will use it.')) setAdded(''); }}>Save fact</ActionButton></div>
            </section>
            <h2 className="group-label">Waiting for a decision<span className="n">{live.length}</span></h2>
            {live.length ? <ul className="plain">{live.map((f) => <Fact key={f.id} entry={f} sections={sections} />)}</ul> : <p className="empty">Nothing waiting.</p>}
            {!sections.length && <p className="meta">No headings are listed in data/master-sections.json, so nothing can be added to the master yet.</p>}
            <MasterPreview />
            {!!done.length && (
                <Fold className="group" heading="h2" title={<>Added to the master<span className="n">{done.length}</span></>}>
                    <ul className="plain">{done.map((f) => <li key={f.id}>{f.text} <span className="muted small">under {f.section}</span></li>)}</ul>
                </Fold>
            )}
        </main>
    );
}
