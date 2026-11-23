import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { REVIEW_JOB, RULE_OUT, RUN_SEARCH, SEARCH_JOB, type ActionDef } from '../actions';
import { ToastProvider } from '../toast';
import { ActionModal } from './ActionModal';

const posts: Record<string, unknown>[] = [];
let release: () => void = () => {};
let hold: Promise<void> | null = null;
let registry = '';
const base = JSON.stringify({ models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex' }], defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'claude' } } });
beforeEach(() => {
    posts.length = 0;
    hold = null;
    registry = base;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/action') { posts.push(JSON.parse(String(init?.body))); return new Response('{"ok":true}'); }
        if (url.includes('reasons.json')) return new Response(JSON.stringify({ skip: [], save: [], ruleOut: ['Too big', 'Unstable'] }));
        if (url.includes('verticals.json')) return new Response(JSON.stringify([{ name: 'Fintech', group: 'Top' }, { name: 'Health', group: 'Other' }]));
        if (url.includes('models.json')) { if (hold) await hold; return new Response(registry); }
        return new Response('{"runs":[]}');
    }));
});
afterEach(() => vi.unstubAllGlobals());

const show = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const ctx = { company: 'Acme', role: 'Staff', url: 'https://x/1' };

test('review modal untouched posts only the job', async () => {
    const onClose = vi.fn();
    show(<ActionModal def={REVIEW_JOB} ctx={ctx} onClose={onClose} />);
    expect(screen.getByText('Review Staff')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ type: 'reviewJob', company: 'Acme', role: 'Staff', url: 'https://x/1' }]);
});

test('review modal with a different second searcher posts searchers', async () => {
    show(<ActionModal def={REVIEW_JOB} ctx={ctx} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Second searcher' }));
    await userEvent.click(await screen.findByRole('option', { name: 'None' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ type: 'reviewJob', searchers: ['claude'] });
});

test('search a job needs a role, then posts and closes', async () => {
    const onClose = vi.fn();
    show(<ActionModal def={SEARCH_JOB} ctx={{ company: 'Acme' }} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Role is required.');
    expect(posts).toEqual([]);
    await userEvent.type(screen.getByLabelText('Role'), ' Eng ');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.type(screen.getByLabelText('Link to the posting'), 'https://x/2');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ type: 'searchJob', company: 'Acme', role: 'Eng', url: 'https://x/2' }]);
});

test('typed text survives the registry loading', async () => {
    hold = new Promise<void>((r) => { release = r; });
    show(<ActionModal def={SEARCH_JOB} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Role'), 'Eng');
    registry = base.replace('"searchers":["claude","codex"]', '"searchers":["qwen"]').replace('"models":[', '"models":[{"id":"qwen","label":"Qwen","runner":"local"},');
    release();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'First searcher' })).toHaveTextContent('Qwen'));
    expect(screen.getByLabelText('Role')).toHaveValue('Eng');
});

const synth = (params: ActionDef['params'], over: Partial<ActionDef> = {}): ActionDef => ({
    id: 'x', label: 'Thing…', tip: 't', items: ['company'], params, submit: 'Go',
    body: (c, v) => ({ type: 'thing', company: c.company, ...v }), done: (_c, _v, label) => `Done ${label('claude')}`, ...over,
});
const go = () => userEvent.click(screen.getByRole('button', { name: 'Go' }));

test('textarea is trimmed and a choice posts its default untouched', async () => {
    const def = synth([{ kind: 'textarea', name: 'note', label: 'Note' }, { kind: 'choice', name: 'who', label: 'Who', default: 'both', options: [{ value: 'both', label: 'Both' }, { value: 'claude', label: 'Claude' }] }]);
    show(<ActionModal def={def} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Note'), '  hi  ');
    await go();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ type: 'thing', company: 'Acme', note: 'hi', who: 'both' });
});

test('textarea max sets maxLength, no max sets none', () => {
    const def = synth([{ kind: 'textarea', name: 'a', label: 'A', max: 50 }, { kind: 'textarea', name: 'b', label: 'B' }]);
    show(<ActionModal def={def} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    expect(screen.getByLabelText('A')).toHaveAttribute('maxlength', '50');
    expect(screen.getByLabelText('B')).not.toHaveAttribute('maxlength');
});

test('required checks with nothing checked posts nothing; checked values join in option order', async () => {
    const def = synth([{ kind: 'checks', name: 'pieces', label: 'Pieces', required: true, options: () => [{ value: 'cover', label: 'Cover letter' }, { value: 'answers', label: 'Answers' }] }]);
    show(<ActionModal def={def} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    await go();
    expect(screen.getByRole('alert')).toHaveTextContent('Pieces is required.');
    expect(posts).toEqual([]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Answers' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cover letter' }));
    await go();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ pieces: 'cover,answers' });
});

const fillReg = (fill: string, models: object[]) => JSON.stringify({ models, defaults: { search: { searchers: ['claude'], reviewer: null }, ask: { model: 'both' }, fill: { model: fill } } });
const modelDef = synth([{ kind: 'model', name: 'model', label: 'Who', workflow: 'fill' }]);

test('model param starts on the fill default and greys a model that does not fit', async () => {
    registry = fillReg('qwen', [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'qwen', label: 'Qwen', runner: 'opencode', ctx: 20000 }, { id: 'tiny', label: 'Tiny', runner: 'opencode', ctx: 4000 }]);
    show(<ActionModal def={modelDef} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    const box = await screen.findByRole('combobox', { name: 'Who' });
    await waitFor(() => expect(box).toHaveTextContent('Qwen'));
    await userEvent.click(box);
    expect(await screen.findByRole('option', { name: /Tiny/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
    await go();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ model: 'qwen' });
});

test('model param falls back to claude when the default is disabled', async () => {
    registry = fillReg('qwen', [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'qwen', label: 'Qwen', runner: 'opencode', enabled: false }]);
    show(<ActionModal def={modelDef} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Who' })).toHaveTextContent('Claude'));
    await go();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ model: 'claude' });
});

test('onDone fires once after a post and never after a failed one', async () => {
    const onDone = vi.fn();
    show(<ActionModal def={synth([])} ctx={{ company: 'Acme' }} onClose={() => {}} onDone={onDone} />);
    await go();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/action' ? new Response('{"error":"no"}', { status: 400 }) : new Response(base))));
    const fail = vi.fn();
    show(<ActionModal def={synth([])} ctx={{ company: 'Acme' }} onClose={() => {}} onDone={fail} />);
    await go();
    await new Promise((r) => setTimeout(r, 50));
    expect(fail).not.toHaveBeenCalled();
});

test('the dialog title comes from def.title when set', () => {
    show(<ActionModal def={synth([], { title: () => 'Plain' })} ctx={{ company: 'Acme', role: 'Staff' }} onClose={() => {}} />);
    expect(screen.getByText('Plain')).toBeInTheDocument();
});

test('two fast clicks on Start post once, and a failed post leaves the form usable', async () => {
    let letGo: () => void = () => {};
    const gate = new Promise<void>((r) => { letGo = r; });
    let status = 200;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/action') { posts.push(JSON.parse(String(init?.body))); await gate; return new Response(status === 200 ? '{"ok":true}' : '{"error":"no"}', { status }); }
        return new Response(url.includes('models.json') ? base : '{"runs":[]}');
    }));
    status = 400;
    show(<ActionModal def={synth([])} ctx={{ company: 'Acme' }} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Go' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(posts).toHaveLength(1);
    expect(btn).toBeDisabled();
    letGo();
    await waitFor(() => expect(btn).toBeEnabled());
});

const jobRegistry = () => {
    registry = JSON.stringify({ models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex' }, { id: 'qwen', label: 'Qwen', runner: 'opencode', model: 'llama-local/qwen' }],
        defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'claude' }, searches: { job: { searchers: ['qwen'], reviewer: 'none' } } } });
};
const jobCtx = { company: 'Acme', role: 'Eng', url: 'https://x/1' };

test('model fields start from the workflow defaults and send nothing extra', async () => {
    jobRegistry();
    show(<ActionModal def={REVIEW_JOB} ctx={jobCtx} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'First searcher' })).toHaveTextContent('Qwen'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ type: 'reviewJob', company: 'Acme', role: 'Eng', url: 'https://x/1' });
});

test('changing a workflow-default searcher sends searchers', async () => {
    jobRegistry();
    show(<ActionModal def={REVIEW_JOB} ctx={jobCtx} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'First searcher' })).toHaveTextContent('Qwen'));
    await userEvent.click(screen.getByRole('combobox', { name: 'First searcher' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Claude' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ type: 'reviewJob', searchers: ['claude'] });
});

const runCtx = (workflow: string) => ({ company: '', workflow, workflowLabel: workflow });

test('run search shows verticals only for a vertical sweep and posts the topic', async () => {
    show(<ActionModal def={RUN_SEARCH} ctx={runCtx('vertical')} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Pick verticals/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fintech' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Health' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ type: 'run', workflow: 'vertical', topic: 'Fintech; Health' });
});

test('run search for daily has no verticals picker', async () => {
    show(<ActionModal def={RUN_SEARCH} ctx={runCtx('daily')} onClose={() => {}} />);
    await screen.findByRole('combobox', { name: 'First searcher' });
    expect(screen.queryByRole('button', { name: /Pick verticals/ })).toBeNull();
});

test('run search starts on the workflow defaults and untouched posts only the run', async () => {
    registry = JSON.stringify({ models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex' }, { id: 'qwen', label: 'Qwen', runner: 'opencode', model: 'llama-local/qwen' }],
        defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'claude' }, searches: { culture: { searchers: ['qwen'], reviewer: 'none' } } } });
    show(<ActionModal def={RUN_SEARCH} ctx={runCtx('culture')} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'First searcher' })).toHaveTextContent('Qwen'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ type: 'run', workflow: 'culture' });
});

const field: ActionDef = {
    id: 'f', label: 'Thing…', tip: 't', items: ['company'], submit: 'Go',
    params: [{ kind: 'text', name: 'u', label: 'Careers', initial: (c) => c.careersUrl ?? '' }],
    body: (_c, v) => ({ type: 'f', u: v.u }), done: () => 'ok',
};

test('title uses def.title(ctx) when present, a function label otherwise', () => {
    show(<ActionModal def={{ ...field, title: () => 'Custom' }} ctx={{ company: 'Acme', role: 'Staff' }} onClose={() => {}} />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
    cleanup();
    show(<ActionModal def={{ ...field, label: () => 'Dyn…' }} ctx={{ company: 'Acme', role: 'Staff' }} onClose={() => {}} />);
    expect(screen.getByText('Dyn Staff')).toBeInTheDocument();
});

test('an untouched prefilled field posts its prefill and follows ctx; a touched one keeps typed text', async () => {
    const onClose = vi.fn();
    const { rerender } = show(<ActionModal def={field} ctx={{ company: 'Acme', careersUrl: 'https://a' }} onClose={onClose} />);
    expect(screen.getByLabelText('Careers')).toHaveValue('https://a');
    const wrap = (c: string) => <QueryClientProvider client={new QueryClient()}><ToastProvider><ActionModal def={field} ctx={{ company: 'Acme', careersUrl: c }} onClose={onClose} /></ToastProvider></QueryClientProvider>;
    rerender(wrap('https://b'));
    expect(screen.getByLabelText('Careers')).toHaveValue('https://b');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ type: 'f', u: 'https://b' }]);
    posts.length = 0;
    await userEvent.clear(screen.getByLabelText('Careers'));
    await userEvent.type(screen.getByLabelText('Careers'), 'typed');
    rerender(wrap('https://c'));
    expect(screen.getByLabelText('Careers')).toHaveValue('typed');
});

test('rule out: a reason chip rules out at once, with the typed note after it', async () => {
    const onClose = vi.fn();
    show(<ActionModal def={RULE_OUT} ctx={{ company: 'Acme' }} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Why/ }), 'layoffs in May');
    await userEvent.click(await screen.findByRole('button', { name: 'Unstable' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ type: 'setStance', company: 'Acme', stance: 'Ruled out', ruleOutAsked: true, note: 'Unstable. layoffs in May' }]);
});

test('Ctrl+Enter submits the dialog from the note', async () => {
    const onClose = vi.fn();
    show(<ActionModal def={RULE_OUT} ctx={{ company: 'Acme' }} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Why/ }), 'meh{Control>}{Enter}{/Control}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ type: 'setStance', company: 'Acme', stance: 'Ruled out', ruleOutAsked: true, note: 'meh' }]);
});
