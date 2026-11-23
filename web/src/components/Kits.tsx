import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { dataUrl, getBlob, getJson, getText } from '../api';
import { useAct, useCompanies, useSupplement, useWorking } from '../data';
import { whenText } from '../format';
import type { Company } from '../model';
import { ActionsMenu } from './Actions';
import { CompanyLink } from './CompanyLink';
import { Working } from './CompanyPage';
import { PostingLink } from '../text';
import { ActionButton, useAction, useToast } from '../toast';
import { StatusBar } from './StatusBar';
import { Button, Check, Choice, Fold } from './ui';
import { useModels } from '../models';

type Meta = { company?: string; role?: string; url?: string; pieces?: string; drafter?: string; postingId?: string };
type KitResult = {
    drafter?: string; reviewer?: string; rounds?: number;
    reviews?: { model: string; at: string }[];
    open?: { issue: string; drafter: string; reviewer: string }[];
    truth?: string[];
    questions?: { question: string; why?: string }[];
    keywords?: { term: string; state: string }[];
};
const NAME_RE = /^[a-z0-9-]+$/;
// The application for a kit's job: same posting id, else same role title.
const appliedFor = (companies: Company[], meta: Meta) => companies
    .find((c) => c.name.toLowerCase() === meta.company?.toLowerCase())
    ?.applications?.find((x) => (meta.postingId ? x.postingId === meta.postingId : false) || x.role.toLowerCase() === meta.role?.toLowerCase());
const who = (m?: string) => (m === 'codex' ? 'Codex' : 'Claude');

type Pending = { company: string; role: string };
const EMPTY = { company: '', role: '', url: '', posting_text: '', drafter: 'claude', note: '' };

function NewKitForm({ onStarted }: { onStarted: (kit: Pending) => void }) {
    const [params, setParams] = useSearchParams();
    const toast = useToast();
    const act = useAct();
    const { busy, run } = useAction();
    const id = useId();
    const [f, setF] = useState({ company: params.get('company') ?? '', role: params.get('role') ?? '', url: params.get('url') ?? '', posting_text: '', drafter: 'claude', note: '' });
    const [pieces, setPieces] = useState(['resume']);
    // Kits run on Claude and Codex only. One turned off drops out, and the other drafts with no critique.
    const { allowed } = useModels();
    const drafters = [['claude', 'Claude', 'codex', 'Codex'], ['codex', 'Codex', 'claude', 'Claude']].filter(([m]) => allowed(m))
        .map(([m, name, other, otherName]) => ({ value: m, label: allowed(other) ? `${name} drafts, ${otherName} reviews` : `${name} drafts, no review` }));
    const drafter = drafters.some((d) => d.value === f.drafter) ? f.drafter : drafters[0]?.value ?? 'claude';
    const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
    const toggle = (p: string) => setPieces((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pieces.length) { toast('Pick at least one piece.'); return; }
        if (!f.url && !f.posting_text.trim()) { toast('Add the posting link or paste its text.'); return; }
        const body = { type: 'kit', company: f.company.trim(), role: f.role.trim(), url: f.url.trim(), posting_text: f.posting_text.trim(), pieces: pieces.join(','), drafter, note: f.note.trim() };
        // A kit started from a job carries its posting id; one started here has none and saves no job.
        const postingId = params.get('postingId');
        let started = false;
        await run(async () => { started = await act({ ...body, ...(postingId && { postingId }) }, 'Kit started. Progress shows at the top.'); });
        if (!started) return;
        onStarted({ company: body.company, role: body.role });
        // Empty for the next kit; the job it came from (company, role, postingId) leaves the URL too.
        setF(EMPTY);
        setPieces(['resume']);
        setParams({}, { replace: true });
    };
    const field = (k: keyof typeof f, label: string, el: React.ReactElement) => <label htmlFor={`${id}-${k}`}>{label}{el}</label>;
    return (
        <form className="form" onSubmit={submit}>
            <h2>New application kit</h2>
            {field('company', 'Company', <input id={`${id}-company`} required value={f.company} onChange={set('company')} />)}
            {field('role', 'Role', <input id={`${id}-role`} required value={f.role} onChange={set('role')} />)}
            {field('url', 'Posting link', <input id={`${id}-url`} type="url" value={f.url} onChange={set('url')} />)}
            {field('posting_text', 'Or paste the posting, if the link needs a login', <textarea id={`${id}-posting_text`} rows={5} value={f.posting_text} onChange={set('posting_text')} />)}
            <fieldset>
                <legend>Pieces</legend>
                <div className="row">
                    {([['resume', 'Resume'], ['cover-letter', 'Cover letter'], ['answers', 'Form answers']] as const).map(([v, label]) => (
                        <Check key={v} checked={pieces.includes(v)} onChange={() => toggle(v)}>{label}</Check>
                    ))}
                </div>
            </fieldset>
            {field('drafter', 'Who drafts', (
                <Choice label="Who drafts" value={drafter} onChange={(v) => setF({ ...f, drafter: v })} options={drafters} />
            ))}
            {field('note', 'Note for the drafter (optional)', <textarea id={`${id}-note`} rows={2} value={f.note} onChange={set('note')} />)}
            <div><Button title="Draft a resume and cover letter for this job. One model writes, the other critiques." type="submit" className="primary" disabled={busy}>Make application kit</Button></div>
        </form>
    );
}

// Polls run status on kit pages and reloads the page's data when a run ends.
function useKitStatus(load: () => void) {
    const toast = useToast();
    const [poke, setPoke] = useState(0);
    const bar = <StatusBar silent poke={poke} onDone={() => { toast('Finished. Refreshing.'); load(); }} />;
    return { bar, started: () => setTimeout(() => setPoke((x) => x + 1), 4000) };
}

// "Starting…" until GitHub lists the run, then the run's own working line.
function PendingStatus({ kit }: { kit: Pending }) {
    const labels = useWorking(kit.company, kit.role);
    return labels.length ? <Working company={kit.company} role={kit.role} /> : <span className="meta">Starting…</span>;
}

export function KitsPage() {
    const [kits, setKits] = useState<{ name: string; meta: Meta }[] | null>(null);
    const load = useCallback(async () => {
        const items = await getJson<{ name: string; type: string }[]>('applications').catch(() => []);
        setKits(await Promise.all(items.filter((x) => x.type === 'dir').map(async (d) => ({ name: d.name, meta: await getJson<Meta>(`applications/${d.name}/meta.json`).catch(() => ({})) }))));
    }, []);
    useEffect(() => { load(); }, [load]);
    const { bar, started } = useKitStatus(load);
    // Kits started from this page show at once; each goes when its folder turns up in the list.
    const [pending, setPending] = useState<Pending[]>([]);
    const same = (a: Pending, m: Meta) => a.company.toLowerCase() === m.company?.toLowerCase() && a.role.toLowerCase() === m.role?.toLowerCase();
    const waiting = pending.filter((p) => !kits?.some((k) => same(p, k.meta)));
    const companies = useCompanies().data ?? [];
    const co = (m: Meta) => companies.find((c) => c.name.toLowerCase() === m.company?.toLowerCase());
    return (
        <main className="page">
            {bar}
            <Link to="/run">Back to board</Link>
            <h1>Application kits</h1>
            {!kits ? <p className="sub">Loading…</p>
                : kits.length || waiting.length
                    ? (
                        <ul className="changes">
                            {waiting.map((p, i) => (
                                <li key={`pending-${i}`}>
                                    <div className="what">
                                        <span className="company">{p.company}</span>
                                        <span>{p.role}</span>
                                        <PendingStatus kit={p} />
                                    </div>
                                </li>
                            ))}
                            {kits.map((k) => (
                                <li key={k.name}>
                                    <div className="what">
                                        {co(k.meta) ? <CompanyLink className="company" company={co(k.meta)!} /> : <span className="company">{k.meta.company ?? k.name}</span>}
                                        <Link to={`/kits/${k.name}`}>{k.meta.role || 'Open kit'}</Link>
                                        <PostingLink url={k.meta.url} />
                                        {appliedFor(companies, k.meta) ? <span className="tag applied">Applied</span> : <span className="meta">Not applied</span>}
                                        {k.meta.company && <Working company={k.meta.company} role={k.meta.role} />}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
                    : <p className="empty">No kits yet. Start one below or from a lead on the board.</p>}
            <NewKitForm onStarted={(kit) => { setPending((x) => [kit, ...x]); started(); }} />
        </main>
    );
}

const latest = async (dir: string, base: string) => {
    for (const n of [9, 8, 7, 6, 5, 4, 3, 2, 1]) {
        const t = await getText(`${dir}/${base}-${n}.md`).catch(() => null);
        if (t != null) return { n, text: t };
    }
    return null;
};

// Questions the reviewers want answered. An answer becomes a fact every later kit, review and revision may use.
function Questions({ kitName, questions }: { kitName: string; questions: { question: string; why?: string }[] }) {
    const act = useAct();
    const { data: facts = [] } = useSupplement();
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const open = questions.filter((q) => !facts.some((f) => f.kit === kitName && f.question === q.question.trim().slice(0, 400)));
    if (!open.length) return null;
    return (
        <section className="card" aria-label="Questions for you">
            <h3>Questions for you</h3>
            <p className="meta">Your answer counts as true for every later kit, review and revision. It applies the next time you run one. Answer only what's true.</p>
            {open.map((q) => (
                <div key={q.question} className="stack">
                    <p className="prose"><b>{q.question}</b></p>
                    {q.why && <p className="meta">{q.why}</p>}
                    <textarea rows={2} aria-label={`Your answer to: ${q.question}`} value={drafts[q.question] ?? ''} onChange={(e) => setDrafts({ ...drafts, [q.question]: e.target.value })} />
                    <div className="row">
                        <ActionButton disabled={!(drafts[q.question] ?? '').trim()} title="Saved as a fact you supplied. You can merge it into your master resume from the Master page." action={() => act({ type: 'addSupplement', text: drafts[q.question].trim(), question: q.question, kit: kitName }, 'Saved. Your next review or revision will use it.')}>Save answer</ActionButton>
                    </div>
                </div>
            ))}
        </section>
    );
}

type KitData = { meta: Meta; kit: KitResult; critique: { n: number; text: string } | null; files: string[]; draftAt: string; reviews: { model: string; text: string }[] };

export function KitPage() {
    const { name = '' } = useParams();
    const dir = `applications/${name}`;
    const [data, setData] = useState<KitData | null>(null);
    const load = useCallback(async () => {
        const [meta, kit, critique, files, reviews] = await Promise.all([
            getJson<Meta>(`${dir}/meta.json`).catch(() => ({})),
            getJson<KitResult>(`${dir}/kit.json`).catch(() => ({})),
            latest(dir, 'critique'),
            getJson<{ name: string }[]>(dir).catch(() => []),
            Promise.all(['claude', 'codex'].map(async (model) => ({ model, text: await getText(`${dir}/review-${model}.md`).catch(() => '') }))),
        ]);
        const names = files.map((f) => f.name);
        const n = Math.max(0, ...names.map((f) => Number(/^draft-(\d)\.md$/.exec(f)?.[1] ?? 0)));
        const draftAt = n ? await fetch(`${dataUrl(`${dir}/draft-${n}.md`)}&when=1`).then((r) => r.json()).then((j) => j.at as string).catch(() => '') : '';
        setData({ meta, kit, critique, files: names, draftAt, reviews: reviews.filter((r) => r.text) });
    }, [dir]);
    useEffect(() => { if (NAME_RE.test(name)) load(); }, [name, load]);
    const { bar, started } = useKitStatus(load);
    const act = useAct();
    useEffect(() => { document.title = data?.meta.company ? `${data.meta.company}, ${data.meta.role ?? 'kit'} · Kit · Job search` : 'Kit · Job search'; }, [data?.meta.company, data?.meta.role]);
    const companies = useCompanies().data ?? [];
    const company = companies.find((c) => c.name.toLowerCase() === data?.meta.company?.toLowerCase());
    const applied = data && appliedFor(companies, data.meta);

    if (!NAME_RE.test(name)) return <main className="page"><Link to="/kits">Back to kits</Link><p className="empty">No such kit.</p></main>;
    if (!data) return <main className="page"><Link to="/kits">Back to kits</Link><p className="sub">Loading…</p></main>;
    const { meta, kit, critique, files, draftAt, reviews } = data;
    const has = (f: string) => files.includes(f);
    const draftNo = Math.max(0, ...files.map((f) => Number(/^draft-(\d)\.md$/.exec(f)?.[1] ?? 0)));
    // A kit made from pasted text has no URL, so the rerun resends the captured posting.
    const rerun = (note: string) => async () => {
        const posting_text = meta.url ? '' : await getText(`${dir}/posting.md`);
        const sent = await act({ type: 'kit', company: meta.company, role: meta.role, url: meta.url, posting_text, pieces: meta.pieces ?? 'resume', drafter: meta.drafter ?? 'claude', note, replace: true, ...(meta.postingId && { postingId: meta.postingId }) }, 'Rerunning with your call.');
        if (sent) started();
    };
    const preview = (file: string, label: string) => has(file) && <a className="btn" href={`#/kits/${name}/preview/${file}`} target="_blank" rel="noreferrer">{label}</a>;
    // The file is stored as resume.docx; the saved copy is named for the job, so it is ready to upload.
    const jobName = [meta.company, meta.role].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const savedAs = (file: string) => (jobName ? (file === 'resume.docx' ? `${jobName}.docx` : file === 'cover-letter.docx' ? `${jobName} - Cover letter.docx` : file) : file);
    const download = (file: string, label: string) => has(file) && <a className="btn primary" href={dataUrl(`${dir}/${file}`)} download={savedAs(file)}>{label}</a>;

    return (
        <main className="page">
            {bar}
            <Link to="/kits">Back to kits</Link>
            <header className="top">
                <div>
                    <h1>{meta.company ?? name}, {meta.role ?? ''}</h1>
                    {applied && <p className={`tag${applied.outcome === 'applied' ? ' applied' : ''}`}>{applied.outcome === 'applied' ? 'Applied' : `Applied, ${applied.outcome}`} <span>{applied.approx ? 'about ' : ''}{applied.appliedOn}</span></p>}
                    <PostingLink url={meta.url} text="Open the posting" />
                    {company && <p className="sub"><CompanyLink company={company}>Open the company</CompanyLink></p>}
                    <p className="sub">{kit.reviewer ? `${who(kit.drafter)} drafted, ${who(kit.reviewer)} reviewed. ${kit.rounds ?? '?'} rounds.` : `${who(meta.drafter)} drafted, no critique.`}</p>
                    <p className="sub">
                        Resume is draft {draftNo}{draftAt && ` (saved ${whenText(new Date(draftAt))})`}.
                        {kit.reviews?.map((r) => ` ${who(r.model)} reviewed it ${new Date(r.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`).join('')}
                    </p>
                </div>
                <div className="row">
                    {/* Only what this kit asked for: meta.pieces lists it. */}
                    {meta.company && meta.role && <ActionsMenu item="kit" ctx={{ company: meta.company, role: meta.role, url: meta.url, postingId: meta.postingId, applied: Boolean(applied), pieces: meta.pieces ?? 'resume' }} onDone={started} />}
                    {preview('resume.docx', 'Preview resume')}
                    {download('resume.docx', 'Download resume')}
                    {(meta.pieces ?? 'resume').split(',').includes('cover-letter') && preview('cover-letter.docx', 'Preview cover letter')}
                    {(meta.pieces ?? 'resume').split(',').includes('cover-letter') && download('cover-letter.docx', 'Download cover letter')}
                    {(meta.pieces ?? 'resume').split(',').includes('answers') && download('answers.md', 'Download answers')}
                </div>
            </header>
            {meta.company && <Working company={meta.company} role={meta.role} />}
            <div className="kit-cols">
                <div className="kit-side" aria-label="Reviews">
                    {!!kit.questions?.length && <Questions kitName={name} questions={kit.questions.slice(0, 8)} />}
                    {reviews.map((r) => <Fold key={r.model} className="fold-box" title={`Read ${who(r.model)}'s latest review`}><div className="doc">{r.text}</div></Fold>)}
                    {critique && <Fold className="fold-box" title={`Read the full critique, round ${critique.n}`}><div className="doc">{critique.text}</div></Fold>}
                    {kit.open?.map((o) => (
                        <section key={o.issue} className="card disputed">
                            <h3>Still open</h3>
                            <p className="prose">{o.issue}</p>
                            <p className="meta">{who(kit.drafter)}: {o.drafter}</p>
                            <p className="meta">{who(kit.reviewer)}: {o.reviewer}</p>
                            <div className="row">
                                <ActionButton title="Uses a model to redraft this point with the drafter's version." action={rerun(`On "${o.issue}": go with the drafter's version.`)}>Go with {who(kit.drafter)}</ActionButton>
                                <ActionButton title="Uses a model to redraft this point with the reviewer's version." action={rerun(`On "${o.issue}": go with the reviewer's version.`)}>Go with {who(kit.reviewer)}</ActionButton>
                            </div>
                        </section>
                    ))}
                    {!!kit.truth?.length && (
                        <section className="card disputed"><h3>Claims not in your master resume</h3><ul className="plain">{kit.truth.map((t) => <li key={t}>{t}</li>)}</ul></section>
                    )}
                </div>
                <aside className="kit-side" aria-label="Keyword filters">
                    {!!kit.keywords?.length && (
                        <section>
                            <h3>Keyword filters</h3>
                            <p className="meta">Must-have terms from the posting, and whether the resume uses them.</p>
                            {kit.keywords.map((k) => (
                                <div key={k.term} className="kw">
                                    <span>{k.term}</span>
                                    <span className={k.state === 'used' ? 'kw-used' : 'kw-gap'}>{k.state === 'used' ? 'Used' : k.state === 'missing' ? 'Missing' : 'Not in master file'}</span>
                                </div>
                            ))}
                        </section>
                    )}
                </aside>
            </div>
        </main>
    );
}

// Opens in its own window: the real .docx drawn the way Word would, so what you see is what you download.
export function DocPreview() {
    const { name = '', file = '' } = useParams();
    const box = useRef<HTMLDivElement>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!NAME_RE.test(name) || !/^(resume|cover-letter)\.docx$/.test(file)) { setError('No such file.'); return; }
        document.title = `${file.replace('.docx', '')} preview · Job search`;
        let alive = true;
        (async () => {
            const [{ renderAsync }, blob] = await Promise.all([import('docx-preview'), getBlob(`applications/${name}/${file}`)]);
            if (alive && box.current) await renderAsync(blob, box.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: false });
        })().catch((e) => alive && setError(e.message));
        return () => { alive = false; };
    }, [name, file]);
    return <div className="docx-host">{error ? <p className="empty">{error}</p> : <div ref={box} />}</div>;
}
