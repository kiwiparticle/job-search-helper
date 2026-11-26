import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Company, Posting } from '../model';
import { company, lines, posting } from '../test-fixtures';
import { ToastProvider } from '../toast';
import { ApplicationsPage } from './ApplicationsPage';
import { CompanyPanel } from './CompanyPage';
import { JobPage, JobPanel } from './JobPage';
import { KitPage, KitsPage } from './Kits';

let companies: Company[] = [];
let postings: Posting[] = [];
let report: unknown = { leads: [] };
let history = '';
let guardPosts = false;
const posts: Record<string, unknown>[] = [];
const path = (url: string) => decodeURIComponent(url.split('path=')[1] ?? '');
let registry: unknown = null;
let status: { workflow: string; title: string; status: string; startedAt: string; url: string }[] = [];
beforeEach(() => {
    posts.length = 0;
    companies = [];
    postings = [];
    report = { leads: [] };
    history = '';
    guardPosts = false;
    status = [];
    registry = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body));
            posts.push(body);
            if (guardPosts && !body.confirmed && !body.ruleOutAsked) return new Response(JSON.stringify({ error: 'Rule out X Corp?', needsConfirm: true }), { status: 409 });
            return new Response('{"ok":true}');
        }
        if (url === '/api/companies') return new Response(lines(companies));
        if (url === '/api/postings') return new Response(lines(postings));
        if (url.includes('profile.json')) return new Response('{"payFloor":170000,"currency":"USD"}');
        if (url.includes('models.json') && registry) return new Response(JSON.stringify(registry));
        if (url === '/api/status') return new Response(JSON.stringify({ runs: status }));
        if (url.startsWith('/api/history')) return new Response(history);
        if (url.startsWith('/api/thread')) return new Response('{"messages":[]}');
        if (path(url).endsWith('report.json')) return new Response(JSON.stringify(report));
        if (path(url) === 'followups/x-staff-engineer-a1') return new Response('[{"name":"followup-1.md","type":"file"},{"name":"followup-2.md","type":"file"},{"name":"followup-10.md","type":"file"}]');
        if (path(url) === 'followups/x-staff-engineer-a1/followup-10.md') return new Response('Subject: Checking in\n\nHi Dana, still keen.');
        if (path(url).startsWith('followups/')) return new Response('old');
        if (path(url) === 'applications') return new Response('[{"name":"acme-staff","type":"dir"}]');
        if (path(url) === 'applications/acme-staff/meta.json') return new Response('{"company":"Acme","role":"Staff Engineer","url":"https://acme.example/j","postingId":"pa1","pieces":"resume","drafter":"claude"}');
        if (path(url) === 'applications/acme-staff/kit.json') return new Response('{"open":[{"issue":"Title","drafter":"a","reviewer":"b"}]}');
        return new Response('[]');
    }));
});
afterEach(() => vi.unstubAllGlobals());

let client: QueryClient;
const wrap = (ui: React.ReactNode, at = '/') => render(
    <QueryClientProvider client={(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
        <ToastProvider><MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter></ToastProvider>
    </QueryClientProvider>,
);

test('the bare company view (job pane Company tab) shows company notes', () => {
    wrap(<CompanyPanel bare company={company({ notes: [{ at: '2026-11-20', text: 'ask about equity' }] })} />);
    expect(screen.getByText('ask about equity')).toBeInTheDocument();
});

test('the header: crumb, plain name, facts line with checked date, domain, Website link and + note', () => {
    const { unmount } = wrap(<CompanyPanel company={company()} />);
    expect(screen.queryByRole('link', { name: /Website/ })).toBeNull();
    unmount();
    wrap(<CompanyPanel company={company({ website: 'https://x.example', size: '200 (unverified)', funding: 'Series B', lastChecked: '2026-11-20', domain: 'Payroll software' })} />);
    expect(screen.getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/companies');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^X Corp$/);
    expect(screen.queryByRole('link', { name: 'X Corp' })).toBeNull();
    expect(document.querySelector('.facts-line')).toHaveTextContent(/200.*Series B.*checked 2026-11-20/);
    expect(document.querySelector('.facts-line .unverified')).toHaveTextContent(/^200$/);
    expect(screen.getByText('Payroll software')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Website/ })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: '+ note' })).toBeInTheDocument();
    expect(document.querySelector('.kind')).toBeNull();
});

test('the stance is one menu: Watching ▾ lists the four stances with the current one checked, Dormant sends setStance', async () => {
    wrap(<CompanyPanel company={company({ stance: 'Watching' })} />);
    for (const name of ['Watch', 'Dormant', 'Review later']) expect(screen.queryByRole('button', { name })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Watching ▾' }));
    const stances = await screen.findAllByRole('menuitemradio');
    expect(stances.map((m) => m.textContent?.replace('✓', ''))).toEqual(['Watching', 'Dormant', 'Review later']);
    expect(stances.map((m) => m.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByRole('menuitem', { name: 'Rule out' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Dormant/ }));
    await waitFor(() => expect(posts).toEqual([{ type: 'setStance', company: 'X Corp', stance: 'Dormant' }]));
});

test('with no stance the menu reads No stance; Rule out asks first', async () => {
    guardPosts = true;
    wrap(<CompanyPanel company={company({ stance: '' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'No stance ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rule out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rule out X Corp' });
    expect(posts).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rule out company' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'setStance', company: 'X Corp', stance: 'Ruled out', ruleOutAsked: true }]));
});

const fillRegistry = {
    models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex' }, { id: 'qwen', label: 'Qwen', runner: 'opencode' }, { id: 'off', label: 'Off', runner: 'opencode', enabled: false }],
    defaults: { search: { searchers: ['claude', 'codex'], reviewer: null }, ask: { model: 'both' }, fill: { model: 'qwen' } },
};

const startFill = async () => {
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
};

test('Actions lists Ask a question…; Start posts ask with the default model', async () => {
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ask a question…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Question'), 'Why?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask' }));
    await screen.findByText(/Asked /);
    expect(posts).toEqual([{ type: 'ask', company: 'X Corp', model: 'both', question: 'Why?' }]);
});

test('Actions lists Look up company facts; Start posts fillFacts for the default Claude', async () => {
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Look up company facts…' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('combobox', { name: 'Who looks up facts' })).toHaveTextContent('Claude');
    await startFill();
    await waitFor(() => expect(posts).toEqual([{ type: 'fillFacts', company: 'X Corp' }]));
});

test.each(['Fill in company facts', 'Look up culture', 'Look up stability'])('the inline %s button opens the fill dialog', async (name) => {
    wrap(<CompanyPanel company={company({ culture: '', stability: '', size: '' })} />);
    expect(screen.queryByRole('combobox', { name: 'Who looks up facts' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('combobox', { name: 'Who looks up facts' })).toBeInTheDocument();
    expect(posts).toEqual([]);
});

test('a missing age puts Fill in company facts on the facts line', async () => {
    wrap(<CompanyPanel company={company({ size: '50', founded: '' })} />);
    await userEvent.click(within(document.querySelector('.facts-line') as HTMLElement).getByRole('button', { name: 'Fill in company facts' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

// fill.yml runs claude when no model is sent, so only a pick other than claude is sent.
test('the fill dialog starts on defaults.fill and sends it', async () => {
    registry = fillRegistry;
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fill in company facts' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who looks up facts' })).toHaveTextContent('Qwen'));
    await startFill();
    await waitFor(() => expect(posts).toEqual([{ type: 'fillFacts', company: 'X Corp', model: 'qwen' }]));
});

test('picking Claude for fill sends no model', async () => {
    registry = fillRegistry;
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fill in company facts' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who looks up facts' })).toHaveTextContent('Qwen'));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who looks up facts' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Claude' }));
    await startFill();
    await waitFor(() => expect(posts).toEqual([{ type: 'fillFacts', company: 'X Corp' }]));
});

test('picking another fill model sends it; disabled models are not offered', async () => {
    registry = fillRegistry;
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fill in company facts' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who looks up facts' })).toHaveTextContent('Qwen'));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who looks up facts' }));
    expect(screen.queryByRole('option', { name: 'Off' })).toBeNull();
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    await startFill();
    await waitFor(() => expect(posts).toEqual([{ type: 'fillFacts', company: 'X Corp', model: 'codex' }]));
});

test('a disabled fill default falls back to Claude', async () => {
    registry = { ...fillRegistry, defaults: { ...fillRegistry.defaults, fill: { model: 'off' } } };
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fill in company facts' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Who looks up facts' })).toHaveTextContent('Claude'));
    await startFill();
    await waitFor(() => expect(posts).toEqual([{ type: 'fillFacts', company: 'X Corp' }]));
});

test('Company facts with no value are hidden', () => {
    wrap(<CompanyPanel company={company({ recheckTrigger: '', reason: '' })} />);
    expect(screen.queryByText('Next check')).toBeNull();
    expect(screen.queryByText('Why')).toBeNull();
});

test('Company facts with a value are shown', () => {
    wrap(<CompanyPanel company={company({ recheckTrigger: 'Hiring freeze ends' })} />);
    expect(screen.getByText('Next check')).toBeInTheDocument();
});

const openMenuItem = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name }));
};

test('Add job by link needs a role and a link, then sends addJob', async () => {
    wrap(<CompanyPanel company={company()} />);
    expect(screen.queryByRole('button', { name: /Add job by link|Mark applied/ })).toBeNull();
    await openMenuItem('Add job by link…');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Role is required.');
    expect(posts).toEqual([]);
    await userEvent.type(screen.getByLabelText('Role'), 'Staff Engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Link to the posting is required.');
    await userEvent.type(screen.getByLabelText('Link to the posting'), 'https://x.example/j');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'addJob', company: 'X Corp', role: 'Staff Engineer', url: 'https://x.example/j' }]);
});

test('Mark applied on a company page asks for a role, sends an applicationId and no postingId', async () => {
    wrap(<CompanyPanel company={company()} />);
    await openMenuItem('Mark applied…');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([]);
    await userEvent.type(screen.getByLabelText('Role'), 'Lead');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'markApplied', applicationId: expect.stringMatching(/^[0-9a-f-]{36}$/), company: 'X Corp', role: 'Lead' }]);
});

test('Company: an application matched by leadKey marks its job row Applied and its card links the job and sets the stage', async () => {
    postings = [posting()];
    wrap(<CompanyPanel company={company({ applications: [{ id: 'a1', leadKey: 'k', role: 'Staff Engineer', appliedOn: '2026-10-12', approx: true, outcome: 'applied' }] })} />);
    const card = await screen.findByRole('region', { name: 'Applications' });
    expect(await within(card).findByRole('link', { name: 'Staff Engineer' })).toHaveAttribute('href', '/jobs/p1');
    expect(screen.getByText(/· Applied$/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('combobox', { name: 'Stage for Staff Engineer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Screening' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'setStage', company: 'X Corp', applicationId: 'a1', stage: 'screening' }]));
});

test('the company page lists jobs with no posting yet, and merges events, sightings and history newest first', async () => {
    history = `${JSON.stringify({ companyKey: 'x', heading: '2026-11-10 culture sweep', text: 'Culture notes' })}\n`;
    postings = [posting({ firstRun: '2026-11-12-daily', lastRun: '2026-11-14-daily' })];
    const c = company({ jobs: { j9: { state: 'saved', role: 'Added Role', leadKey: 'zz', at: '2026-11-13' } }, events: [{ date: '2026-11-13', text: 'Saved Added Role' }] });
    wrap(<CompanyPanel company={c} />);
    expect(screen.getByRole('link', { name: 'Added Role' })).toHaveAttribute('href', '/jobs/j9');
    await screen.findByText('Culture notes');
    const items = within(screen.getByRole('heading', { name: /Timeline/ }).closest('.fold')!).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
        'Last seen: Staff Engineer2026-11-14',
        'Saved Added Role2026-11-13',
        'First seen: Staff Engineer2026-11-12',
        'Culture notes2026-11-10',
    ]);
});

test('a gone posting shows the banner and Mark seen sends the new markSeen shape', async () => {
    wrap(<JobPanel company={company()} posting={posting({ posted: 'no', goneAt: '2026-11-15' })} />);
    expect(screen.getByText('This posting was taken down.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark seen' }));
    expect(posts).toEqual([{ type: 'markSeen', seen: [{ company: 'X Corp', postingId: 'p1', goneAt: '2026-11-15' }] }]);
});

test('Mark applied sends an applicationId and the job postingId, leadKey, role and url', async () => {
    wrap(<JobPanel company={company()} posting={posting()} />);
    expect(screen.queryByText('This posting was taken down.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark applied' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark applied' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: /Mark applied/ })).toBeNull();
    expect(posts).toEqual([{ type: 'markApplied', applicationId: expect.any(String), company: 'X Corp', postingId: 'p1', leadKey: 'k', role: 'Staff Engineer', url: 'https://x.example/1' }]);
});

test('the job Actions menu lists Review, Mark applied, kit, Rule out last; two quick Mark applied clicks post once', async () => {
    wrap(<JobPanel company={company()} posting={posting()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    const names = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
    expect(names).toEqual(['Review…', 'Mark applied', 'Edit posting link…', 'Make application kit', 'Rule out company…']);
    await userEvent.dblClick(screen.getByRole('menuitem', { name: 'Mark applied' }));
    await waitFor(() => expect(posts).toHaveLength(1));
});

test('Edit posting link… in the job Actions menu sends setPostingUrl', async () => {
    wrap(<JobPanel company={company()} posting={posting()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit posting link…' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Link to the posting');
    await userEvent.clear(field);
    await userEvent.type(field, 'https://x.example/2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'setPostingUrl', company: 'X Corp', postingId: 'p1', url: 'https://x.example/2' }]));
});

test('the job header: company block, links row, + note, no Kind pills', () => {
    wrap(<JobPanel company={company({ size: '200 employees (unverified)', funding: 'Series B', domain: 'Payroll software', website: 'https://x.example', careersUrl: 'https://x.example/careers' })} posting={posting({ pay: '$180k-$210k' })} />);
    expect(screen.getByText('200 employees')).toHaveClass('unverified');
    expect(screen.getByText('Series B')).toBeInTheDocument();
    expect(screen.getByText('Payroll software')).toBeInTheDocument();
    for (const n of [/Posting/, /Website/, /Careers/]) expect(screen.getByRole('link', { name: n })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ note' })).toBeInTheDocument();
    expect(document.querySelector('.kind')).toBeNull();
    expect(screen.getByText('$180–210k')).toBeInTheDocument();
});

test('header facts keep run-on unverified text whole; Fingerprint unscored on the company pane', () => {
    const { unmount } = wrap(<JobPanel company={company({ size: 'Nearly 800; engineering count unverified' })} posting={posting({})} />);
    expect(screen.getByText('Nearly 800; engineering count unverified')).toHaveClass('unverified');
    unmount();
    wrap(<CompanyPanel company={company({ fingerprint: 'Unscored — thin evidence' })} />);
    expect(screen.getByText('Fingerprint unscored')).toBeInTheDocument();
});

test('Job pane shows the company in reading order', () => {
    const { unmount } = wrap(<JobPanel company={company({ fingerprint: '4/5 — calm pace, long tenure', culture: 'Remote-first', domain: 'Payroll software', size: '200', founded: '2009', funding: 'Series B' })} posting={posting({})} />);
    const labels = [...document.querySelectorAll('.saved-facts dt')].map((d) => d.textContent);
    expect(labels).toEqual(['Fingerprint', 'Culture', 'What they do', 'Size']);
    expect(document.querySelector('.saved-facts')).toHaveTextContent(/calm pace.*Remote-first.*Payroll software.*200.*Series B/);
    unmount();
    wrap(<JobPanel company={company({ fingerprint: '4/5', size: '200' })} posting={posting({})} />);
    expect([...document.querySelectorAll('.saved-facts dt')].map((d) => d.textContent)).toEqual(['Fingerprint', 'Size']);
});

test('Save and Skip this role send saveJob and skipJob; there is no old Watch company button', async () => {
    wrap(<JobPanel company={company()} posting={posting()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save without a reason' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip this role' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip without a reason' }));
    const job = { company: 'X Corp', postingId: 'p1', leadKey: 'k', role: 'Staff Engineer', url: 'https://x.example/1' };
    await waitFor(() => expect(posts).toEqual([{ type: 'saveJob', ...job }, { type: 'skipJob', ...job }]));
    expect(screen.queryByRole('button', { name: 'Watch company' })).toBeNull();
});

test('the job page says so when the report has no write-up for the job, and shows it when it does', async () => {
    companies = [company()];
    postings = [posting()];
    const at = (ui: React.ReactNode) => <Routes><Route path="/jobs/:id" element={ui} /></Routes>;
    const { unmount } = wrap(at(<JobPage />), '/jobs/p1');
    expect(await screen.findByText('Loading the write-up…')).toBeInTheDocument();
    expect(await screen.findByText('No write-up saved for this job.')).toBeInTheDocument();
    unmount();
    report = { leads: [{ key: 'k', company: 'X Corp', role: 'Staff Engineer', foundBy: 'both', claude: { verdict: 'Lead', note: 'Claude likes it' }, codex: null, questions: ['Is on-call paid?'] }] };
    wrap(at(<JobPage />), '/jobs/p1');
    expect(await screen.findByText('Claude likes it')).toBeInTheDocument();
    expect(screen.getByText('Is on-call paid?')).toBeInTheDocument();
});

test('a passed job shows its write-up from the report\'s near misses', async () => {
    companies = [company()];
    postings = [posting()];
    report = { leads: [], nearMisses: [{ key: 'k', company: 'X Corp', role: 'Staff Engineer', foundBy: 'both', opinions: { claude: { verdict: 'Skip', note: 'No real posting' } } }] };
    wrap(<Routes><Route path="/jobs/:id" element={<JobPage />} /></Routes>, '/jobs/p1');
    expect(await screen.findByText('No real posting')).toBeInTheDocument();
});

test('the job page says Unreviewed only for a find nobody reviewed', async () => {
    companies = [company()];
    postings = [posting()];
    const at = (ui: React.ReactNode) => <Routes><Route path="/jobs/:id" element={ui} /></Routes>;
    const lead = { key: 'k', company: 'X Corp', role: 'Staff Engineer', foundBy: 'claude', claude: { verdict: 'Lead', note: 'Claude likes it' }, codex: null };
    report = { leads: [{ ...lead, reviewed: false }] };
    const { unmount } = wrap(at(<JobPage />), '/jobs/p1');
    expect(await screen.findByText('Unreviewed.')).toBeInTheDocument();
    unmount();
    report = { leads: [lead] };
    wrap(at(<JobPage />), '/jobs/p1');
    await screen.findByText('Claude likes it');
    expect(screen.queryByText('Unreviewed.')).toBeNull();
});

test('a job entry with no posting still has a page', async () => {
    companies = [company({ jobs: { j9: { state: 'saved', role: 'Added Role', leadKey: 'zz', at: '' } } })];
    wrap(<Routes><Route path="/jobs/:id" element={<JobPage />} /></Routes>, '/jobs/j9');
    expect(await screen.findByText('Waiting for the next posting check.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark applied' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts).toEqual([{ type: 'markApplied', applicationId: expect.any(String), company: 'X Corp', postingId: 'j9', leadKey: 'zz', role: 'Added Role' }]);
});

// YYYY-MM-DD for `days` days before the browser's today.
const daysBefore = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const appMenu = async (item: string) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
};

test('Applications: an interviewing application sits in the Interviewing column; changing its stage to Offer sends setStage', async () => {
    companies = [company({ applications: [
        { id: 'a1', role: 'Staff Engineer', appliedOn: daysBefore(2), outcome: 'applied', stage: 'interviewing', stageOn: daysBefore(1) },
        { id: 'a2', role: 'Other', appliedOn: daysBefore(2), outcome: 'applied' },
    ] })];
    wrap(<ApplicationsPage />);
    const col = await screen.findByRole('region', { name: 'Interviewing' });
    expect(within(col).getByText('Staff Engineer')).toBeInTheDocument();
    expect(within(col).getByText('1d')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Applied' })).getByText('Other')).toBeInTheDocument();
    await userEvent.click(within(col).getByRole('combobox', { name: 'Stage for Staff Engineer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Offer' }));
    expect(posts).toEqual([{ type: 'setStage', company: 'X Corp', applicationId: 'a1', stage: 'offer' }]);
});

test('Applications: a future-dated stageOn shows 0d, not a negative age', async () => {
    companies = [company({ applications: [{ id: 'a1', role: 'R', appliedOn: daysBefore(2), outcome: 'applied', stage: 'screening', stageOn: daysBefore(-1) }] })];
    wrap(<ApplicationsPage />);
    expect(await screen.findByText('0d')).toBeInTheDocument();
});

test('Applications: applied 8 days ago with no next step shows Follow up? and the count', async () => {
    companies = [company({ applications: [
        { id: 'a1', role: 'Old', appliedOn: daysBefore(8), outcome: 'applied' },
        { id: 'a2', role: 'New', appliedOn: daysBefore(2), outcome: 'applied', next: { text: 'Send portfolio' } },
    ] })];
    wrap(<ApplicationsPage />);
    expect(await screen.findByText('1 needs a follow-up')).toBeInTheDocument();
    expect(screen.getAllByText('Follow up?')).toHaveLength(1);
    expect(screen.getByText('Follow up?').closest('article')).toHaveTextContent('Old');
    expect(screen.getByText('Send portfolio')).toBeInTheDocument();
});

test('Applications: the card shows the applied date, with about for an approximate one', async () => {
    companies = [company({ applications: [
        { id: 'a1', role: 'Exact', appliedOn: '2026-11-14', outcome: 'applied' },
        { id: 'a2', role: 'Rough', appliedOn: '2026-10-03', approx: true, outcome: 'applied' },
    ] })];
    wrap(<ApplicationsPage />);
    expect((await screen.findByText('applied Nov 14')).closest('article')).toHaveTextContent('Exact');
    expect(screen.getByText('applied Nov 14')).toHaveClass('muted');
    expect(screen.getByText('applied about Oct 3').closest('article')).toHaveTextContent('Rough');
});

test('Applications: while postings are being checked, Re-check posting stays in the menu disabled as Checking…', async () => {
    status = [{ workflow: 'check-postings', title: 'check postings', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://github.com/x/actions/runs/2' }];
    companies = [company({ applications: [{ id: 'a1', role: 'R', appliedOn: daysBefore(2), outcome: 'applied' }] })];
    wrap(<ApplicationsPage />);
    await screen.findByRole('button', { name: 'Checking…' }); // the page button: the status has loaded
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    expect(await screen.findByRole('menuitem', { name: 'Checking…' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('menuitem', { name: 'Re-check posting' })).toBeNull();
});

test('Applications: Next step saves text and date with setNextStep', async () => {
    companies = [company({ applications: [{ id: 'a1', role: 'R', appliedOn: daysBefore(2), outcome: 'applied' }] })];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Next step' }));
    await userEvent.type(screen.getByLabelText('Next step (empty clears it)'), 'Email the recruiter');
    fireEvent.change(screen.getByLabelText('By when'), { target: { value: '2026-12-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'setNextStep', company: 'X Corp', applicationId: 'a1', text: 'Email the recruiter', on: '2026-12-01' }]);
});

test('Applications: a date with no next-step text shows a form error and sends nothing', async () => {
    companies = [company({ applications: [{ id: 'a1', role: 'R', appliedOn: daysBefore(2), outcome: 'applied' }] })];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Next step' }));
    fireEvent.change(screen.getByLabelText('By when'), { target: { value: '2026-12-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write the next step for that date, or clear the date.');
    expect(posts).toEqual([]);
});

test('the job pane header has the stage control for an open application to this job; Offer sends setStage', async () => {
    const app = { id: 'a1', postingId: 'p1', role: 'Staff Engineer', appliedOn: '2026-11-10', outcome: 'applied' as const, stage: 'screening' as const };
    const { unmount } = wrap(<JobPanel company={company()} posting={posting()} />);
    expect(screen.queryByRole('combobox', { name: 'Stage for Staff Engineer' })).toBeNull();
    unmount();
    wrap(<JobPanel company={company({ applications: [app] })} posting={posting()} />);
    const stage = screen.getByRole('combobox', { name: 'Stage for Staff Engineer' });
    expect(stage).toHaveTextContent('Screening');
    expect(screen.getByRole('button', { name: 'Next step' })).toBeInTheDocument();
    await userEvent.click(stage);
    await userEvent.click(await screen.findByRole('option', { name: 'Offer' }));
    expect(posts).toEqual([{ type: 'setStage', company: 'X Corp', applicationId: 'a1', stage: 'offer' }]);
});

test('the job pane header shows the next step with its date, or Follow up? when one is due', () => {
    const app = { id: 'a1', postingId: 'p1', role: 'Staff Engineer', outcome: 'applied' as const };
    const { unmount } = wrap(<JobPanel company={company({ applications: [{ ...app, appliedOn: daysBefore(2), next: { text: 'Call the recruiter', on: daysBefore(-3) } }] })} posting={posting()} />);
    const head = document.querySelector('.job-head') as HTMLElement;
    expect(within(head).getByText('Call the recruiter')).toBeInTheDocument();
    expect(within(head).getByText(`· ${daysBefore(-3)}`)).toHaveClass('muted');
    expect(within(head).queryByText('Follow up?')).toBeNull();
    unmount();
    wrap(<JobPanel company={company({ applications: [{ ...app, appliedOn: daysBefore(8) }] })} posting={posting()} />);
    expect(within(document.querySelector('.job-head') as HTMLElement).getByText('Follow up?')).toHaveClass('low');
});

test('the job pane shows stage controls when a closed and an open application share the job', () => {
    const closed = { id: 'a0', postingId: 'p1', role: 'Staff Engineer', appliedOn: '2026-09-10', outcome: 'rejected' as const };
    const open = { id: 'a1', postingId: 'p1', role: 'Staff Engineer', appliedOn: '2026-11-10', outcome: 'applied' as const, stage: 'screening' as const };
    wrap(<JobPanel company={company({ applications: [closed, open] })} posting={posting()} />);
    expect(screen.getByRole('combobox', { name: 'Stage for Staff Engineer' })).toBeInTheDocument();
});

test('a migrated application with no recorded role or link offers Add posting link', async () => {
    companies = [company({ applications: [{ id: 'a1', role: 'Role not recorded', appliedOn: '2026-10-01', outcome: 'applied' }] })];
    wrap(<ApplicationsPage />);
    await appMenu('Add posting link…');
    await userEvent.type(await screen.findByLabelText('Link to the posting'), 'https://x.example/j');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'addPostingLink', company: 'X Corp', applicationId: 'a1', url: 'https://x.example/j' }]);
});

test('I passed with an empty reason sends nothing and keeps the form open; a reason sends setOutcome', async () => {
    companies = [company({ applications: [{ id: 'a1', role: 'R', appliedOn: '2026-10-01', outcome: 'applied', url: 'https://x.example/1' }] })];
    wrap(<ApplicationsPage />);
    await appMenu('I passed…');
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Why did you pass?')).toBeInTheDocument();
    expect(posts).toEqual([]);
    await userEvent.type(screen.getByLabelText('Why did you pass?'), 'too much on-call');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'setOutcome', company: 'X Corp', applicationId: 'a1', outcome: 'passed', reason: 'too much on-call' }]);
});

test('the card menu sends setOutcome and deleteApplication; Delete confirms through the server', async () => {
    companies = [company({ applications: [{ id: 'a1', role: 'R', appliedOn: '2026-10-01', outcome: 'applied', url: 'https://x.example/1' }] })];
    wrap(<ApplicationsPage />);
    await appMenu('Rejected');
    await waitFor(() => expect(posts).toHaveLength(1));
    await appMenu('No response');
    await waitFor(() => expect(posts).toHaveLength(2));
    await appMenu('Delete');
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts).toEqual([
        { type: 'setOutcome', company: 'X Corp', applicationId: 'a1', outcome: 'rejected' },
        { type: 'setOutcome', company: 'X Corp', applicationId: 'a1', outcome: 'no response' },
        { type: 'deleteApplication', company: 'X Corp', applicationId: 'a1' },
    ]);
});

test('a rerun from the Kits screen sends the saved postingId', async () => {
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    await userEvent.click((await screen.findAllByRole('button', { name: /Go with/ }))[0]);
    expect(posts[0]).toMatchObject({ type: 'kit', company: 'Acme', role: 'Staff Engineer', postingId: 'pa1' });
});

test('a started kit empties the form and shows a Starting row', async () => {
    wrap(<Routes><Route path="/kits" element={<KitsPage />} /></Routes>, '/kits?company=Beta&role=Lead&url=https%3A%2F%2Fb.example%2Fj&postingId=pb1');
    expect(await screen.findByLabelText('Company')).toHaveValue('Beta');
    await userEvent.click(screen.getByRole('button', { name: 'Make application kit' }));
    await waitFor(() => expect(screen.getByLabelText('Company')).toHaveValue(''));
    expect(posts[0]).toMatchObject({ type: 'kit', company: 'Beta', role: 'Lead', postingId: 'pb1' });
    expect(screen.getByLabelText('Role')).toHaveValue('');
    expect(screen.getByLabelText('Posting link')).toHaveValue('');
    expect(screen.getByText('Starting…')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
});

const openKit = async (item: string) => {
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: item }));
    return screen.findByRole('dialog');
};

test('the kit page lists its three actions in Actions and has no side buttons', async () => {
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    for (const n of ['Review again…', 'Apply to the resume…', 'Add a piece…']) expect(await screen.findByRole('menuitem', { name: n })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply with Codex' })).toBeNull();
    expect(screen.queryByLabelText('Note for the reviewers')).toBeNull();
});

test('the kit Actions menu lists Mark applied first; choosing it posts the old body; no visible button', async () => {
    companies = [company({ name: 'Acme' })];
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    const names = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
    expect(names).toEqual(['Mark applied', 'Review again…', 'Apply to the resume…', 'Add a piece…']);
    expect(screen.queryByRole('button', { name: 'Mark applied' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark applied' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts).toEqual([{ type: 'markApplied', applicationId: expect.any(String), company: 'Acme', role: 'Staff Engineer', url: 'https://acme.example/j', postingId: 'pa1' }]);
});

test('a kit with an application has no Mark applied item', async () => {
    companies = [company({ name: 'Acme', applications: [{ id: 'a1', role: 'Staff Engineer', postingId: 'pa1', appliedOn: '2026-10-01', outcome: 'applied' }] })];
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    await screen.findByRole('menuitem', { name: 'Review again…' });
    expect(screen.queryByRole('menuitem', { name: 'Mark applied' })).toBeNull();
});

test('Review again with the default posts both reviewers and an empty note', async () => {
    const dialog = await openKit('Review again…');
    expect(within(dialog).getByText('Review again')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await screen.findByText('Review started. It takes a few minutes.');
    expect(posts).toEqual([{ type: 'kitReview', company: 'Acme', role: 'Staff Engineer', reviewers: 'both', note: '' }]);
});

test('Review again sends the note and the chosen reviewers', async () => {
    const dialog = await openKit('Review again…');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who reviews' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    await userEvent.type(within(dialog).getByLabelText('Note for the reviewers'), 'check keywords');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await screen.findByText('Review started. It takes a few minutes.');
    expect(posts).toEqual([{ type: 'kitReview', company: 'Acme', role: 'Staff Engineer', reviewers: 'codex', note: 'check keywords' }]);
});

test('Apply with Codex sends the reviser and the note', async () => {
    const dialog = await openKit('Apply to the resume…');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who rewrites' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    await userEvent.type(within(dialog).getByLabelText('Note for the model'), 'plainer summary');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await screen.findByText(/Revising\./);
    expect(posts).toEqual([{ type: 'kitRevise', company: 'Acme', role: 'Staff Engineer', reviser: 'codex', note: 'plainer summary' }]);
});

test('Add a piece needs a piece; with one checked it posts the drafter and note', async () => {
    const dialog = await openKit('Add a piece…');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(await within(dialog).findByText('Pieces is required.')).toBeInTheDocument();
    expect(posts).toEqual([]);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Cover letter' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who writes' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    await userEvent.type(within(dialog).getByLabelText('Note for the new piece'), 'short');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await screen.findByText(/Writing it\./);
    expect(posts).toEqual([{ type: 'kitAdd', company: 'Acme', role: 'Staff Engineer', pieces: 'cover-letter', drafter: 'codex', note: 'short' }]);
});

test('a job with no run yet says it was not reviewed, instead of loading forever', () => {
    wrap(<JobPanel company={company()} posting={posting({ firstRun: '', lastRun: '', source: 'owner' })} />);
    expect(screen.queryByText('Loading the write-up…')).toBeNull();
    expect(screen.getByText(/haven't reviewed this job yet/)).toBeInTheDocument();
});

const openReview = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Review…' }));
};

test('Review… on the job page puts focus inside the dialog', async () => {
    wrap(<JobPanel company={company()} posting={posting({ url: 'https://x.example/job' })} />);
    await openReview();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
});

test('a job without a posting link has no Review… item, and the legacy items stay in the Actions menu', async () => {
    wrap(<JobPanel company={company()} posting={posting({ url: '' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    expect(await screen.findByRole('menuitem', { name: 'Make application kit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rule out company…' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Review…' })).toBeNull();
});

test('Review… is disabled while a run for this job is active', async () => {
    status = [{ workflow: 'search', title: 'job X Corp | Senior Engineer', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://github.com/x/actions/runs/1' }];
    wrap(<JobPanel company={company()} posting={posting({ url: 'https://x.example/job', role: 'Senior Engineer' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Review…' })).toHaveAttribute('aria-disabled', 'true'));
});

test('Review… stays enabled for a company-level run, disabled for this job', async () => {
    status = [{ workflow: 'ask', title: 'ask X Corp', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://github.com/x/actions/runs/2' }];
    wrap(<JobPanel company={company()} posting={posting({ url: 'https://x.example/job', role: 'Senior Engineer' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
    expect(await screen.findByRole('menuitem', { name: 'Review…' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('Review this job on the job page sends reviewJob with the posting link', async () => {
    wrap(<JobPanel company={company()} posting={posting({ url: 'https://x.example/job' })} />);
    expect(screen.queryByRole('button', { name: 'Review this job' })).toBeNull();
    await openReview();
    expect(await screen.findByRole('dialog', { name: /Review/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(posts[0]).toMatchObject({ type: 'reviewJob', url: 'https://x.example/job' });
    expect(posts[0]).not.toHaveProperty('searchers');
});

const reviewRegistry = (reviewer: string | null) => ({ ...fillRegistry, defaults: { ...fillRegistry.defaults, search: { searchers: ['claude', 'codex'], reviewer } } });

test('the job review picker starts on the registry default reviewer none and sends nothing extra', async () => {
    registry = reviewRegistry('none');
    wrap(<JobPanel company={company()} posting={posting({ url: 'https://x.example/job' })} />);
    await openReview();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('None (no review)'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(posts[0]).toMatchObject({ type: 'reviewJob' });
    expect(posts[0]).not.toHaveProperty('reviewer');
});

test('the job review picker sends reviewer each when Each other is picked', async () => {
    registry = reviewRegistry('none');
    wrap(<JobPanel company={company()} posting={posting({ url: 'https://x.example/job' })} />);
    await openReview();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reviewer' })).toHaveTextContent('None (no review)'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Reviewer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Each other' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(posts[0]).toMatchObject({ type: 'reviewJob', reviewer: 'each' });
});

test('company page job rows: role link, Posting, a muted pay and state line, no row buttons; one Check postings on the heading', async () => {
    postings = [posting({ id: 'new', role: 'Manual Role', firstRun: '', lastRun: '', source: 'owner', posted: 'unknown' }), posting({ id: 'old', role: 'Found Role', pay: '$140K - $165K' })];
    wrap(<CompanyPanel company={company({ jobs: { new: { state: 'saved', role: 'Manual Role', leadKey: 'a', url: 'https://x.example/m', at: '2026-11-18' }, old: { state: 'saved', role: 'Found Role', leadKey: 'b', url: 'https://x.example/f', at: '2026-11-18' } } })} />);
    // Postings load after the first paint; until then the job shows as a bare saved entry.
    const li = (await screen.findByText('$140K - $165K')).closest('li')!;
    expect(within(li).getByRole('link', { name: 'Found Role' })).toHaveAttribute('href', '/jobs/old');
    expect(within(li).getByRole('link', { name: /Posting/ })).toBeInTheDocument();
    expect(li.querySelector('.low')).toHaveTextContent('$140K - $165K');
    expect(li).toHaveTextContent('Saved');
    for (const name of ['Skip this role', 'Check if still live', 'Review']) expect(screen.queryByRole('button', { name })).toBeNull();
    const heading = screen.getByRole('heading', { name: /^Jobs/ });
    await userEvent.click(within(heading.parentElement!).getByRole('button', { name: 'Check postings' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'recheck', company: 'X Corp' }]));
});

test('a running review shows on the kit page and disables the kit actions', async () => {
    status = [{ workflow: 'kit-review', title: 'review Acme | Staff Engineer', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://github.com/x/actions/runs/1' }];
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    expect((await screen.findAllByText(/Reviewing a kit/)).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    for (const n of ['Review again…', 'Apply to the resume…', 'Add a piece…']) await waitFor(() => expect(screen.getByRole('menuitem', { name: n })).toHaveAttribute('aria-disabled', 'true'));
});

test('a company-level ask does not disable the kit actions', async () => {
    status = [{ workflow: 'ask', title: 'ask Acme', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'https://github.com/x/actions/runs/2' }];
    wrap(<Routes><Route path="/kits/:name" element={<KitPage />} /></Routes>, '/kits/acme-staff');
    await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions ▾' }));
    expect(await screen.findByRole('menuitem', { name: 'Add a piece…' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('model text renders as text, never markup', () => {
    const evil = '<script>alert(1)</script>';
    const { container } = wrap(<JobPanel company={company({ reason: evil })} posting={posting({ role: evil })} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
});

test('careers and jobs links show when set, and are absent when not', () => {
    const { unmount } = wrap(<CompanyPanel company={company({ careersUrl: 'https://x.example/careers', jobsUrl: 'https://boards.greenhouse.io/x' })} />);
    expect(screen.getByRole('link', { name: /Careers/ })).toHaveAttribute('href', 'https://x.example/careers');
    expect(screen.getByRole('link', { name: /Jobs/ })).toHaveAttribute('target', '_blank');
    unmount();
    wrap(<CompanyPanel company={company()} />);
    expect(screen.queryByRole('link', { name: /Careers/ })).toBeNull();
});

test('Edit careers links opens a prefilled form and sends setLinks', async () => {
    wrap(<CompanyPanel company={company({ careersUrl: 'https://x.example/careers' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    const item = await screen.findByRole('menuitem', { name: 'Edit careers links…' });
    await userEvent.hover(item);
    expect(await screen.findByText(/careers page and job board links the weekly check uses/)).toBeInTheDocument();
    await userEvent.click(item);
    expect(screen.getByLabelText('Careers page')).toHaveValue('https://x.example/careers');
    await userEvent.type(screen.getByLabelText('Jobs board'), 'https://boards.greenhouse.io/x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'setLinks', company: 'X Corp', careersUrl: 'https://x.example/careers', jobsUrl: 'https://boards.greenhouse.io/x' }]);
});

test('links open in a new tab, and an unsafe stored link is not rendered as a link', () => {
    const { unmount } = wrap(<CompanyPanel company={company({ careersUrl: 'https://x.example/careers', jobsUrl: 'https://boards.greenhouse.io/x' })} />);
    expect(screen.getByRole('link', { name: /Careers/ })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: /Jobs/ })).toHaveAttribute('href', 'https://boards.greenhouse.io/x');
    expect(screen.getByRole('link', { name: /Jobs/ })).toHaveAttribute('target', '_blank');
    unmount();
    wrap(<CompanyPanel company={company({ careersUrl: 'javascript:alert(1)', jobsUrl: 'javascript:alert(1)' })} />);
    expect(screen.queryByRole('link', { name: /Careers|Jobs/ })).toBeNull();
});

test('choosing Edit careers links closes the Actions menu', async () => {
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit careers links…' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('company page has no visible Search a job button; Actions opens the modal and posts searchJob', async () => {
    wrap(<CompanyPanel company={company()} />);
    expect(screen.queryByRole('button', { name: 'Search a job' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Search a job…' }));
    await userEvent.type(await screen.findByLabelText('Role'), 'Staff Eng');
    await userEvent.type(screen.getByLabelText('Link to the posting'), 'https://x.example/j/1');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'searchJob', company: 'X Corp', role: 'Staff Eng', url: 'https://x.example/j/1' }]));
});

test('Search a job modal with an empty role shows an error and posts nothing', async () => {
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Search a job…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Role is required.');
    expect(posts).toEqual([]);
});

test('the company Actions menu lists its eight items in order', async () => {
    wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    const names = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
    expect(names).toEqual(['Add job by link…', 'Mark applied…', 'Search a job…', 'Look up company facts…', 'Ask a question…', 'Edit careers links…', 'Stop board sweep', 'Rule out company…']);
});

test('the sweep item posts setSweep directly and its label flips with sweepOff', async () => {
    const { unmount } = wrap(<CompanyPanel company={company()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop board sweep' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'setSweep', company: 'X Corp', off: true }]));
    expect(document.querySelector('.dialog')).toBeNull();
    unmount();
    wrap(<CompanyPanel company={company({ sweepOff: true })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    expect(await screen.findByRole('menuitem', { name: 'Resume board sweep' })).toBeInTheDocument();
});

test('Rule out opens one dialog that is the confirm: optional note, one click, one post', async () => {
    guardPosts = true;
    wrap(<CompanyPanel company={company()} />);
    await openMenuItem('Rule out company…');
    const dialog = await screen.findByRole('dialog', { name: 'Rule out X Corp' });
    await userEvent.type(within(dialog).getByLabelText('Why? (optional, saved to My notes)'), 'too small');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rule out company' }));
    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
    expect(posts).toEqual([{ type: 'setStance', company: 'X Corp', stance: 'Ruled out', ruleOutAsked: true, note: 'too small' }]);
});

test('Rule out company… on the job page needs no second confirm', async () => {
    guardPosts = true;
    wrap(<JobPanel company={company()} posting={posting()} />);
    await openMenuItem('Rule out company…');
    const dialog = await screen.findByRole('dialog', { name: 'Rule out X Corp' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rule out company' }));
    await waitFor(() => expect(posts.at(-1)).toMatchObject({ type: 'setStance', stance: 'Ruled out', ruleOutAsked: true }));
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
});

test('the stance and actions sit in the pinned line, before the facts and Where it stands', () => {
    wrap(<CompanyPanel company={company({ stance: 'Watching', verdict: 'Lead' })} />);
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const trigger = screen.getByRole('button', { name: 'Actions ▾' });
    expect(trigger.closest('.head-line')).toContainElement(screen.getByRole('button', { name: 'Watching ▾' }));
    expect(follows(trigger, screen.getByText('Culture'))).toBe(true);
    expect(follows(trigger, screen.getByRole('region', { name: 'Where it stands' }))).toBe(true);
});

test('the job pane has Job, Company, Ask and History tabs; Job is open first', async () => {
    const reasons = [{ state: 'skipped' as const, reason: 'Too much travel', at: '2026-11-16' }];
    const c = company({ domain: 'Payroll software', culture: 'Calm team', jobs: { p1: { state: 'skipped', role: 'Staff Engineer', leadKey: 'k', at: '2026-11-16', reasons } }, events: [{ date: '2026-11-15', text: 'Watching set' }] });
    wrap(<JobPanel company={c} posting={posting({ firstRun: '2026-11-12-daily', lastRun: '2026-11-12-daily' })} />);
    const list = screen.getByRole('tablist', { name: 'Job sections' });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Job', 'Company', 'Ask', expect.stringMatching(/^History \d+$/)]);
    expect(screen.getByRole('tab', { name: 'Job' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Company' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('What they do')).toBeInTheDocument();
    expect(within(panel).getByText('Calm team')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /History/ }));
    const items = within(screen.getByRole('tabpanel')).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Skipped: Too much travel.*2026-11-16/);
    expect(items[1]).toMatch(/Watching set.*2026-11-15/);
    expect(items.some((t) => /Found in run 2026-11-12-daily/.test(t))).toBe(true);
    expect(screen.getByRole('tab', { name: /History/ })).toHaveTextContent(`History ${items.length}`);
});

test('An applying job shows Mark applied and the kit status, not Apply or Save', async () => {
    const entry = { state: 'applying' as const, role: 'Staff Engineer', leadKey: 'k', at: '2026-11-22' };
    const co = company({ name: 'Acme', jobs: { pa1: entry } });
    wrap(<JobPanel company={co} posting={posting({ id: 'pa1', companyKey: 'x' })} />);
    expect(await screen.findByRole('link', { name: 'Open kit' })).toHaveAttribute('href', '/kits/acme-staff');
    expect(screen.getByRole('button', { name: 'Mark applied' })).toBeInTheDocument();
    for (const name of ['Apply', 'Save']) expect(screen.queryByRole('button', { name })).toBeNull();
});

test('An applying job with no kit offers Retry kit, which sends the kit again with applying', async () => {
    const co = company({ name: 'Acme', jobs: { p9: { state: 'applying', role: 'Staff Engineer', leadKey: 'k', at: '2026-11-22' } } });
    wrap(<JobPanel company={co} posting={posting({ id: 'p9' })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry kit' }));
    await waitFor(() => expect(posts).toEqual([{ type: 'kit', company: 'Acme', role: 'Staff Engineer', url: 'https://x.example/1', postingId: 'p9', pieces: 'resume', drafter: 'claude', applying: true }]));
});

const fuApp = (o = {}) => company({ applications: [{ id: 'a1', role: 'Staff Engineer', appliedOn: daysBefore(8), outcome: 'applied', ...o }] });
const inWeek = () => { const d = new Date(); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('Draft follow-up walks send-to, draft, sent', async () => {
    companies = [fuApp()];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft follow-up' }));
    await userEvent.type(await screen.findByLabelText('Send to (name or role)'), 'Dana');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([{ type: 'setSendTo', company: 'X Corp', applicationId: 'a1', sendTo: 'Dana' }]);
    expect(await screen.findByText(/Subject: Checking in/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Draft again' }));
    expect(posts[1]).toEqual({ type: 'followup', company: 'X Corp', applicationId: 'a1' });
    await userEvent.click(screen.getByRole('button', { name: 'I sent it' }));
    expect(posts[2]).toEqual({ type: 'setNextStep', company: 'X Corp', applicationId: 'a1', text: 'Followed up', on: inWeek() });
});

test('Draft follow-up shows Drafting while a followup run is active', async () => {
    status = [{ workflow: 'followup', title: 'followup X Corp | Staff Engineer', status: 'in_progress', startedAt: '2026-11-17T10:00:00Z', url: 'u' }];
    companies = [fuApp()];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft follow-up' }));
    expect(await screen.findByRole('button', { name: 'Drafting…' })).toBeDisabled();
});

test('Copy puts the draft on the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    companies = [fuApp()];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft follow-up' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Subject: Checking in\n\nHi Dana, still keen.');
});

test('A closed application has no Draft follow-up', async () => {
    companies = [fuApp({ outcome: 'rejected' })];
    wrap(<ApplicationsPage />, '/?show=closed');
    await screen.findByText('Staff Engineer');
    expect(screen.queryByRole('button', { name: 'Draft follow-up' })).toBeNull();
});

test('Follow-up: unchanged Save sends nothing, and Send to is prefilled', async () => {
    companies = [fuApp({ sendTo: 'Dana' })];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft follow-up' }));
    expect(await screen.findByLabelText('Send to (name or role)')).toHaveValue('Dana');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(posts).toEqual([]);
});

test('Follow-up: with no draft the button reads Draft it', async () => {
    companies = [fuApp({ role: 'Other Role' })];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft follow-up' }));
    expect(await screen.findByRole('button', { name: 'Draft it' })).toBeInTheDocument();
});

test('Follow-up: Copy toasts Copied. and I sent it toasts the date', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    companies = [fuApp()];
    wrap(<ApplicationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft follow-up' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I sent it' }));
    expect(await screen.findByText(`Next follow-up set for ${inWeek()}.`)).toBeInTheDocument();
});
