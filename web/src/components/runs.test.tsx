import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { company, lines, posting } from '../test-fixtures';
import { routes } from '../routes';
import { ToastProvider } from '../toast';
import type { Defaults } from '../models';

const runs = [
    { run: '2026-11-16-culture-0123', workflow: 'culture', durationMs: 1087825, counts: { leads: 1, nearMisses: 1, changes: 1 }, models: { claude: { status: 'ok' }, codex: {} } },
    { run: '2026-11-15-daily-1648', workflow: 'daily', durationMs: 600000, counts: { leads: 4, nearMisses: 2, changes: 0 } },
    { run: '2026-11-14-daily', workflow: 'daily', counts: { leads: 0, nearMisses: 0, changes: 0 } },
];
const lead = { key: 'ferrule::head of ops', company: 'Ferrule Computer', role: 'Head of Operations', url: 'https://ferrule.example/1', pay: '$200k', foundBy: 'both' };
const report = {
    workflow: 'culture', finishedAt: '2026-11-16T01:41:00Z', leads: [lead],
    nearMisses: [{ key: 's::x', company: 'CutPlate', role: 'Fullstack', url: 'https://scs.example/1', pay: '$150k', foundBy: 'claude', claude: { note: 'Onsite role' } }],
    changes: [
        { company: 'Ferrule Computer', by: 'claude', fields: { stance: { from: '', to: 'Watching' }, verdict: { from: 'Good', to: 'Strong' } }, reason: 'Proposed by claude' },
        { company: 'Old Co', before: null, after: { Status: 'Watching' }, fields: ['Status'], reason: 'Proposed by claude' },
    ],
    held: [], refused: [],
};
const ferrule = company({ key: 'ferrule', name: 'Ferrule Computer' });
const ferrulePosting = posting({ id: 'p9', companyKey: 'ferrule', leadKey: 'ferrule::head of ops', role: 'Head of Operations', url: 'https://ferrule.example/1' });

const registry: { models: unknown[]; defaults: Defaults } = {
    models: [
        { id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex' },
        { id: 'qwen', label: 'Qwen', runner: 'local', ctx: 128000 }, { id: 'tiny', label: 'Tiny', runner: 'local', ctx: 30000 },
        { id: 'off', label: 'Switched off', runner: 'local', enabled: false }, { id: 'gone', label: 'Gone', runner: 'local', missing: true },
    ],
    defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'claude' } },
};
const baseDefaults = registry.defaults;
let reportBody: unknown = report;
const posts: Record<string, unknown>[] = [];
let indexRuns: unknown[] = runs;
let activityRuns: unknown[] = [];
let unfiled = '{"heading":"2026-10-01 old search","text":"Looked at Acme; not remote."}\n';
beforeEach(() => {
    posts.length = 0;
    reportBody = report;
    indexRuns = runs;
    activityRuns = [];
    registry.defaults = baseDefaults;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response('{"ok":true}'); }
        if (url === '/api/companies') return new Response(lines([ferrule]));
        if (url === '/api/postings') return new Response(lines([ferrulePosting]));
        if (url === '/api/activity') return new Response(JSON.stringify({ runs: activityRuns }));
        if (url === '/api/status') return new Response('{"runs":[]}');
        if (url.includes('unfiled-history')) return unfiled ? new Response(unfiled) : new Response('', { status: 404 });
        if (url.includes('schedule.json')) return new Response(JSON.stringify({ daily: { days: [1, 3, 5], hours: [11] }, sweep: { days: null, hours: [4, 16] } }));
        if (url.includes('models.json')) return new Response(JSON.stringify(registry));
        if (url.includes('verticals.json')) return new Response(JSON.stringify([{ name: 'Education and ed-tech', group: 'Top' }, { name: 'Animal care and welfare', group: 'Top' }, { name: 'Standards bodies', group: 'Preferred' }]));
        if (url.includes('runs%2Findex.json')) return new Response(JSON.stringify(indexRuns));
        if (url.includes('report.json')) return new Response(JSON.stringify(reportBody));
        return new Response('[]');
    }));
});
afterEach(() => vi.unstubAllGlobals());

const open = (path: string) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ToastProvider><RouterProvider router={router} /></ToastProvider>
        </QueryClientProvider>,
    );
    return router;
};

test('the runs list shows each run and the unfiled history as text', async () => {
    open('/runs');
    const row = (await screen.findByRole('link', { name: '2026-11-16-culture-0123' })).closest('tr')!;
    expect(within(row).getByText('18 min')).toBeInTheDocument();
    expect(within(row).getByText('Claude, reviewed by Codex')).toBeInTheDocument();
    expect(await screen.findByText('2026-10-01 old search')).toBeInTheDocument();
    expect(screen.getByText('Looked at Acme; not remote.')).toBeInTheDocument();
});

test('a missing unfiled history shows no section', async () => {
    unfiled = '';
    open('/runs');
    await screen.findByRole('link', { name: '2026-11-16-culture-0123' });
    expect(screen.queryByText('Unfiled history')).toBeNull();
    unfiled = '{"heading":"h","text":"t"}\n';
});

test('older and newer buttons change the run in the URL', async () => {
    const router = open('/runs/2026-11-15-daily-1648?tab=skipped');
    await screen.findByRole('tab', { name: /Skipped/ });
    await userEvent.click(screen.getByRole('button', { name: 'Older run' }));
    expect(router.state.location.pathname).toBe('/runs/2026-11-14-daily');
    expect(router.state.location.search).toBe('?tab=skipped');
    expect(screen.getByRole('button', { name: 'Older run' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Newer run' }));
    await userEvent.click(screen.getByRole('button', { name: 'Newer run' }));
    expect(router.state.location.pathname).toBe('/runs/2026-11-16-culture-0123');
});

test('leads link to the company and, when a posting matches, the job', async () => {
    open('/runs/2026-11-16-culture-0123');
    expect(await screen.findByRole('link', { name: 'Ferrule Computer' })).toHaveAttribute('href', '/companies/ferrule');
    expect(screen.getByRole('link', { name: 'Head of Operations' })).toHaveAttribute('href', '/jobs/p9');
});

test('tabs switch lists and keep the choice in the URL', async () => {
    const router = open('/runs/2026-11-16-culture-0123');
    await userEvent.click(await screen.findByRole('tab', { name: /Skipped/ }));
    expect(router.state.location.search).toBe('?tab=skipped');
    expect(screen.getByText('Onsite role')).toBeInTheDocument();
});

test('a new-shape change shows from and to per field with Undo; an old-shape change is read-only', async () => {
    open('/runs/2026-11-16-culture-0123?tab=changes');
    const li = (await screen.findByRole('link', { name: 'Ferrule Computer' })).closest('li')!;
    expect(within(li).getByText('Good → Strong')).toBeInTheDocument();
    await userEvent.click(within(li).getByRole('button', { name: 'Undo' }));
    expect(posts).toEqual([{ type: 'undo', run: '2026-11-16-culture-0123', company: 'Ferrule Computer' }]);
    const old = screen.getByText('Old Co').closest('li')!;
    expect(within(old).queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(within(old).getByText('From before the redesign')).toBeInTheDocument();
});

test('Runs: an empty list and a failed load say different things', async () => {
    const normal = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.includes('runs%2Findex.json') ? new Response('[]') : normal(url, init))));
    const first = open('/runs');
    expect(await screen.findByText('No runs yet. Start one from the bar above.')).toBeInTheDocument();
    first.dispose();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    open('/runs');
    expect((await screen.findAllByText("Couldn't load this. Reload to try again.")).length).toBeGreaterThan(0);
});

test('a find nobody reviewed is tagged Unreviewed; reviewed or old finds are not', async () => {
    reportBody = { ...report, leads: [{ ...lead, key: 'a', foundBy: 'claude', reviewed: false }, { ...lead, key: 'b', company: 'Other Co', reviewed: true }, { ...lead, key: 'c', company: 'Third Co' }] };
    open('/runs/2026-11-16-culture-0123');
    await screen.findByText('Other Co');
    expect(screen.getAllByText('Unreviewed')).toHaveLength(1);
});


const searches = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Searches ▾' })); };
const rowMenu = async (label: string, item: string | RegExp) => {
    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${label}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: item }));
};
// Opens the Run with other models… dialog for one workflow row.
const other = async (label: string) => {
    open('/runs');
    await searches();
    await rowMenu(label, 'Run with other models…');
    return screen.findByRole('dialog', { name: `Run ${label}` });
};
const start = () => userEvent.click(screen.getByRole('button', { name: 'Start' }));
const pick = async (name: string, option: string | RegExp) => {
    await userEvent.click(screen.getByRole('combobox', { name }));
    await userEvent.click(await screen.findByRole('option', { name: option }));
};

test('the header has a Searches button and no run form', async () => {
    open('/runs');
    expect(await screen.findByRole('button', { name: 'Searches ▾' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start run' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Workflow to start' })).toBeNull();
});

test('the bar alone does not refetch activity within 20s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
        const calls = () => vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/activity').length;
        open('/runs');
        await waitFor(() => expect(calls()).toBe(1));
        await vi.advanceTimersByTimeAsync(25000);
        expect(calls()).toBe(1);
    } finally {
        vi.useRealTimers();
    }
});

test('the panel lists the eight searches; daily shows schedule, last run and models', async () => {
    open('/runs');
    await screen.findByRole('link', { name: '2026-11-16-culture-0123' });
    await searches();
    for (const l of ['Daily role discovery', 'Tracked companies check', 'Find careers links', 'Weekly culture discovery', 'Weekly vertical sweep', 'Weekly ledger reconcile', 'Sweep job boards', 'Find boards on careers pages']) {
        expect(await screen.findByText(l)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: `Actions for ${l}` })).toBeInTheDocument();
    }
    const daily = screen.getByText('Daily role discovery').closest('li')!;
    expect(daily).toHaveTextContent('Runs Mon/Wed/Fri 6am');
    expect(daily).toHaveTextContent('Last run Nov 15 at 11:48am');
    expect(daily).toHaveTextContent('Claude and Codex, reviewing each other');
    expect(screen.getByText('Find careers links').closest('li')).toHaveTextContent('Runs only when you start it');
    expect(screen.getByText('Weekly culture discovery').closest('li')).toHaveTextContent('Runs only when you start it');
    expect(screen.getByText('Sweep job boards').closest('li')).toHaveTextContent('Runs daily 11pm and 11am');
    expect(screen.getByText(/Triage swept roles/).closest('li')).toHaveTextContent('Runs daily 11pm and 11am');
});

test('a sole searcher that is also the default reviewer shows no review', async () => {
    registry.defaults = { ...baseDefaults, search: { searchers: ['qwen'], reviewer: 'qwen' } };
    open('/runs');
    await searches();
    expect((await screen.findByText('Daily role discovery')).closest('li')).toHaveTextContent('Qwen, no review');
});

test('the panel is named Searches', async () => {
    open('/runs');
    await searches();
    expect(await screen.findByRole('dialog', { name: 'Searches' })).toBeInTheDocument();
});

test('View last report closes the panel', async () => {
    open('/runs');
    await searches();
    await rowMenu('Weekly culture discovery', 'View last report');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Searches' })).toBeNull());
});

test('Run now posts the workflow, shows the toast and closes the panel', async () => {
    open('/runs');
    await searches();
    await rowMenu('Daily role discovery', 'Run now');
    expect(await screen.findByText('Run started. Progress shows in the bar.')).toBeInTheDocument();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily' }]);
    expect(screen.queryByText('Weekly culture discovery')).toBeNull();
});

test('script rows have no models line or other-models item; Run now posts their workflow', async () => {
    open('/runs');
    await searches();
    const sweep = (await screen.findByText('Sweep job boards')).closest('li')!;
    expect(sweep).not.toHaveTextContent('Claude');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Sweep job boards' }));
    expect(await screen.findByRole('menuitem', { name: 'Run now' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Run with other models…' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Run now' }));
    expect(posts).toEqual([{ type: 'run', workflow: 'sweep' }]);
});

test('script rows show their last run from the activity list, or a dash', async () => {
    activityRuns = [{ id: 1, workflow: 'sweep', status: 'completed', conclusion: 'success', createdAt: '2026-11-18T16:00:00Z', updatedAt: '2026-11-18T16:05:00Z', url: 'x' }];
    open('/runs');
    await searches();
    expect((await screen.findByText('Sweep job boards')).closest('li')).toHaveTextContent(/Last run (yesterday|Nov 18) at 11am/);
    expect(screen.getByText('Find boards on careers pages').closest('li')).toHaveTextContent('Last run —');
    cleanup();
    activityRuns = [{ id: 2, workflow: 'resolve-links', status: 'completed', conclusion: 'success', createdAt: '2026-11-15T07:00:00Z', updatedAt: '2026-11-15T07:05:00Z', url: 'x' }];
    open('/runs');
    await searches();
    expect((await screen.findByText('Find boards on careers pages')).closest('li')).toHaveTextContent('Last run Nov 15 at 2am');
});

test('links is a model row, and a last run without a duration still shows', async () => {
    indexRuns = [{ run: '2026-11-14-links-0900', workflow: 'links', counts: { leads: 0, nearMisses: 0, changes: 0 } }];
    open('/runs');
    await searches();
    const links = (await screen.findByText('Find careers links')).closest('li')!;
    expect(links).toHaveTextContent('Last run Nov 14 at 4am');
    expect(links).toHaveTextContent('Claude and Codex');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Find careers links' }));
    expect(await screen.findByRole('menuitem', { name: 'Run with other models…' })).toBeInTheDocument();
});

test('View last report links to the run; a row with no run has none', async () => {
    open('/runs');
    await searches();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Weekly culture discovery' }));
    expect(await screen.findByRole('menuitem', { name: 'View last report' })).toHaveAttribute('href', '/runs/2026-11-16-culture-0123');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Weekly ledger reconcile' }));
    await screen.findByRole('menuitem', { name: 'Run now' });
    expect(screen.queryByRole('menuitem', { name: 'View last report' })).toBeNull();
});

test('Run with other models opens a titled dialog; an untouched Start sends only the workflow', async () => {
    await other('Daily role discovery');
    expect(screen.queryByText('Weekly culture discovery')).toBeNull();
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily' }]);
});

test('after the dialog closes, focus returns to Searches', async () => {
    await other('Daily role discovery');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Searches ▾' })).toHaveFocus());
});

test('a workflow with its own default starts and summarizes from it', async () => {
    registry.defaults = { ...baseDefaults, searches: { culture: { searchers: ['qwen'], reviewer: 'codex' } } };
    open('/runs');
    await searches();
    expect((await screen.findByText('Weekly culture discovery')).closest('li')).toHaveTextContent('Qwen, reviewed by Codex');
    expect(screen.getByText('Daily role discovery').closest('li')).toHaveTextContent('Claude and Codex');
    await rowMenu('Weekly culture discovery', 'Run with other models…');
    await screen.findByRole('dialog', { name: 'Run Weekly culture discovery' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'First searcher' })).toHaveTextContent('Qwen'));
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'culture' }]);
});

test('a vertical run sends the ticked verticals; other workflows show no picker', async () => {
    await other('Daily role discovery');
    expect(screen.queryByText(/Pick verticals/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await searches();
    await rowMenu('Weekly vertical sweep', 'Run with other models…');
    await userEvent.click(await screen.findByText(/Pick verticals/));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Education and ed-tech' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Animal care and welfare' }));
    await userEvent.keyboard('{Escape}');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'vertical', topic: 'Education and ed-tech; Animal care and welfare' }]);
});

test('a different second searcher and reviewer send searchers and reviewer', async () => {
    await other('Daily role discovery');
    await pick('Second searcher', 'Qwen');
    await pick('Reviewer', 'Codex');
    expect(screen.getByRole('note')).toHaveTextContent('Uses Claude, Qwen and Codex.');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily', searchers: ['claude', 'qwen'], reviewer: 'codex' }]);
});

test('with a default reviewer, picking no reviewer sends reviewer none', async () => {
    registry.defaults = { ...baseDefaults, search: { searchers: ['claude', 'codex'], reviewer: 'qwen' } };
    await other('Daily role discovery');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('Qwen'));
    await pick('Reviewer', 'None (no review)');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily', reviewer: 'none' }]);
});

test('with a default reviewer, picking Each other sends reviewer each', async () => {
    registry.defaults = { ...baseDefaults, search: { searchers: ['claude', 'codex'], reviewer: 'qwen' } };
    await other('Daily role discovery');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('Qwen'));
    await pick('Reviewer', 'Each other');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily', reviewer: 'each' }]);
});

test('default reviewer none: starts on None, says nothing reviews, sends nothing extra', async () => {
    registry.defaults = { ...baseDefaults, search: { searchers: ['claude', 'codex'], reviewer: 'none' } };
    await other('Daily role discovery');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('None (no review)'));
    expect(screen.getByRole('note')).toHaveTextContent('Uses Claude and Codex. Nothing reviews the finds.');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily' }]);
});

test('default reviewer null: picking None sends none', async () => {
    await other('Daily role discovery');
    await pick('Reviewer', 'None (no review)');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily', reviewer: 'none' }]);
});

test('one searcher: Reviewer shows None, sends only searchers, and Each other is not offered', async () => {
    await other('Daily role discovery');
    await pick('Reviewer', 'Each other');
    await pick('Second searcher', 'None');
    expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('None (no review)');
    expect(screen.getByRole('note')).toHaveTextContent('Uses Claude. Nothing reviews the finds.');
    await userEvent.click(screen.getByRole('combobox', { name: 'Reviewer' }));
    await screen.findByRole('option', { name: 'None (no review)' });
    expect(screen.queryByRole('option', { name: /Each other/ })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await start();
    expect(posts).toEqual([{ type: 'run', workflow: 'daily', searchers: ['claude'] }]);
});

test('two searchers with no named reviewer: the Reviewer reads Each other', async () => {
    await other('Daily role discovery');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('Each other'));
});

test('the sole searcher cannot also be the reviewer, and models that cannot run are not offered', async () => {
    await other('Daily role discovery');
    await pick('Second searcher', 'None');
    await userEvent.click(screen.getByRole('combobox', { name: 'Reviewer' }));
    expect(await screen.findByRole('option', { name: 'Claude' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Codex' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('option', { name: /Switched off|Gone/ })).toBeNull();
    // too small for a search: shown, disabled, with the reason
    expect(screen.getByRole('option', { name: /Tiny.*context too small/ })).toHaveAttribute('aria-disabled', 'true');
});

test('a default reviewer that is also the sole searcher is not used', async () => {
    registry.defaults = { ...baseDefaults, search: { searchers: ['qwen'], reviewer: 'qwen' } };
    await other('Daily role discovery');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'First searcher' })).toHaveTextContent('Qwen'));
    expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('None (no review)');
    await start();
    // The server cleans that default to no review too, so nothing extra is sent.
    expect(posts).toEqual([{ type: 'run', workflow: 'daily' }]);
});

test('finder shows the model label for a registry id', async () => {
    const normal = fetch;
    const qwenReport = { ...report, labels: { qwen: 'Qwen' }, leads: [{ ...lead, foundBy: 'qwen', opinions: { qwen: { verdict: 'Good', note: 'ok' } } }], nearMisses: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.includes('report.json') ? new Response(JSON.stringify(qwenReport)) : normal(url, init))));
    open('/runs/2026-11-16-culture-0123');
    expect(await screen.findByText('Qwen')).toBeInTheDocument();
});

test('the status bar names any model that is searching or reviewing, and tolerates a missing status', async () => {
    const normal = fetch;
    const runsNow = [{ workflow: 'search', title: 'daily', status: 'in_progress', step: 'search (qwen)' }, { workflow: 'search', title: 'tracked', status: 'in_progress', step: 'review (codex)' },
        { workflow: 'ask', title: 'ask Acme', status: 'in_progress', step: 'run ( claude codex)' }];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url === '/api/status' ? new Response(JSON.stringify({ runs: runsNow })) : normal(url, init))));
    open('/runs');
    await userEvent.click(await screen.findByRole('button', { name: '3 running' })); // the cards start collapsed
    expect(await screen.findByText(/Qwen is searching/)).toBeInTheDocument();
    expect(screen.getByText(/Codex is reviewing/)).toBeInTheDocument();
    expect(screen.getByText(/Claude and Codex are working/)).toBeInTheDocument();
});

test('the runs list counts how the search did on jobs added by hand', async () => {
    const was = ferrule.jobs;
    ferrule.jobs = {
        a: { state: 'saved', role: 'A', leadKey: 'a', at: '', coverage: 'unseen' },
        b: { state: 'saved', role: 'B', leadKey: 'b', at: '', coverage: 'unseen' },
        c: { state: 'saved', role: 'C', leadKey: 'c', at: '', coverage: 'filtered' },
        d: { state: 'saved', role: 'D', leadKey: 'd', at: '' },
    };
    open('/runs');
    expect(await screen.findByText('Jobs you added by hand: 3. 2 the search never saw, 1 your sweep filter dropped.')).toBeInTheDocument();
    ferrule.jobs = was;
});

test('Directed lists each directed search by its direction, newest open, and starts one from the box', async () => {
    indexRuns = [
        { run: '2026-11-22-directed-100000', workflow: 'directed', topic: 'Staff graphics roles at CAD vendors', finishedAt: '2026-11-22T10:20:00Z', counts: { leads: 1 } },
        ...runs,
        { run: '2026-11-13-directed-100000', workflow: 'directed', topic: 'Older direction', finishedAt: '2026-11-13T10:20:00Z', counts: { leads: 0 } },
    ];
    open('/directed');
    const newest = await screen.findByRole('button', { name: 'Staff graphics roles at CAD vendors' });
    expect(newest).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('link', { name: 'Head of Operations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Older direction' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('2026-11-16-culture-0123')).toBeNull();
    await userEvent.type(screen.getByLabelText('What to search for'), 'Principal frontend, $300k+');
    await userEvent.click(screen.getByRole('button', { name: 'Start search' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'run', workflow: 'directed', topic: 'Principal frontend, $300k+' }]));
});

test('Status: a finished search shows its counts and links to its run; other runs have no link', async () => {
    indexRuns = [{ run: '2026-11-15-daily-1648', workflow: 'daily', ghUrl: 'https://github.com/o/r/actions/runs/777', counts: { leads: 4, nearMisses: 2, changes: 0 } }];
    const done = { status: 'completed', conclusion: 'success', createdAt: '2026-11-15T16:48:00Z', updatedAt: '2026-11-15T16:50:00Z', workflow: 'search' };
    activityRuns = [{ ...done, id: 777, title: 'search daily', url: 'https://github.com/o/r/actions/runs/777' }, { ...done, id: 778, title: 'sweep', url: 'https://github.com/o/r/actions/runs/778' }];
    open('/status');
    expect(await screen.findByText('4 leads · 2 near-misses · 0 changes')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Details' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/runs/2026-11-15-daily-1648');
});
