import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Company, Posting } from '../model';
import { company, lines, posting } from '../test-fixtures';
import { ToastProvider } from '../toast';
import { ApplicationsPage } from './ApplicationsPage';
import { CompaniesPage } from './CompaniesPage';
import { JobsPage } from './JobsPage';
import { NewPage } from './NewPage';
import { PassedPage } from './PassedPage';

let registry: unknown = {};
let tune: unknown[] = [];
let activeRuns: unknown[] = [];
let companies: Company[] = [];
let postings: Posting[] = [];
const posts: Record<string, unknown>[] = [];
beforeEach(() => {
    posts.length = 0;
    registry = {};
    tune = [];
    activeRuns = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body));
            posts.push(body);
            return new Response('{"ok":true}');
        }
        if (url === '/api/companies') return new Response(lines(companies));
        if (url === '/api/postings') return new Response(lines(postings));
        if (url === '/api/tune') return new Response(lines(tune));
        if (url === '/api/status') return new Response(JSON.stringify({ runs: activeRuns }));
        if (url.startsWith('/api/history')) return new Response('');
        if (url.startsWith('/api/thread')) return new Response('{"messages":[]}');
        if (url.includes('models.json')) return new Response(JSON.stringify(registry));
        if (url.includes('index.json')) return new Response('[{"run":"r1"}]');
        if (url.includes('schedule.json')) return new Response('{"tracked":{"days":null,"hours":[10]}}');
        if (url.includes('profile.json')) return new Response('{"payFloor":170000,"currency":"USD"}');
        if (url.includes('reasons.json')) return new Response(JSON.stringify({ skip: ['Pay too low', 'Not remote'], save: ['Great domain'] }));
        return new Response('[]');
    }));
});
afterEach(() => vi.unstubAllGlobals());

const wrap = (ui: React.ReactNode, at = '/') => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter></ToastProvider>
    </QueryClientProvider>,
);

const lead = (o: Partial<Posting>) => posting({ wasLead: true, ...o });
const fixture = () => {
    companies = [
        company({ name: 'Dispute Co', key: 'dispute' }),
        company({ name: 'Lead Co', key: 'lead' }),
        company({ name: 'Fresh Co', key: 'fresh', stance: '', facts: 'Makes widgets.', size: '200', founded: '2009' }),
        company({ name: 'Dup Co', key: 'dup', possibleDuplicateOf: 'lead' }),
        company({ name: 'Gone Co', key: 'gone', jobs: { g1: { state: 'saved', role: 'Old Role', leadKey: 'g', at: '' }, g2: { state: 'saved', role: 'Older Role', leadKey: 'g2', at: '' } } }),
        company({ name: 'Ask Co', key: 'ask', proposals: [{ id: 'pr-1', by: 'claude', at: '2026-11-16', text: 'why', base: { verdict: '' }, changes: { verdict: 'Strong' } }] }),
    ];
    postings = [
        lead({ id: 'd1', companyKey: 'dispute', leadKey: 'dk', role: 'Disputed Role', disputed: true }),
        lead({ id: 'l1', companyKey: 'lead', leadKey: 'lk', role: 'Lead Role', url: 'https://lead.example/1' }),
        posting({ id: 'u1', companyKey: 'lead', leadKey: 'uk', role: 'Unjudged Role', url: 'https://lead.example/u', modelSays: '', wasLead: false }),
        lead({ id: 'g1', companyKey: 'gone', leadKey: 'g', role: 'Old Role', posted: 'no', goneAt: '2026-11-15' }),
        lead({ id: 'g2', companyKey: 'gone', leadKey: 'g2', role: 'Older Role', posted: 'no', goneAt: '2026-11-14' }),
    ];
};
const row = async (name: RegExp) => (await screen.findAllByText(name))[0].closest('li') as HTMLElement;

test('New shows its sections in order, each with a count', async () => {
    fixture();
    wrap(<NewPage />);
    const list = await screen.findByRole('region', { name: 'Waiting for you' });
    const heads = within(list).getAllByRole('heading').map((h) => h.textContent);
    expect(heads).toEqual(['New leads2', 'Found on boards, not reviewed1', 'Possible duplicates1', 'Postings taken down2', 'Proposals from your questions1', 'Saved2']);
});

const savedFixture = () => {
    companies = [
        company({ name: 'Lead Co', key: 'lead' }),
        company({ name: 'Sav Co', key: 'sav', fingerprint: '4/5; medium confidence', culture: 'Calm, remote-first', domain: 'Payroll software', size: '200', founded: '2009', jobs: {
            'greenhouse:101': { state: 'saved', role: 'Staff Engineer', leadKey: 'k1', at: '' },
            'key:s2': { state: 'saved', role: 'Platform Engineer', leadKey: 'k2', at: '' },
        } }),
    ];
    postings = [
        lead({ id: 'l1', companyKey: 'lead', leadKey: 'lk', role: 'Lead Role' }),
        lead({ id: 'greenhouse:101', companyKey: 'sav', leadKey: 'k1', role: 'Staff Engineer', fit: 5, rescore: { at: '', by: 'm', fitFrom: 4, fitTo: 5, why: '' } }),
        lead({ id: 'key:s2', companyKey: 'sav', leadKey: 'k2', role: 'Platform Engineer', fit: 3 }),
    ];
};

test('New shows Saved grouped by company after the other groups, not counted in the nav', async () => {
    savedFixture();
    wrap(<NewPage />);
    const list = await screen.findByRole('region', { name: 'Waiting for you' });
    const heads = within(list).getAllByRole('heading').map((h) => h.textContent);
    expect(heads).toEqual(['New leads1', 'Saved2']);
    const block = (await screen.findByRole('button', { name: /Sav Co/ })).closest('.saved-co') as HTMLElement;
    expect(block).toHaveTextContent('fp 4/5');
    expect(block).toHaveTextContent('Calm, remote-first');
    const rows = within(block).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toMatch(/Staff Engineer.*fit 5 ↑/);
    expect(rows[1]).toMatch(/Platform Engineer.*fit 3/);
    expect(rows[1]).not.toMatch(/[↑↓]/);
});

test('Clicking a saved role opens its job pane; clicking the header opens the company pane', async () => {
    savedFixture();
    wrap(<NewPage />);
    const block = (await screen.findByRole('button', { name: /Sav Co/ })).closest('.saved-co') as HTMLElement;
    await userEvent.click(within(block).getByRole('button', { name: /Platform Engineer/ }));
    const detail = () => document.querySelector('.split-detail') as HTMLElement; // remounts on each pick
    expect(await within(detail()).findByRole('heading', { level: 2, name: 'Platform Engineer' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: /Platform Engineer/ })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(within(block).getByRole('button', { name: /Sav Co/ }));
    expect(await within(detail()).findByRole('heading', { level: 2, name: /^Sav Co/ })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: /Sav Co/ })).toHaveAttribute('aria-current', 'true');
});

test('switching between saved roles resets the pane to its Job tab', async () => {
    savedFixture();
    wrap(<NewPage />);
    const block = (await screen.findByRole('button', { name: /Sav Co/ })).closest('.saved-co') as HTMLElement;
    const detail = () => document.querySelector('.split-detail') as HTMLElement; // remounts on each pick
    await userEvent.click(within(block).getByRole('button', { name: /Staff Engineer/ }));
    await userEvent.click(await within(detail()).findByRole('tab', { name: 'Company' }));
    expect(within(detail()).getByRole('tab', { name: 'Company' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(block).getByRole('button', { name: /Platform Engineer/ }));
    expect(await within(detail()).findByRole('tab', { name: 'Job' })).toHaveAttribute('aria-selected', 'true');
});

test('a saved job with no posting row opens the company pane and shows no pay', async () => {
    savedFixture();
    postings = postings.filter((p) => p.id !== 'key:s2');
    wrap(<NewPage />);
    const block = (await screen.findByRole('button', { name: /Sav Co/ })).closest('.saved-co') as HTMLElement;
    await userEvent.click(within(block).getByRole('button', { name: /Platform Engineer/ }));
    const detail = () => document.querySelector('.split-detail') as HTMLElement; // remounts on each pick
    expect(await within(detail()).findByRole('heading', { level: 2, name: /^Sav Co/ })).toBeInTheDocument();
});

test('New rows hold no actions; the detail pane has every action', async () => {
    fixture();
    wrap(<NewPage />);
    const li = await row(/Lead Co/);
    const job = { company: 'Lead Co', postingId: 'l1', leadKey: 'lk', role: 'Lead Role', url: 'https://lead.example/1' };
    for (const name of ['Save', 'Skip this role']) expect(within(li).queryByRole('button', { name })).toBeNull();
    expect(within(li).queryByRole('link')).toBeNull();
    expect(within(li).queryByText('Job', { selector: '.kind' })).toBeNull();
    await userEvent.click(within(li).getByRole('button', { name: /Lead Role/ }));
    const detail = document.querySelector('.split-detail') as HTMLElement;
    await userEvent.click(await within(detail).findByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save without a reason' }));
    await userEvent.click(within(detail).getByRole('button', { name: 'Skip this role' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip without a reason' }));
    await userEvent.click(within(detail).getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark applied' }));
    await waitFor(() => expect(posts).toHaveLength(3));
    await userEvent.click(within(detail).getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rule out company…' }));
    await userEvent.type(await screen.findByRole('textbox', { name: /Why/ }), 'no remote');
    await userEvent.click(screen.getByRole('button', { name: 'Rule out company' }));
    await waitFor(() => expect(posts).toHaveLength(4));
    await userEvent.click(within(detail).getByRole('button', { name: 'Actions ▾' }));
    expect(await screen.findByRole('menuitem', { name: 'Make application kit' })).toBeInTheDocument();
    const own = screen.getByRole('menuitem', { name: 'Open in its own tab' });
    expect(own).toHaveAttribute('href', '#/jobs/l1');
    expect(own).toHaveAttribute('target', '_blank');
    expect(within(detail).queryByRole('link', { name: 'Open job page' })).toBeNull();
    expect(posts).toEqual([
        { type: 'saveJob', ...job },
        { type: 'skipJob', ...job },
        { type: 'markApplied', applicationId: expect.any(String), ...job },
        { type: 'setStance', company: 'Lead Co', stance: 'Ruled out', ruleOutAsked: true, note: 'no remote' },
    ]);
});

test('New: a lead under the pay floor shows its pay in amber', async () => {
    companies = [company()];
    postings = [lead({ pay: '$140K - $165K' }), lead({ id: 'p2', leadKey: 'k2', role: 'Paid Role', pay: '$145,000–$195,000 base' })];
    wrap(<NewPage />);
    const list = await screen.findByRole('region', { name: 'Waiting for you' });
    expect(await within(list).findByText('$140K - $165K')).toHaveClass('low');
    expect(within(list).getByText('$145,000–$195,000')).not.toHaveClass('low');
});

test('New: an unjudged posting\'s pane has a Review button (and no Review… in Actions) that opens the modal and posts reviewJob', async () => {
    fixture();
    wrap(<NewPage />);
    const li = await row(/Unjudged Role/);
    expect(within(li).queryByRole('button', { name: 'Review' })).toBeNull();
    await userEvent.click(within(li).getByRole('button'));
    const detail = document.querySelector('.split-detail') as HTMLElement;
    await within(detail).findByRole('button', { name: 'Review' });
    await userEvent.click(within(detail).getByRole('button', { name: 'Actions ▾' }));
    await screen.findByRole('menuitem', { name: /Make application kit/ });
    expect(screen.queryByRole('menuitem', { name: 'Review…' })).toBeNull(); // the button is enough
    await userEvent.keyboard('{Escape}');
    fireEvent.click(within(detail).getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog', { name: /Review/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(posts[0]).toMatchObject({ type: 'reviewJob', company: 'Lead Co', role: 'Unjudged Role', url: 'https://lead.example/u' });
});

test('Proposals send the proposal id, not a position', async () => {
    fixture();
    wrap(<NewPage />, '/new?item=proposal:ask:pr-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(posts).toEqual([{ type: 'applyProposal', company: 'Ask Co', id: 'pr-1' }, { type: 'dismissProposal', company: 'Ask Co', id: 'pr-1' }]);
});

test('Duplicate buttons send mergeCompany and keepSeparate with both names', async () => {
    fixture();
    wrap(<NewPage />, '/new?item=duplicate:dup');
    await userEvent.click(await screen.findByRole('button', { name: /merge/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Different companies' }));
    expect(posts).toEqual([{ type: 'mergeCompany', from: 'Dup Co', into: 'Lead Co' }, { type: 'keepSeparate', company: 'Dup Co', other: 'lead' }]);
});

test('Mark all seen sends one markSeen with every posting', async () => {
    fixture();
    wrap(<NewPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all seen' }));
    expect(posts).toEqual([{ type: 'markSeen', seen: [{ company: 'Gone Co', postingId: 'g1', goneAt: '2026-11-15' }, { company: 'Gone Co', postingId: 'g2', goneAt: '2026-11-14' }] }]);
});

test('Mark seen in a gone posting\'s pane sends just that posting', async () => {
    fixture();
    wrap(<NewPage />);
    const li = await row(/Older Role/);
    expect(within(li).queryByRole('button', { name: 'Mark seen' })).toBeNull();
    await userEvent.click(within(li).getByRole('button'));
    const detail = document.querySelector('.split-detail') as HTMLElement;
    await userEvent.click(await within(detail).findByRole('button', { name: 'Mark seen' }));
    expect(posts).toEqual([{ type: 'markSeen', seen: [{ company: 'Gone Co', postingId: 'g2', goneAt: '2026-11-14' }] }]);
});

test('New: empty, loading and error states differ', async () => {
    companies = [];
    postings = [];
    const { unmount } = wrap(<NewPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Nothing is waiting for you. The next run is at 5am.')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    wrap(<NewPage />);
    expect(await screen.findByText("Couldn't load this. Reload to try again.")).toBeInTheDocument();
});

test('New: selecting an item on a phone scrolls its detail into view', async () => {
    fixture();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    wrap(<NewPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Lead Role/ }));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
});

test('New: on a phone, deciding scrolls to the job that took its place', async () => {
    companies = [company(), company({ name: 'Y Corp', key: 'y' })];
    postings = [lead({}), lead({ id: 'p2', companyKey: 'y', role: 'Principal Engineer' })];
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    wrap(<NewPage />, '/new?item=lead:x:p1');
    const detail = await screen.findByRole('article', { name: 'Staff Engineer job' });
    expect(scroll).not.toHaveBeenCalled(); // landing on a link doesn't scroll
    postings = [postings[1]]; // the refetch after Skip no longer has it
    await userEvent.click(within(detail).getByRole('button', { name: 'Skip this role' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip without a reason' }));
    expect(await screen.findByRole('article', { name: 'Principal Engineer job' })).toBeInTheDocument();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
});

test('New: the selected item lives in ?item=and clicking another row changes it', async () => {
    companies = [company(), company({ name: 'Y Corp', key: 'y' })];
    postings = [lead({}), lead({ id: 'p2', companyKey: 'y', role: 'Principal Engineer' })];
    wrap(<NewPage />, '/new?item=lead:y:p2');
    expect(await screen.findByRole('article', { name: 'Principal Engineer job' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Staff Engineer/ }));
    expect(await screen.findByRole('article', { name: 'Staff Engineer job' })).toBeInTheDocument();
});

test('Jobs lists rows with the company under the role, and the Saved chips filter', async () => {
    companies = [
        company({ name: 'Open Co', key: 'open', website: 'https://open.example' }),
        company({ name: 'Ruled Co', key: 'ruled', stance: 'Ruled out' }),
        company({ name: 'Gone Co', key: 'gone' }),
        company({ name: 'Saved Co', key: 'saved', jobs: { s: { state: 'saved', role: 'Saved Role', leadKey: 'k', at: '' } } }),
    ];
    postings = [
        lead({ id: 'a', companyKey: 'open', role: 'Open Role', pay: '$265,000–$300,000 base' }),
        lead({ id: 'b', companyKey: 'ruled', role: 'Passed Role' }),
        lead({ id: 'c', companyKey: 'gone', role: 'Gone Role', posted: 'no' }),
        lead({ id: 's', companyKey: 'saved', role: 'Saved Role' }),
    ];
    wrap(<JobsPage />);
    expect(await screen.findByText('Open Role')).toBeInTheDocument();
    expect(screen.queryByText('Passed Role')).toBeNull();
    expect(screen.queryByText('Gone Role')).toBeNull();
    expect(screen.getByText('$265,000–$300,000')).toBeInTheDocument();
    const jobCell = screen.getByText('Open Role').closest('td')!;
    expect(within(jobCell).getByText('Open Co')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Co' })).toHaveAttribute('href', '/companies/open'); // company page with the hover card, not the website
    expect(screen.queryByText('Job', { selector: '.kind' })).toBeNull();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Job', 'Pay', 'Status', 'Added']);
    expect(screen.getByRole('button', { name: /^All\s*2$/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Jobs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Both models liked' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Saved/ }));
    expect(screen.queryByText('Open Role')).toBeNull();
    expect(screen.getByText('Saved Role')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Not saved/ }));
    expect(screen.getByText('Open Role')).toBeInTheDocument();
    expect(screen.queryByText('Saved Role')).toBeNull();
});

test('Jobs: Applied shows on the job applied to, not on another job at the same company', async () => {
    companies = [company({ name: 'Apply Co', key: 'ap', applications: [{ id: 'a1', role: 'Role A', postingId: 'ja', appliedOn: '2026-11-01', outcome: 'applied' }] })];
    postings = [lead({ id: 'ja', companyKey: 'ap', leadKey: 'ka', role: 'Role A' }), lead({ id: 'jb', companyKey: 'ap', leadKey: 'kb', role: 'Role B' })];
    wrap(<JobsPage />);
    const rowA = (await screen.findByText('Role A')).closest('tr')!;
    const rowB = screen.getByText('Role B').closest('tr')!;
    expect(within(rowA).getByRole('link', { name: 'Applied' })).toBeInTheDocument();
    expect(within(rowB).queryByRole('link', { name: 'Applied' })).toBeNull();
});

test('Jobs: empty and error states differ', async () => {
    companies = [];
    postings = [];
    const { unmount } = wrap(<JobsPage />);
    expect(await screen.findByText('No open jobs yet. They appear after a search run finds a lead.')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    wrap(<JobsPage />);
    expect(await screen.findByText("Couldn't load this. Reload to try again.")).toBeInTheDocument();
});

test('Applications: Closed counts each outcome, lists closed cards with Reopen, and Re-check sends recheck', async () => {
    companies = [
        company({ name: 'A Co', key: 'a', applications: [{ id: 'a1', postingId: 'pa', role: 'R', appliedOn: '2026-11-02', outcome: 'applied' }] }),
        company({ name: 'P Co', key: 'p', applications: [{ id: 'a2', role: 'R', appliedOn: '2026-11-02', outcome: 'passed', reason: 'too much on-call' }] }),
    ];
    postings = [posting({ id: 'pa', companyKey: 'a', pay: '$150k - $160k' })];
    wrap(<ApplicationsPage />, '/applications');
    expect(await screen.findByText('1 open, 1 closed')).toBeInTheDocument();
    expect(screen.getByText('$150k - $160k')).toHaveClass('low');
    expect(screen.queryByText(/too much on-call/)).toBeNull();
    const closed = screen.getByRole('button', { name: /^Closed/ });
    expect(closed).toHaveTextContent('I passed 1');
    expect(closed).toHaveTextContent('Rejected 0');
    await userEvent.click(closed);
    const list = screen.getByRole('region', { name: 'Closed applications' });
    expect(within(list).getByText(/too much on-call/)).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Reopen' }));
    expect(posts).toEqual([{ type: 'setOutcome', company: 'P Co', applicationId: 'a2', outcome: 'applied' }]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Actions ▾' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Re-check posting' }));
    await waitFor(() => expect(posts[1]).toEqual({ type: 'recheck', company: 'A Co' }));
    await userEvent.click(screen.getByRole('button', { name: 'Re-check all postings' }));
    expect(posts[2]).toEqual({ type: 'recheck' });
});

test('Companies: the Ruled out chip shows only Ruled out, and held new companies are not listed', async () => {
    companies = [company({ name: 'W Co', key: 'w' }), company({ name: 'P Co', key: 'p', stance: 'Ruled out' }), company({ name: 'H Co', key: 'h', stance: '' })];
    wrap(<CompaniesPage />);
    expect(await screen.findByText('W Co')).toBeInTheDocument();
    expect(screen.queryByText('H Co')).toBeNull();
    expect(screen.queryByText('Company', { selector: '.kind' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'site' })).toBeNull();
    expect(screen.queryByRole('link', { name: /website/i })).toBeNull();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Company', 'Stance', 'What they do', 'Postings', 'Last checked']);
    await userEvent.click(screen.getByRole('button', { name: /^Ruled out/ }));
    expect(screen.queryByText('W Co')).toBeNull();
    expect(screen.getByText('P Co')).toBeInTheDocument();
});

test('Unread: first visit marks existing jobs read, a job added later is unread until opened', async () => {
    localStorage.clear();
    companies = [company()];
    postings = [lead({ firstRun: '2026-11-18-tracked-142633' })];
    const view = wrap(<NewPage />);
    expect(await screen.findByText('Nov 18')).toBeInTheDocument();
    expect(document.querySelector('.queue li.unread')).toBeNull();
    view.unmount();
    postings = [...postings, lead({ id: 'p2', leadKey: 'k2', role: 'Fresh Role', firstRun: '2026-11-19-tracked-100000' })];
    wrap(<NewPage />);
    const fresh = await row(/Fresh Role/);
    expect(fresh).toHaveClass('unread');
    await userEvent.click(within(fresh).getByRole('button'));
    await waitFor(() => expect(fresh).not.toHaveClass('unread'));
});

test('while a tracked run is active the Judge roles button gives way to a status line', async () => {
    fixture();
    activeRuns = [{ id: 1, workflow: 'search.yml', title: 'search tracked (judging all, 4 more batches after this)', status: 'in_progress' }];
    wrap(<NewPage />);
    expect(await screen.findByRole('button', { name: 'Judging all in batches… (4 more after this)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Judge roles…' })).toBeNull();
});

test('Judge roles: a count posts sweepRoles, All also asks for the chain', async () => {
    fixture();
    wrap(<NewPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Judge roles…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ type: 'run', workflow: 'tracked', sweepRoles: 30 }));
    await userEvent.click(await screen.findByRole('button', { name: 'Judge roles…' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /How many/ }));
    await userEvent.click(await screen.findByRole('option', { name: /^All/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ type: 'run', workflow: 'tracked', sweepRoles: 30, chain: true }));
});

test('New leads sort into open fit buckets across runs, low fit before not scored', async () => {
    companies = [company({ name: 'Acme', key: 'acme' })];
    const run1 = '2026-11-20-tracked-100000';
    const run2 = '2026-11-19-vertical-110000';
    postings = [
        lead({ id: 'a', companyKey: 'acme', leadKey: 'a', role: 'Strong Role', fit: 5, lastRun: run1, firstRun: run1 }),
        lead({ id: 'b', companyKey: 'acme', leadKey: 'b', role: 'Maybe Role', fit: 3, lastRun: run1, firstRun: run1 }),
        lead({ id: 'c', companyKey: 'acme', leadKey: 'c', role: 'Low Role', fit: 1, lastRun: run2, firstRun: run2 }),
        lead({ id: 'd', companyKey: 'acme', leadKey: 'd', role: 'Old Role', lastRun: run2, firstRun: run2 }),
    ];
    wrap(<NewPage />);
    await screen.findByRole('region', { name: 'Strong fit' });
    const buckets = ['Strong fit', 'Maybe', 'Low fit', 'Not scored'];
    buckets.forEach((name, i) => expect(within(screen.getByRole('region', { name })).getByText(['Strong Role', 'Maybe Role', 'Low Role', 'Old Role'][i])).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: 'Run' })).toBeNull();
    expect(screen.queryByRole('button', { name: /untouched/ })).toBeNull();
});

test('a reason chip skips with that reason; Other takes your own words', async () => {
    fixture();
    wrap(<NewPage />, '/new?item=lead:lead:l1');
    const detail = await screen.findByRole('article', { name: 'Lead Role job' });
    const job = { company: 'Lead Co', postingId: 'l1', leadKey: 'lk', role: 'Lead Role', url: 'https://lead.example/1' };
    await userEvent.click(within(detail).getByRole('button', { name: 'Skip this role' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Why skip?' })).getByRole('button', { name: 'Not remote' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'skipJob', ...job, reason: 'Not remote' }]));
    await userEvent.click(within(detail).getByRole('button', { name: 'Save' }));
    await userEvent.type(within(await screen.findByRole('dialog', { name: 'Why save?' })).getByLabelText('Other'), 'Love the team{Enter}');
    await waitFor(() => expect(posts.at(-1)).toEqual({ type: 'saveJob', ...job, reason: 'Love the team' }));
});

test('tune proposals show on New with the edit and why; Apply sends applyTune', async () => {
    tune = [
        { id: 'tune:T:1', file: 'instructions.md', find: 'Skip on-site roles.', replace: 'Skip on-site and hybrid roles.', why: 'You skipped 3 hybrid roles.', at: 'T', status: 'open' },
        { id: 'tune:T:2', file: 'instructions.md', find: 'x', replace: 'y', why: 'Old.', at: 'T', status: 'dismissed' },
    ];
    companies = [];
    postings = [];
    wrap(<NewPage />);
    const box = await screen.findByLabelText('Search rule changes');
    expect(within(box).getByText('Skip on-site and hybrid roles.')).toBeInTheDocument();
    expect(within(box).queryByText('Old.')).toBeNull();
    await userEvent.click(within(box).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'applyTune', id: 'tune:T:1' }]));
});

test('Passed companies: a suggested rule-out asks Rule out or Keep, and Keep sends keepCompany', async () => {
    companies = [company({ name: 'Defense Co', key: 'defense', stance: '', ruleOutSuggested: { by: 'claude', reason: 'Builds weapons targeting.' } })];
    postings = [];
    wrap(<PassedPage />, '/passed?show=companies');
    expect(await screen.findByText('Builds weapons targeting.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'keepCompany', company: 'Defense Co' }]));
    await userEvent.click(screen.getByRole('button', { name: 'Rule out' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ type: 'setStance', company: 'Defense Co', stance: 'Ruled out', ruleOutAsked: true }));
});

test('Passed lists jobs dropped from Saved with a Save button', async () => {
    companies = [company({ name: 'Drop Co', key: 'drop', jobs: { 'key:d1': { state: 'skipped', role: 'Drop Role', url: 'https://drop.example/1', leadKey: 'dlk', at: '2026-11-20', fromSaved: '2026-11-22', reasons: [{ state: 'skipped', reason: 'Too big', at: '2026-11-22' }] } } })];
    postings = [];
    wrap(<PassedPage />, '/passed');
    await userEvent.click(await screen.findByRole('button', { name: 'Dropped from Saved (1)' }));
    const row = (await screen.findByText('Drop Role')).closest('tr')!;
    expect(within(row).getByText('Too big')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save without a reason' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'saveJob', company: 'Drop Co', postingId: 'key:d1', leadKey: 'dlk', role: 'Drop Role', url: 'https://drop.example/1' }]));
});

test('Dropped from Saved shows only the reason of the skip that dropped it', async () => {
    companies = [company({ name: 'Drop Co', key: 'drop', jobs: { 'key:d1': { state: 'skipped', role: 'Drop Role', leadKey: 'dlk', at: '2026-11-22', fromSaved: '2026-11-22', reasons: [
        { state: 'saved', reason: 'Great team', at: '2026-11-10' },
        { state: 'skipped', reason: 'Old skip', at: '2026-11-15' },
        { state: 'skipped', reason: 'Too big', at: '2026-11-22' },
    ] } } })];
    postings = [];
    wrap(<PassedPage />, '/passed?show=dropped');
    const row = (await screen.findByText('Drop Role')).closest('tr')!;
    expect(within(row).getByText('Too big')).toBeInTheDocument();
    expect(within(row).queryByText(/Great team|Old skip/)).toBeNull();
});

test('Jobs: pay under the floor is amber', async () => {
    companies = [company({ name: 'Low Co', key: 'low' })];
    postings = [lead({ id: 'l', companyKey: 'low', role: 'Low Role', pay: '$140K - $165K' })];
    wrap(<JobsPage />);
    expect(await screen.findByText('$140K - $165K')).toHaveClass('low');
});

test('Passed jobs: role link, Posting, the company under it, amber pay under the floor, no Kind pill', async () => {
    companies = [company({ name: 'Pass Co', key: 'pass', stance: '' })];
    postings = [posting({ id: 'pp', companyKey: 'pass', role: 'Passed Role', modelSays: 'pass', wasLead: false, pay: '$140K - $165K', url: 'https://pass.example/j' })];
    wrap(<PassedPage />, '/passed');
    const cell = (await screen.findByText('Passed Role')).closest('td')!;
    expect(within(cell).getByRole('link', { name: 'Passed Role' })).toHaveAttribute('href', '/jobs/pp');
    expect(within(cell).getByRole('link', { name: /Posting/ })).toHaveAttribute('href', 'https://pass.example/j');
    expect(within(cell.querySelector('.co') as HTMLElement).getByRole('link', { name: 'Pass Co' })).toHaveAttribute('href', '/companies/pass');
    expect(cell.querySelector('.kind')).toBeNull();
    expect(screen.getByText('$140K - $165K')).toHaveClass('low');
});

test('New lists Flagged first with the latest note', async () => {
    companies = [
        company({ name: 'Lead Co', key: 'lead' }),
        company({ name: 'Flag Co', key: 'flag', jobFlags: { p1: { at: '2026-11-20', role: 'Flag Role', leadKey: 'fk' } }, jobNotes: { p1: [{ at: '2026-11-19', text: 'first' }, { at: '2026-11-20', text: 'latest' }] } }),
    ];
    postings = [lead({ id: 'l1', companyKey: 'lead', leadKey: 'lk', role: 'Lead Role' }), lead({ id: 'p1', companyKey: 'flag', leadKey: 'fk', role: 'Flag Role' })];
    wrap(<NewPage />);
    const list = await screen.findByRole('region', { name: 'Waiting for you' });
    const heads = within(list).getAllByRole('heading');
    expect(heads[0].textContent).toBe('Flagged1');
    const li = await row(/Flag Co/);
    expect(within(li).getByText('latest')).toBeInTheDocument();
    expect(within(li).queryByText('first')).toBeNull();
    expect(within(li).getByText('Flag Role')).toBeInTheDocument();
});

test('New: a job flag with no posting row can still be unflagged', async () => {
    companies = [company({ name: 'Flag Co', key: 'flag', jobFlags: { p9: { at: '2026-11-20', role: 'Gone Role', leadKey: 'gk' } } })];
    postings = [];
    wrap(<NewPage />);
    await screen.findByText(/no longer listed/);
    await userEvent.click(await screen.findByRole('button', { name: /Flagged ⚑/ }));
    await waitFor(() => expect(posts).toEqual([{ type: 'setFlag', company: 'Flag Co', postingId: 'p9', role: 'Gone Role', leadKey: 'gk', on: false }]));
});

test('Re-check saved asks first, then dispatches', async () => {
    savedFixture();
    wrap(<NewPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Re-check saved…' }));
    expect(await screen.findByText(/Re-score 2 saved, applying and flagged jobs/)).toBeInTheDocument();
    expect(posts.some((b) => b.workflow === 'rescore')).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Re-check' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ type: 'run', workflow: 'rescore' }));
});

test('Re-check button is disabled while a rescore runs', async () => {
    savedFixture();
    activeRuns = [{ id: 2, workflow: 'rescore.yml', title: 'rescore', status: 'in_progress' }];
    wrap(<NewPage />);
    expect(await screen.findByRole('button', { name: 'Re-checking…' })).toBeDisabled();
});

test('New lists Applying after Flagged with the kit status', async () => {
    companies = [
        company({ name: 'Flag Co', key: 'flag', jobFlags: { f1: { at: '2026-11-20', role: 'Flag Role', leadKey: 'fk' } } }),
        company({ name: 'Apply Co', key: 'apply', jobs: { a1: { state: 'applying', role: 'Apply Role', leadKey: 'ak', at: '2026-11-22' } } }),
    ];
    postings = [lead({ id: 'f1', companyKey: 'flag', leadKey: 'fk', role: 'Flag Role' }), lead({ id: 'a1', companyKey: 'apply', leadKey: 'ak', role: 'Apply Role' })];
    wrap(<NewPage />);
    const list = await screen.findByRole('region', { name: 'Waiting for you' });
    expect(within(list).getAllByRole('heading').map((h) => h.textContent).slice(0, 2)).toEqual(['Flagged1', 'Applying1']);
    const li = await row(/Apply Co/);
    expect(within(li).getByText('Apply Role')).toBeInTheDocument();
    expect(await within(li).findByText('No kit yet')).toBeInTheDocument();
});
