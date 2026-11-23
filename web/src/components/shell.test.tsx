import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { company, lines, posting } from '../test-fixtures';
import { routes } from '../routes';
import { searchAll } from '../search';
import { ToastProvider } from '../toast';

const ferrule = company({ key: 'ferrule', name: 'Ferrule Computer', website: 'https://ferrule.computer' });
const data = [ferrule, company({ key: 'quillfeather', name: 'Quillfeather PBC' })];
const postings = [posting({ id: 'p9', companyKey: 'ferrule', role: 'Head of Operations' })];

test('searchAll finds a company by name and a job by role, ignoring case and punctuation', () => {
    expect(searchAll(data, postings, 'FERRULE').companies.map((c) => c.key)).toEqual(['ferrule']);
    expect(searchAll(data, postings, 'operations').jobs.map((j) => j.posting.id)).toEqual(['p9']);
    expect(searchAll(data, postings, 'quillfeather, pbc!').companies.map((c) => c.key)).toEqual(['quillfeather']);
    expect(searchAll(data, postings, '').companies).toEqual([]);
});

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/companies') return new Response(lines(data));
        if (url === '/api/postings') return new Response(lines(postings));
        if (url.includes('schedule.json')) return new Response(JSON.stringify({ tracked: { days: null, hours: [10] }, daily: { days: [1, 3, 5], hours: [11] } }));
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

test('pressing / opens the Search dialog with its input focused', async () => {
    open('/jobs');
    await screen.findByRole('button', { name: /^Search\b/ });
    await userEvent.keyboard('/');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    expect(within(dialog).getByRole('combobox', { name: 'Search companies and jobs' })).toHaveFocus();
});

test('Ctrl-K and the Search button open the dialog too, and Escape closes it', async () => {
    open('/jobs');
    await userEvent.click(await screen.findByRole('button', { name: /^Search\b/ }));
    await screen.findByRole('dialog', { name: 'Search' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument();
});

test('/ and Ctrl-K do nothing while another dialog is open', async () => {
    open('/companies/ferrule');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Ask a question/ }));
    await screen.findByRole('dialog', { name: 'Ask a question' });
    await userEvent.keyboard('{Control>}k{/Control}');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
});

test('typing a company and pressing Enter opens it and closes the dialog', async () => {
    const router = open('/jobs');
    await screen.findByRole('link', { name: /Companies\s*2/ }); // data loaded
    await userEvent.keyboard('/');
    const box = within(await screen.findByRole('dialog', { name: 'Search' })).getByRole('combobox');
    await userEvent.type(box, 'ferrule');
    await screen.findAllByRole('option', { name: /Ferrule Computer/ });
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/companies/ferrule');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
});

test('the Go to group lists pages matching the query', async () => {
    const router = open('/jobs');
    await screen.findByRole('button', { name: /^Search\b/ });
    await userEvent.keyboard('/');
    const box = within(await screen.findByRole('dialog', { name: 'Search' })).getByRole('combobox');
    await userEvent.type(box, 'kit');
    expect(await screen.findByText('Go to', { selector: '.results-group' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Runs' })).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/kits');
});

test('More lists Runs, Kits and Master', async () => {
    open('/new');
    await userEvent.click(await screen.findByRole('button', { name: 'More ▾' }));
    for (const name of ['Runs', 'Kits', 'Master']) expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
});

test('the Status link shows a failed run from the last day until Status is opened', async () => {
    localStorage.removeItem('status-seen');
    const run = { id: 1, workflow: 'search', status: 'completed', conclusion: 'failure', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: '' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/activity') return new Response(JSON.stringify({ runs: [run] }));
        if (url === '/api/companies') return new Response(lines(data));
        if (url === '/api/postings') return new Response(lines(postings));
        return new Response('[]');
    }));
    const router = open('/new');
    expect(await screen.findByRole('img', { name: '1 failed' })).toBeInTheDocument();
    await router.navigate('/status');
    await waitFor(() => expect(screen.queryByRole('img', { name: '1 failed' })).toBeNull());
    await router.navigate('/new');
    expect(screen.queryByRole('img', { name: '1 failed' })).toBeNull();
});

test('opening Status while activity fails to load marks nothing seen', async () => {
    localStorage.removeItem('status-seen');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/activity') return new Response('down', { status: 500 });
        if (url === '/api/companies') return new Response(lines(data));
        if (url === '/api/postings') return new Response(lines(postings));
        return new Response('[]');
    }));
    const router = open('/status');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load");
    await router.navigate('/new');
    expect(localStorage.getItem('status-seen')).toBeNull();
});

test('old routes redirect', async () => {
    expect(open('/').state.location.pathname).toBe('/new');
    const w = open('/watching');
    expect(w.state.location.pathname + w.state.location.search).toBe('/companies?status=Watching');
    expect(open('/applied').state.location.pathname).toBe('/applications');
    expect(open('/decide').state.location.pathname).toBe('/new');
    expect(open('/run?run=2026-11-14-daily').state.location.pathname).toBe('/runs/2026-11-14-daily');
});

test('nav shows counts', async () => {
    open('/companies');
    expect(await screen.findByRole('link', { name: /Companies\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Jobs\s*1/ })).toBeInTheDocument();
});

test('a route whose component throws shows the error screen, not a blank page', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('boom'); };
    const router = createMemoryRouter([{ ...routes[0], children: [{ path: '/boom', element: <Boom /> }] }], { initialEntries: ['/boom'] });
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ToastProvider><RouterProvider router={router} /></ToastProvider>
        </QueryClientProvider>,
    );
    expect(await screen.findByText('Something on this screen broke')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    quiet.mockRestore();
});

test('searchAll finds a company by one of its aliases', () => {
    const withAlias = [{ ...data[0], aliases: ['Totally Different'] }];
    expect(searchAll(withAlias, [], 'different').companies).toHaveLength(1);
});

test('the Searches panel offers the tracked companies check and the careers links backfill', async () => {
    open('/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Searches ▾' }));
    expect((await screen.findByText('Tracked companies check')).closest('li')).toHaveTextContent('Runs daily');
    expect(screen.getByText('Daily role discovery').closest('li')).toHaveTextContent('Runs Mon/Wed/Fri');
    expect(screen.getByText('Find careers links').closest('li')).toHaveTextContent('Runs only when you start it');
});

test('closing Searches opened from More returns focus to More, not the hidden Searches trigger', async () => {
    open('/new');
    await userEvent.click(await screen.findByRole('button', { name: 'More ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Searches…' }));
    await screen.findByText('Tracked companies check');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'More ▾' })).toHaveFocus());
});

test('the nav New count is the queue length; saved jobs are not counted', async () => {
    const saved = company({ key: 'sav', name: 'Sav Co', jobs: {
        s1: { state: 'saved', role: 'A', leadKey: 'k1', at: '' }, s2: { state: 'saved', role: 'B', leadKey: 'k2', at: '' }, s3: { state: 'saved', role: 'C', leadKey: 'k3', at: '' },
    } });
    const lead = company({ key: 'lead', name: 'Lead Co' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/companies') return new Response(lines([saved, lead]));
        if (url === '/api/postings') return new Response(lines([
            posting({ id: 'l1', companyKey: 'lead', leadKey: 'lk', role: 'Lead Role' }),
            posting({ id: 's1', companyKey: 'sav', leadKey: 'k1', role: 'A' }),
            posting({ id: 's2', companyKey: 'sav', leadKey: 'k2', role: 'B' }),
            posting({ id: 's3', companyKey: 'sav', leadKey: 'k3', role: 'C' }),
        ]));
        return new Response('[]');
    }));
    open('/new');
    const link = await screen.findByRole('link', { name: /^New\d/ });
    await waitFor(() => expect(link).toHaveTextContent(/^New1$/));
});
