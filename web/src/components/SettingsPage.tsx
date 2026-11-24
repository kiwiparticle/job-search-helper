import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson } from '../api';
import { useAct } from '../data';
import { ActionButton } from '../toast';
import { SETTINGS, shown } from '../../../lib/settings.js';
import { DEFAULT_ROLE, DEFAULT_ROLE_NOT, QA_ROLE, QA_ROLE_NOT, hasWord, rejectReason, words } from '../../../lib/titleWords.js';
import { Choice, Tabs } from './ui';

type Tab = keyof typeof SETTINGS;
type Lists = Record<string, string[]>;
type Raw = Record<string, unknown> | null;

// One owner file as the page last read it (null when it doesn't exist yet), and the person's unsaved edits.
// Drafts live on the page, not the tab, so switching tabs keeps them. Saving sends what was shown as `before`:
// the server refuses if the file moved since (lib/settings.js).
function useDraft<T extends Record<string, unknown>>(tab: Tab) {
    const client = useQueryClient();
    const act = useAct();
    const { data = null, isPending } = useQuery({ queryKey: ['settings', tab], queryFn: () => getJson<Raw>(SETTINGS[tab].path).catch((): Raw => null) });
    const base = shown(tab, data) as T;
    const [draft, setDraft] = useState<T | null>(null);
    const value = draft ?? base;
    const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base);
    const save = async () => {
        if (!(await act({ type: 'setSettings', tab, before: base, value }, 'Saved. Searches use it from their next run.'))) return;
        // GitHub can serve the old file for a moment: show the saved values now, and tell the pages that read them.
        const bump = 'bump' in SETTINGS[tab] ? { version: (Number(data?.version) || 0) + 1 } : {};
        client.setQueryData(['settings', tab], { ...(data ?? {}), ...value, ...bump });
        if (tab === 'reasons') client.setQueryData(['reasons'], value);
        if (tab === 'profile') client.setQueryData(['profile'], value.currency === 'USD' ? value.payFloor : null);
        setDraft(null);
    };
    return { data, isPending, value, dirty, set: (next: Partial<T>) => setDraft({ ...value, ...next }), discard: () => setDraft(null), save };
}

// A list of words or reasons: remove with ×, add by typing and Enter or Add.
function WordList({ label, hint, words: list, onChange }: { label: string; hint?: string; words: string[]; onChange: (next: string[]) => void }) {
    const [adding, setAdding] = useState('');
    const add = () => {
        const w = adding.trim();
        if (w && !list.some((x) => x.toLowerCase() === w.toLowerCase())) onChange([...list, w]);
        setAdding('');
    };
    return (
        <fieldset className="words">
            <legend>{label}</legend>
            {hint && <p className="muted small">{hint}</p>}
            {list.length > 0 && (
                <ul className="word-list">
                    {list.map((w) => (
                        <li key={w} className="word">{w}<button type="button" className="word-x" aria-label={`Remove ${w}`} onClick={() => onChange(list.filter((x) => x !== w))}>×</button></li>
                    ))}
                </ul>
            )}
            <div className="row">
                <input aria-label={`Add to ${label}`} placeholder="Add one" value={adding} maxLength={60}
                    onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
                <button type="button" onClick={add} disabled={!adding.trim()}>Add</button>
            </div>
        </fieldset>
    );
}

function SaveBar({ dirty, problem, label, save, discard, note }: { dirty: boolean; problem?: string; label: string; save: () => Promise<void>; discard: () => void; note?: string }) {
    return (
        <div className="settings-save">
            <span className={problem ? 'error' : dirty ? 'settings-dirty' : 'muted'} role={problem ? 'alert' : undefined}>{problem ?? (dirty ? 'Changes not saved' : note ?? 'All saved')}</span>
            <button type="button" onClick={discard} disabled={!dirty}>Discard</button>
            <ActionButton className="primary" disabled={!dirty || Boolean(problem)} action={save}>{label}</ActionButton>
        </div>
    );
}

type ReasonsValue = { skip: string[]; save: string[]; ruleOut: string[] };
function ReasonsTab({ d }: { d: ReturnType<typeof useDraft<ReasonsValue>> }) {
    return (
        <>
            <p>The one-tap reasons you get when you skip, save or rule out. Tune reads them each week to suggest better rules.</p>
            <section className="card"><WordList label="Skip a job" words={d.value.skip} onChange={(skip) => d.set({ skip })} /></section>
            <section className="card"><WordList label="Save a job" words={d.value.save} onChange={(save) => d.set({ save })} /></section>
            <section className="card"><WordList label="Rule out a company" words={d.value.ruleOut} onChange={(ruleOut) => d.set({ ruleOut })} /></section>
            <SaveBar dirty={d.dirty} label="Save reasons" save={d.save} discard={d.discard}
                problem={Object.values(d.value).some((l) => l.length > 20) ? 'Keep each list to 20 reasons or fewer.' : undefined} />
        </>
    );
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.includes(w));
const KINDS = [
    { label: 'Software engineering', role: DEFAULT_ROLE, not: DEFAULT_ROLE_NOT },
    { label: 'QA, QE, SDET', role: QA_ROLE, not: QA_ROLE_NOT },
    { label: 'Both', role: [...DEFAULT_ROLE, ...QA_ROLE], not: QA_ROLE_NOT },
];

// What the sweep would do with one title, in the order it checks (lib/boardSweep.js, then lib/sweepPostings.js),
// naming the word that decided it.
const which = (title: string, list: string[]) => list.find((w) => hasWord(title, [w]));
export function tryTitle(title: string, v: Lists, raw: Raw): { ok: boolean; text: string } {
    const never = which(title, v.roleNotWords);
    if (never) return { ok: false, text: `Not saved: it has “${never}” from “But never titles with”.` };
    if (!which(title, v.roleWords)) return { ok: false, text: 'Not saved: it has none of the words in “Keep titles with any of”.' };
    const drop = which(title, v.titleDrop);
    if (drop) return { ok: false, text: `Not saved: it has “${drop}” from “Drop before saving”.` };
    const pass = which(title, v.titleMustNot);
    if (pass) return { ok: false, text: `Saved, but passed: it has “${pass}” from “Pass on titles with”.` };
    const why = rejectReason({ titleMust: words(raw?.titleMust), titleNonSoftware: words(raw?.titleNonSoftware), softwareWords: words(raw?.softwareWords), titleMustNot: [], levels: v.levels, locations: [] }, { title, location: '' });
    return why ? { ok: false, text: `Saved, but passed: ${why}.` } : { ok: true, text: 'Kept. It goes to triage for a quick look.' };
}

function TitlesTab({ d }: { d: ReturnType<typeof useDraft<Lists>> }) {
    const [title, setTitle] = useState('');
    const v = d.value;
    const result = title.trim() ? tryTitle(title, v, d.data) : null;
    return (
        <>
            <p>Which job titles the board sweep keeps. Words match whole and ignore case, so “full stack” also catches Full-Stack.</p>
            <section className="card">
                <h2 className="settings-h">What kind of jobs?</h2>
                <div className="row" role="group" aria-label="What kind of jobs">
                    {KINDS.map((k) => (
                        <button key={k.label} type="button" className="chip" aria-pressed={same(v.roleWords, k.role) && same(v.roleNotWords, k.not)}
                            onClick={() => d.set({ roleWords: [...new Set(k.role)], roleNotWords: k.not, ...(k.role === DEFAULT_ROLE ? {} : { titleMustNot: v.titleMustNot.filter((w) => !hasWord(w, QA_ROLE)) }) })}>{k.label}</button>
                    ))}
                </div>
                <p className="muted small">Picking one fills in the first two lists below. QA or Both also takes QA words out of “Pass on titles with”. You can still change any word.</p>
            </section>
            <section className="card settings-grid">
                <WordList label="Keep titles with any of" words={v.roleWords} onChange={(roleWords) => d.set({ roleWords })} />
                <WordList label="But never titles with" words={v.roleNotWords} onChange={(roleNotWords) => d.set({ roleNotWords })} />
                <WordList label="Drop before saving" hint="Never stored at all." words={v.titleDrop} onChange={(titleDrop) => d.set({ titleDrop })} />
                <WordList label="Pass on titles with" hint="Saved, but marked passed. They show under Passed › Filtered." words={v.titleMustNot} onChange={(titleMustNot) => d.set({ titleMustNot })} />
                <WordList label="Levels (optional)" hint="Empty keeps every level." words={v.levels} onChange={(levels) => d.set({ levels })} />
                <WordList label="Locations (optional)" hint="Empty keeps every location." words={v.locations} onChange={(locations) => d.set({ locations })} />
            </section>
            <section className="card">
                <label className="settings-h" htmlFor="try-title">Try a title</label>
                <input id="try-title" className="settings-try" placeholder="Senior SDET, Platform" value={title} onChange={(e) => setTitle(e.target.value)} />
                {result && <p className={result.ok ? 'settings-ok' : 'settings-no'} aria-live="polite">{result.text}</p>}
            </section>
            <SaveBar dirty={d.dirty} label="Save job titles" save={d.save} discard={d.discard} note="Saving also re-checks roles these words passed on before."
                problem={v.roleWords.length ? undefined : 'Keep at least one word in “Keep titles with any of”, or nothing gets saved.'} />
        </>
    );
}

type ProfileValue = Record<string, string | number | null>;
const FIELDS: [key: string, label: string, wide?: boolean][] = [
    ['who', 'Who you are', true], ['levels', 'Levels you want'], ['levelsOut', 'Levels to skip'], ['location', 'Where you want to work', true],
    ['stack', 'Your tools and stack', true], ['strengths', "What you're best at"], ['offStack', "Work you don't want"], ['domainsFirst', "Industries you'd look at first"],
];
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'];

function ProfileTab({ d }: { d: ReturnType<typeof useDraft<ProfileValue>> }) {
    const v = d.value;
    const [floorText, setFloorText] = useState<string | null>(null);
    const floor = floorText ?? (v.payFloor == null ? '' : String(v.payFloor));
    const setFloor = (t: string) => {
        setFloorText(t);
        const n = Number(t.replace(/[,\s]/g, ''));
        d.set({ payFloor: t.trim() === '' ? null : Number.isInteger(n) && n > 0 ? n : -1 });
    };
    const currency = String(v.currency ?? 'USD');
    const problem = !String(v.who ?? '').trim() ? 'Fill in “Who you are”.' : v.payFloor === -1 ? 'Lowest base pay must be a whole number, like 130000.' : undefined;
    return (
        <>
            <p>Who the search is for. Every search reads this, so write it the way you'd describe yourself to a recruiter.</p>
            <section className="card settings-grid">
                {FIELDS.map(([key, label, wide]) => (
                    <label key={key} className={`settings-field${wide ? ' wide' : ''}`}>{label}
                        <input value={String(v[key] ?? '')} maxLength={key === 'who' || key === 'levels' || key === 'levelsOut' || key === 'location' ? 300 : 600} onChange={(e) => d.set({ [key]: e.target.value })} />
                    </label>
                ))}
                <div className="settings-field row">
                    <label className="settings-field">Lowest base pay
                        <input inputMode="numeric" value={floor} placeholder="Leave empty for no floor" onChange={(e) => setFloor(e.target.value)} />
                    </label>
                    <span className="settings-field">Currency
                        <Choice label="Currency" value={currency} onChange={(c) => d.set({ currency: c })} options={[...new Set([currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} />
                    </span>
                </div>
                <label className="settings-field wide">How to score fit, 1 to 5
                    <span className="muted small">One line per score. Searches use this to sort leads into Strong fit, Good fit, Maybe and Low fit.</span>
                    <textarea rows={6} maxLength={4000} value={String(v.fitRubric ?? '')} onChange={(e) => d.set({ fitRubric: e.target.value })} />
                </label>
            </section>
            <SaveBar dirty={d.dirty} label="Save profile" save={async () => { await d.save(); setFloorText(null); }} discard={() => { d.discard(); setFloorText(null); }} problem={problem} />
        </>
    );
}

// Settings: the owner files a person tunes most, edited here instead of in the repo. Each tab saves as one commit.
export function SettingsPage() {
    const reasons = useDraft<ReasonsValue>('reasons');
    const titles = useDraft<Lists>('titles');
    const profile = useDraft<ProfileValue>('profile');
    if (reasons.isPending || titles.isPending || profile.isPending) return <p className="empty">Loading…</p>;
    return (
        <main className="page settings">
            <div className="head"><h1>Settings</h1><p className="muted">Each save is one commit to your repo. Searches use it from their next run.</p></div>
            <Tabs label="Settings" defaultValue="reasons" tabs={[
                { value: 'reasons', label: <>Reasons{reasons.dirty && ' •'}</>, panel: <ReasonsTab d={reasons} /> },
                { value: 'titles', label: <>Job titles{titles.dirty && ' •'}</>, panel: <TitlesTab d={titles} /> },
                { value: 'profile', label: <>Profile{profile.dirty && ' •'}</>, panel: <ProfileTab d={profile} /> },
            ]} />
        </main>
    );
}
