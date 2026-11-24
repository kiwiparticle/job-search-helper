import { Autocomplete } from '@base-ui/react/autocomplete';
import { Menu } from '@base-ui/react/menu';
import { ModelsDialog } from './ModelsDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useActiveRuns, useActivity, useCompanies, useToken, useJobs, useNewQueue, usePassed, usePostings, useRuns } from '../data';
import { pageTitle } from '../pageTitle';
import { searchAll } from '../search';
import { STATUS_SEEN_KEY, statusState, tokenNotice } from '../status';
import { useToast } from '../toast';
import { SearchesPanel } from './SearchesPanel';
import { StatusBar } from './StatusBar';
import { Kind } from './Tags';
import { Popup } from './ui';

type Hit = { key: string; to: string; about?: 'company' | 'job'; label: string; extra: string };
type HitGroup = { value: string; items: Hit[] };

const GO_TO = [['Status', '/status'], ['Directed', '/directed'], ['Runs', '/runs'], ['Kits', '/kits'], ['Master', '/master']];

// Search over companies, jobs and the pages behind More: Base UI Autocomplete, inline in the dialog.
// Arrow keys move the highlight, Enter opens it.
function SearchBox({ go }: { go: (to: string) => void }) {
    const { data: companies = [] } = useCompanies();
    const { data: postings = [] } = usePostings();
    const [q, setQ] = useState('');
    const found = searchAll(companies, postings, q);
    const needle = q.trim().toLowerCase();
    const groups: HitGroup[] = [
        { value: 'Companies', items: found.companies.map((c) => ({ key: `c-${c.key}`, to: `/companies/${c.key}`, about: 'company' as const, label: c.name, extra: c.stance })) },
        { value: 'Jobs', items: found.jobs.map(({ company, posting }) => ({ key: `j-${posting.id}`, to: `/jobs/${posting.id}`, about: 'job' as const, label: posting.role, extra: company.name })) },
        { value: 'Go to', items: needle ? GO_TO.filter(([label]) => label.toLowerCase().includes(needle)).map(([label, to]) => ({ key: `g-${to}`, to, label, extra: '' })) : [] },
    ].filter((g) => g.items.length);
    return (
        <Autocomplete.Root inline open items={groups} value={q} onValueChange={(v, d) => { if (d.reason !== 'item-press') setQ(v); }} filter={null} autoHighlight itemToStringValue={(h: Hit) => h.label}>
            <Autocomplete.Input type="search" className="search-input" placeholder="Search companies and jobs" aria-label="Search companies and jobs" />
            {needle && <Autocomplete.Empty><p className="muted small" style={{ margin: 8 }}>No matches</p></Autocomplete.Empty>}
            <Autocomplete.List className="results">
                {(g: HitGroup) => (
                    <Autocomplete.Group key={g.value} items={g.items}>
                        <Autocomplete.GroupLabel className="results-group">{g.value}</Autocomplete.GroupLabel>
                        <Autocomplete.Collection>
                            {(h: Hit) => (
                                <Autocomplete.Item key={h.key} value={h} className="menu-item result-item" onClick={() => go(h.to)}>
                                    <span>{h.about && <><Kind about={h.about} /> </>}{h.label}</span><span className="muted small">{h.extra}</span>
                                </Autocomplete.Item>
                            )}
                        </Autocomplete.Collection>
                    </Autocomplete.Group>
                )}
            </Autocomplete.List>
        </Autocomplete.Root>
    );
}

// The bar's Search button. It, `/` (outside a text field) or Ctrl/⌘-K opens the search dialog, unless another dialog is open.
function Search() {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement;
            const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
            // Another dialog is open: leave the keys to it. Toasts are dialogs too, but non-modal ones.
            if (document.querySelector('[role="dialog"][data-open]:not([aria-modal="false"])')) return;
            if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                setOpen(true);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    return (
        <>
            <button type="button" className="search-btn" aria-label="Search" onClick={() => setOpen(true)}><svg className="search-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg><span className="search-word">Search</span><kbd>/</kbd></button>
            <Popup open={open} onOpenChange={setOpen} title="Search" hideTitle className="search-dialog">
                <SearchBox go={(to) => { setOpen(false); navigate(to); }} />
            </Popup>
        </>
    );
}

function seenAt() {
    try { return localStorage.getItem(STATUS_SEEN_KEY); } catch { return null; }
}

// Status: an amber dot while runs go, a red one for failures from the last day not yet seen on the Status page.
function StatusLink() {
    const active = useActiveRuns();
    const { data: activity } = useActivity(300000);
    const { data: runs } = useRuns();
    const onStatus = useLocation().pathname === '/status';
    const s = statusState(active, activity, onStatus ? new Date().toISOString() : seenAt(), runs);
    const words = `${s.count} ${s.kind}`;
    return (
        <NavLink to="/status" className="bar-link">
            {s.kind !== 'idle' && <span className={`bar-dot bar-dot-${s.kind}`} role="img" aria-label={words} />}
            Status
            {s.kind !== 'idle' && <span className="muted bar-count">{words}</span>}
        </NavLink>
    );
}

// A line under the bar when the page's GitHub token has expired, can't reach the repo, or expires within 14 days.
function TokenNotice() {
    const n = tokenNotice(useToken().data);
    return n && <div role="status" className={`token-notice token-notice-${n.level}`}>{n.text}</div>;
}

// The shell around every page: title, nav with counts, search, Status, More and Searches.
export function AppShell() {
    const { data: companies = [] } = useCompanies();
    const { items: queue } = useNewQueue();
    const { rows: jobRows } = useJobs();
    const passed = usePassed();
    const counts = {
        jobs: jobRows.length,
        applications: companies.filter((c) => c.applications.length).length,
        companies: companies.filter((c) => c.stance).length,
    };
    const more = useRef<HTMLButtonElement>(null);
    const [searchesOpen, setSearchesOpen] = useState(false);
    const [modelsOpen, setModelsOpen] = useState(false);
    const [via, setVia] = useState<'bar' | 'more'>('bar'); // which control opened the Searches panel; kept after close so focus returns there
    const client = useQueryClient();
    const toast = useToast();
    const [poke, setPoke] = useState(0);
    // Tab title follows the page. Kit pages set their own, so this leaves them alone.
    const { pathname } = useLocation();
    const { data: allPostings = [] } = usePostings();
    const title = pageTitle(pathname, { newCount: queue.length, companies, postings: allPostings });
    useEffect(() => { if (title) document.title = title; }, [title]);
    const tab = (to: string, label: string, n: number, hot = false) => (
        <NavLink to={to}>{label}<span className={hot && n > 0 ? 'n hot' : 'n'}>{n}</span></NavLink>
    );
    return (
        <>
            <header className="bar">
                <div className="bar-in">
                    <NavLink to="/new" className="brand">Job search</NavLink>
                    <nav className="nav" aria-label="Main">
                        {tab('/new', 'New', queue.length, true)}
                        {tab('/jobs', 'Jobs', counts.jobs)}
                        {tab('/applications', 'Applications', counts.applications)}
                        {tab('/companies', 'Companies', counts.companies)}
                        {tab('/passed', 'Passed', passed.jobs.length + passed.dismissed.length)}
                    </nav>
                    <span className="bar-gap" />
                    <Search />
                    <StatusLink />
                    <Menu.Root>
                        <Menu.Trigger ref={more} className="menu-trigger">More ▾</Menu.Trigger>
                        <Menu.Portal>
                            <Menu.Positioner className="pop-pos" sideOffset={6} align="end">
                                <Menu.Popup className="menu">
                                    {GO_TO.slice(1).map(([label, to]) => <Menu.Item key={to} className="menu-item" render={<Link to={to} />}>{label}</Menu.Item>)}
                                    <Menu.Item className="menu-item more-searches" onClick={() => { setVia('more'); setSearchesOpen(true); }}>Searches…</Menu.Item>
                                    <Menu.Item className="menu-item" onClick={() => setModelsOpen(true)}>Models…</Menu.Item>
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>
                    <ModelsDialog open={modelsOpen} onOpenChange={setModelsOpen} />
                    <SearchesPanel
                        open={searchesOpen} setOpen={(o) => { if (o) setVia('bar'); setSearchesOpen(o); }} anchor={via === 'more' ? more : undefined}
                        onStarted={() => setTimeout(() => setPoke((x) => x + 1), 4000)}
                    />
                    <StatusBar
                        poke={poke}
                        onDone={() => { toast('Run finished. Showing the newest results.'); client.invalidateQueries(); }}
                    />
                </div>
            </header>
            <TokenNotice />
            <main className="shell"><Outlet /></main>
            <ScrollRestoration />
        </>
    );
}
