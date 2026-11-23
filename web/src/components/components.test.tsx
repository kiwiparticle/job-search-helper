import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatDuration } from '../format';
import { ExtLink, RichText } from '../text';
import { ToastProvider } from '../toast';
import { AskPanel } from './AskPanel';
import { company, posting } from '../test-fixtures';
import { CompanyTags, JobTags, PostedNote } from './Tags';
import { Notes } from './Notes';
import { FlagButton } from './FlagButton';
import { ApplyButton } from './ApplyButton';
import { JobActions } from './JobPage';

const posts: unknown[] = [];
let askDefault = 'both';
let codexOn = true;
let statusRuns: unknown[] = [];
let thread: { by: string; text: string }[] = [];
let threadFetches = 0;
let threadGate: Promise<void> | null = null;
let secondGate: Promise<void> | null = null;
let threadFail = false;
let threadsBy: Record<string, { by: string; text: string }[]> = {};
beforeEach(() => {
    posts.length = 0;
    askDefault = 'both';
    codexOn = true;
    statusRuns = [];
    thread = [];
    threadFetches = 0;
    threadGate = null;
    secondGate = null;
    threadFail = false;
    threadsBy = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/action') { posts.push(JSON.parse(String(init?.body))); return new Response('{"ok":true}'); }
        if (url.includes('models.json')) return new Response(JSON.stringify({ models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex', enabled: codexOn }, { id: 'qwen', label: 'Qwen', runner: 'local' }, { id: 'off', label: 'Off', runner: 'local', enabled: false }], defaults: { search: { searchers: ['claude'], reviewer: null }, ask: { model: askDefault }, fill: { model: 'claude' } } }));
        if (url === '/api/status') return new Response(JSON.stringify({ runs: statusRuns }));
        if (url.startsWith('/api/thread')) {
            const n = ++threadFetches;
            if (n === 1 && threadGate) await threadGate;
            if (n === 2 && secondGate) await secondGate;
            if (threadFail) return new Response('{}', { status: 500 });
            const c = decodeURIComponent(url.split('company=')[1]);
            return new Response(JSON.stringify({ messages: threadsBy[c] ?? thread }));
        }
        return new Response('{}', { status: 404 });
    }));
});
afterEach(() => vi.unstubAllGlobals());

const wrap = (ui: React.ReactNode, client = new QueryClient()) => render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter></QueryClientProvider>);

describe('RichText', () => {
    test('renders markdown links and bold, and drops unsafe hrefs', () => {
        render(<p><RichText text="See [the role](https://x.example/job) and **$180k**, not [bad](javascript:alert(1))." /></p>);
        expect(screen.getByRole('link', { name: 'the role ↗' })).toHaveAttribute('href', 'https://x.example/job');
        expect(screen.getByText('$180k').tagName).toBe('STRONG');
        expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    });
    test('a bare URL shows its host name and keeps the sentence period', () => {
        const { container } = render(<p><RichText text="Checked https://www.aethergtm.com/careers." /></p>);
        expect(screen.getByRole('link', { name: 'aethergtm.com ↗' })).toHaveAttribute('href', 'https://www.aethergtm.com/careers');
        expect(container.textContent).toBe('Checked aethergtm.com ↗.');
    });
});

const openAsk = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Ask a question' }));
    return screen.findByRole('dialog');
};
const typeQuestion = async (dialog: HTMLElement, q: string) => {
    await userEvent.type(within(dialog).getByLabelText('Question'), q);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask' }));
};

describe('AskPanel', () => {
    test('open shows the thread and Ask button with no fold', async () => {
        wrap(<AskPanel company="Ostrander" open />);
        await screen.findByText(/No questions about Ostrander yet/);
        expect(screen.queryByRole('button', { name: /Conversation/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Ask a question' })).toBeInTheDocument();
    });

    test('has no inline textarea; the dialog asks with Both by default', async () => {
        wrap(<AskPanel company="Ostrander" />);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        await screen.findByText(/No questions about Ostrander yet/);
        expect(screen.queryByRole('textbox')).toBeNull();
        const dialog = await openAsk();
        await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who answers' })).toHaveTextContent('Both'));
        await typeQuestion(dialog, 'What is on-call like?');
        expect(await screen.findByText(/Asked both models/)).toBeInTheDocument();
        expect(posts).toEqual([{ type: 'ask', company: 'Ostrander', model: 'both', question: 'What is on-call like?' }]);
    });

    test('an empty question shows Question is required.', async () => {
        wrap(<AskPanel company="Ostrander" />);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        const dialog = await openAsk();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Ask' }));
        expect(await within(dialog).findByText('Question is required.')).toBeInTheDocument();
        expect(posts).toEqual([]);
    });

    test('picking Claude asks only Claude', async () => {
        wrap(<AskPanel company="Ostrander" />);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        const dialog = await openAsk();
        await userEvent.click(await within(dialog).findByRole('combobox', { name: 'Who answers' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Claude' }));
        await typeQuestion(dialog, 'Culture?');
        await screen.findByText(/Asked Claude/);
        expect(posts).toEqual([{ type: 'ask', company: 'Ostrander', model: 'claude', question: 'Culture?' }]);
    });
});

describe('AskPanel registry', () => {
    test('offers registry models and asks a local one by id', async () => {
        wrap(<AskPanel company="Ostrander" />);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        const dialog = await openAsk();
        await userEvent.click(await within(dialog).findByRole('combobox', { name: 'Who answers' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Qwen' }));
        expect(screen.queryByRole('option', { name: 'Codex' })).toBeNull();
        await typeQuestion(dialog, 'Culture?');
        expect(await screen.findByText(/Asked Qwen/)).toBeInTheDocument();
        expect(posts).toEqual([{ type: 'ask', company: 'Ostrander', model: 'qwen', question: 'Culture?' }]);
    });
});

describe('AskPanel default', () => {
    test('starts on defaults.ask.model', async () => {
        askDefault = 'qwen';
        wrap(<AskPanel company="Ostrander" />);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        const dialog = await openAsk();
        await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who answers' })).toHaveTextContent('Qwen'));
        await typeQuestion(dialog, 'Culture?');
        await screen.findByText(/Asked Qwen/);
        expect(posts).toEqual([{ type: 'ask', company: 'Ostrander', model: 'qwen', question: 'Culture?' }]);
    });
});

test('with Codex off, Both is not offered and the ask goes to Claude', async () => {
    codexOn = false;
    wrap(<AskPanel company="Ostrander" />);
    await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
    const dialog = await openAsk();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who answers' })).toHaveTextContent('Claude'));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who answers' }));
    await screen.findByRole('option', { name: 'Qwen' });
    expect(screen.queryByRole('option', { name: /Both|Codex/ })).toBeNull();
});

describe('AskPanel answer arrival', () => {
    const msg = (by: string, text: string) => ({ by, text });
    test.each([[true], [false]])('run ends, thread longer=%s', async (longer) => {
        statusRuns = [{ workflow: 'ask', title: 'ask Ostrander', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://x/1' }];
        thread = [msg('owner', 'Q?')];
        const client = new QueryClient();
        wrap(<AskPanel company="Ostrander" />, client);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        await screen.findByText('Q?');
        await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
        statusRuns = [];
        if (longer) thread = [msg('owner', 'Q?'), msg('claude', 'The answer.')];
        await client.invalidateQueries({ queryKey: ['status'] });
        if (longer) {
            expect(await screen.findByText('The answer.')).toBeInTheDocument();
            expect(await screen.findAllByText('Answer in for Ostrander.')).toHaveLength(1);
        } else {
            // Page state that proves the refetch ran: the thread request after the status change.
            await waitFor(() => expect(threadFetches).toBeGreaterThan(1));
            await new Promise((r) => setTimeout(r, 0)); // let the refetch's then-handler run
            expect(screen.queryByText('Answer in for Ostrander.')).toBeNull();
        }
    });
});

describe('AskPanel false toasts', () => {
    const run = { workflow: 'ask', title: 'ask Ostrander', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://x/1' };
    test('switching company mid-ask shows no toast', async () => {
        statusRuns = [run];
        thread = [{ by: 'owner', text: 'Q?' }];
        const client = new QueryClient();
        const tree = (c: string) => <QueryClientProvider client={client}><MemoryRouter><ToastProvider><AskPanel company={c} /></ToastProvider></MemoryRouter></QueryClientProvider>;
        const { rerender } = render(tree('Ostrander'));
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        await screen.findByText('Q?');
        await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
        thread = [{ by: 'owner', text: 'Q?' }, { by: 'claude', text: 'Other thread.' }];
        rerender(tree('Bolt'));
        await screen.findByText('Other thread.');
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByText(/Answer in for/)).toBeNull();
    });

    test('a run ending before the first thread load shows no toast', async () => {
        statusRuns = [run];
        thread = [{ by: 'owner', text: 'Q?' }];
        let open: () => void = () => {};
        threadGate = new Promise<void>((r) => { open = r; });
        const client = new QueryClient();
        wrap(<AskPanel company="Ostrander" />, client);
        await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
        statusRuns = [];
        await client.invalidateQueries({ queryKey: ['status'] });
        await waitFor(() => expect(threadFetches).toBeGreaterThan(1));
        open();
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        await screen.findByText('Q?');
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByText(/Answer in for/)).toBeNull();
    });

    test('a late fetch for company A does not overwrite company B', async () => {
        statusRuns = [run];
        threadsBy = { Ostrander: [{ by: 'owner', text: 'Q?' }], Bolt: [{ by: 'owner', text: 'B thread' }] };
        let open: () => void = () => {};
        secondGate = new Promise<void>((r) => { open = r; });
        const client = new QueryClient();
        const tree = (c: string) => <QueryClientProvider client={client}><MemoryRouter><ToastProvider><AskPanel company={c} /></ToastProvider></MemoryRouter></QueryClientProvider>;
        const { rerender } = render(tree('Ostrander'));
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        await screen.findByText('Q?');
        await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
        threadsBy.Ostrander = [{ by: 'owner', text: 'Q?' }, { by: 'claude', text: 'A answer' }];
        statusRuns = [];
        await client.invalidateQueries({ queryKey: ['status'] });
        await waitFor(() => expect(threadFetches).toBe(2));
        rerender(tree('Bolt'));
        await screen.findByText('B thread');
        open();
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.getByText('B thread')).toBeInTheDocument();
        expect(screen.queryByText('A answer')).toBeNull();
        expect(screen.queryByText(/Answer in for/)).toBeNull();
    });

    test('a first-load error clears when the arrival refetch succeeds', async () => {
        statusRuns = [run];
        threadFail = true;
        const client = new QueryClient();
        wrap(<AskPanel company="Ostrander" />, client);
        await userEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
        await screen.findByText(/Couldn't load the conversation/);
        await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
        threadFail = false;
        thread = [{ by: 'claude', text: 'Recovered.' }];
        statusRuns = [];
        await client.invalidateQueries({ queryKey: ['status'] });
        expect(await screen.findByText('Recovered.')).toBeInTheDocument();
        expect(screen.queryByText(/Couldn't load the conversation/)).toBeNull();
    });
});

describe('formatDuration', () => {
    test.each([[0, 'under a minute'], [29000, 'under a minute'], [90000, '2 min'], [13 * 60000, '13 min'], [65 * 60000, '1 h 5 min'], [120 * 60000, '2 h'], [undefined, ''], [-5, '']])('%s → %s', (ms, out) => {
        expect(formatDuration(ms as number | undefined)).toBe(out);
    });
});

describe('tags', () => {
    const ox = company({ key: 'ferrule', name: 'Ferrule' });
    const p = posting({ id: 'p1', companyKey: 'ferrule' });

    test('JobTags shows Kit started when a kit carries this posting id', () => {
        wrap(<JobTags company={ox} posting={p} kits={[{ name: 'k1', meta: { postingId: 'p1' } }]} />);
        expect(screen.getByRole('link', { name: 'Kit started' })).toHaveAttribute('href', '/kits/k1');
        expect(screen.queryByText('Models now say pass')).toBeNull();
    });

    test('JobTags shows Models now say pass for a former lead the models now pass on', () => {
        render(<JobTags company={ox} posting={{ ...p, wasLead: true, modelSays: 'pass' }} kits={[]} />);
        expect(screen.getByText('Models now say pass')).toBeInTheDocument();
        expect(screen.queryByText('Kit started')).toBeNull();
    });

    test('JobTags shows no posted tag; PostedNote says it as muted text', () => {
        render(<><JobTags company={ox} posting={{ ...p, posted: 'unknown' }} kits={[]} /><PostedNote posting={{ ...p, posted: 'unknown' }} /></>);
        expect(screen.queryByText("Can't check automatically")).toBeNull();
        expect(screen.getByText("can't check automatically")).toBeInTheDocument();
    });

    test('JobTags with an active application to this posting renders an Applied link', () => {
        const app = { id: 'a1', role: 'R', postingId: 'p1', appliedOn: '2026-10-01', outcome: 'applied' } as const;
        wrap(<JobTags company={company({ applications: [app] })} posting={p} kits={[]} />);
        expect(screen.getByRole('link', { name: 'Applied' })).toHaveAttribute('href', '#/applications');
        expect(screen.queryByText('Active application')).toBeNull();
    });

    test('ExtLink text ends with an arrow', () => {
        render(<ExtLink href="https://a.com">Docs</ExtLink>);
        expect(screen.getByRole('link')).toHaveTextContent(/Docs ↗$/);
    });

    test('CompanyTags shows Applied, and a closed one as its outcome with date', () => {
        const app = { id: 'a1', role: 'R', appliedOn: '2026-10-01', outcome: 'applied' } as const;
        const { unmount } = render(<CompanyTags company={company({ applications: [app] })} postings={[]} />);
        expect(screen.getByRole('link', { name: 'Applied' })).toHaveAttribute('href', '#/applications');
        unmount();
        render(<CompanyTags company={company({ applications: [{ ...app, outcome: 'no response', outcomeOn: '2026-11-01' }] })} postings={[]} />);
        expect(screen.getByText('No response 2026-11-01')).toBeInTheDocument();
        expect(screen.queryByText('Active application')).toBeNull();
    });
});

describe('Notes', () => {
    const two = company({ notes: [{ at: '2026-11-01', text: 'a' }, { at: '2026-11-20', text: 'b' }] });
    const row = (text: string) => screen.getByText(text).closest('li')!;
    test('shows the old string as "earlier" and new notes newest first', () => {
        const { unmount } = wrap(<Notes company={company({ note: 'old', notes: undefined })} />);
        expect(screen.getByText('earlier')).toBeInTheDocument();
        expect(screen.getByText('old')).toBeInTheDocument();
        unmount();
        wrap(<Notes company={two} />);
        const [b, a] = [screen.getByText('b'), screen.getByText('a')];
        expect(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Nov 20')).toBeInTheDocument();
    });
    test('edit sends the stored index', async () => {
        wrap(<Notes company={two} />);
        await userEvent.click(within(row('a')).getByRole('button', { name: 'Edit note from Nov 1' }));
        const box = await screen.findByLabelText('Note');
        await userEvent.clear(box);
        await userEvent.type(box, 'a2');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(posts).toEqual([{ type: 'setNote', company: 'X Corp', index: 0, was: 'a', note: 'a2' }]));
    });
    test('delete sends an empty note', async () => {
        wrap(<Notes company={two} />);
        await userEvent.click(within(row('b')).getByRole('button', { name: 'Delete note from Nov 20' }));
        const ask = await screen.findByRole('dialog');
        expect(within(ask).getByText('Delete this note?')).toBeInTheDocument();
        expect(posts).toEqual([]); // nothing sent until the yes
        fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(posts).toEqual([{ type: 'setNote', company: 'X Corp', index: 1, was: 'b', note: '' }]));
    });
    test('on a job sends postingId and no index', async () => {
        wrap(<Notes company={two} postingId="p1" />);
        await userEvent.click(screen.getByRole('button', { name: '+ note' }));
        await userEvent.type(await screen.findByLabelText('Note'), 'new');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(posts).toEqual([{ type: 'setNote', company: 'X Corp', postingId: 'p1', note: 'new' }]));
    });
});

describe('FlagButton', () => {
    const job = { id: 'p1', role: 'Staff Eng', leadKey: 'lk', url: 'https://x.example/1' };
    test('flags with a note', async () => {
        wrap(<FlagButton company={company({ name: 'X' })} />);
        await userEvent.click(screen.getByRole('button', { name: 'Flag' }));
        const pop = await screen.findByRole('dialog', { name: 'Flag' });
        await userEvent.type(within(pop).getByRole('textbox', { name: 'Note (optional)' }), 'check pay');
        await userEvent.click(within(pop).getByRole('button', { name: 'Flag' }));
        await waitFor(() => expect(posts).toEqual([{ type: 'setFlag', company: 'X', on: true, note: 'check pay' }]));
    });
    test('on a job sends the job fields and no note when empty', async () => {
        wrap(<FlagButton company={company({ name: 'X' })} job={job} />);
        await userEvent.click(screen.getByRole('button', { name: 'Flag' }));
        const pop = await screen.findByRole('dialog', { name: 'Flag' });
        await userEvent.click(within(pop).getByRole('button', { name: 'Flag' }));
        await waitFor(() => expect(posts).toEqual([{ type: 'setFlag', company: 'X', postingId: 'p1', role: 'Staff Eng', leadKey: 'lk', url: 'https://x.example/1', on: true }]));
    });
    test('unflags in one click', async () => {
        wrap(<FlagButton company={company({ name: 'X', flag: { at: '2026-11-20' } })} />);
        const b = screen.getByRole('button', { name: /Flagged/ });
        expect(b).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(b);
        await waitFor(() => expect(posts).toEqual([{ type: 'setFlag', company: 'X', on: false }]));
        expect(screen.queryByRole('dialog', { name: 'Flag' })).toBeNull();
    });
});

describe('ApplyButton', () => {
    const job = { id: 'p1', role: 'Senior Engineer', leadKey: 'lk', url: 'https://acme.com/j/1' };
    test('sends the kit with applying', async () => {
        wrap(<ApplyButton company={company({ name: 'Acme' })} job={job} />);
        await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
        const pop = await screen.findByRole('dialog', { name: 'Apply' });
        expect(within(pop).getByRole('checkbox', { name: /Resume/ })).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(within(pop).getByRole('checkbox', { name: 'Cover letter' }));
        await userEvent.type(within(pop).getByRole('textbox', { name: 'Note for the drafter' }), 'stress the Go work');
        await userEvent.click(within(pop).getByRole('button', { name: 'Start kit' }));
        await waitFor(() => expect(posts).toEqual([{ type: 'kit', company: 'Acme', role: 'Senior Engineer', url: 'https://acme.com/j/1', postingId: 'p1', pieces: 'resume,cover-letter', drafter: 'claude', note: 'stress the Go work', applying: true }]));
    });
    test('JobActions shows no Apply on a job with an applied application', () => {
        const app = { id: 'a1', role: 'Senior Engineer', appliedOn: '2026-11-20', outcome: 'applied' as const, postingId: 'p1' };
        wrap(<JobActions company={company({ name: 'Acme', jobs: { p1: { state: 'applying', role: 'Senior Engineer', leadKey: 'lk', at: '2026-11-20' } }, applications: [app] })} job={job} />);
        expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Mark applied' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Skip this role' })).toBeInTheDocument();
    });
    test('JobActions treats a rejected application like any application: no Apply, no Mark applied', () => {
        const app = { id: 'a1', role: 'Senior Engineer', appliedOn: '2026-11-20', outcome: 'rejected' as const, postingId: 'p1' };
        wrap(<JobActions company={company({ name: 'Acme', jobs: { p1: { state: 'applying', role: 'Senior Engineer', leadKey: 'lk', at: '2026-11-20' } }, applications: [app] })} job={job} />);
        expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Mark applied' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Retry kit' })).toBeNull();
    });
    test('is disabled without a posting link', () => {
        wrap(<ApplyButton company={company({ name: 'Acme' })} job={{ ...job, url: undefined }} />);
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    });
});
