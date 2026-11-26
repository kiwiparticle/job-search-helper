import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { activeApplication, companyOf, jobEntry } from '../../lib/tags.js';
import { droppedFromSaved, jobsList, newQueue, savedGroups } from '../../lib/newQueue.js';
import { act, dataUrl, getJson, getText, NeedsConfirm } from './api';
import { cleanSchedule } from '../../lib/schedule.js';
import { companyKey } from '../../lib/keys.js';
import type { Company, HistoryLine, Job, KitMeta, NewItem, Posting, Report, RunSummary, SavedGroup, SupplementEntry, Unfiled } from './model';
import { useConfirm, useToast } from './toast';

const getApi = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
};

// The record endpoints send JSON Lines a page at a time; `x-next-after` names where the next page starts.
// Companies and postings also send `x-seq` on the first page: the write counter before any row was read.
async function getPages<T>(path: string): Promise<{ rows: T[]; seq: number | null }> {
    let text = '';
    let after: string | null = '';
    let seq: number | null = null;
    while (after !== null) {
        const url: string = after ? `${path}?after=${encodeURIComponent(after)}` : path;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        if (!after && res.headers.get('x-seq') != null) seq = Number(res.headers.get('x-seq'));
        text += await res.text();
        after = res.headers.get('x-next-after');
    }
    return { rows: text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)), seq };
}
const getLines = async <T,>(path: string): Promise<T[]> => (await getPages<T>(path)).rows;

// A cached table and the write counter it is current to (null: the server sent none, so every refetch is a full load).
type Table<T> = { rows: T[]; seq: number | null };

// Drops the deleted ids, swaps in the changed rows and keeps key order like the server sends it.
function mergeRows<T>(list: T[], idField: string, deleted: string[], rows: T[]): T[] {
    const byId = new Map(list.map((r) => [String((r as Record<string, unknown>)[idField]), r]));
    for (const id of deleted) byId.delete(id);
    for (const r of rows) byId.set(String((r as Record<string, unknown>)[idField]), r);
    return [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
}

// With a cached copy, asks only for rows written since its seq; the first load, or too many changes, reloads it all.
async function loadTable<T>(table: string, idField: string, prev: Table<T> | undefined): Promise<Table<T>> {
    if (prev?.seq != null) {
        const url = `/api/${table}?since=${prev.seq}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        const d: { full?: true; seq: number; deleted: string[]; rows: T[] } = await res.json();
        if (!d.full) return { seq: d.seq, rows: mergeRows(prev.rows, idField, d.deleted, d.rows) };
    }
    return getPages<T>(`/api/${table}`);
}

function rowsOf<T>(t: Table<T>): T[] {
    return t.rows;
}

function useTable<T>(table: string, idField: string) {
    const client = useQueryClient();
    return useQuery({ queryKey: [table], queryFn: () => loadTable<T>(table, idField, client.getQueryData<Table<T>>([table])), select: rowsOf<T> });
}

export const useCompanies = () => useTable<Company>('companies', 'key');

export const usePostings = () => useTable<Posting>('postings', 'id');

export const useSupplement = () => useQuery({ queryKey: ['supplement'], queryFn: () => getLines<SupplementEntry>('/api/supplement') });

// Search rule changes the weekly tune run proposed (lib/tune.js), still waiting or in flight.
export type TuneProposal = { id: string; file: string; find: string; replace: string; why: string; at: string; status: 'open' | 'applying' | 'applied' | 'dismissed' | 'stale'; error?: string };
export const useTune = () => useQuery({
    queryKey: ['tune'],
    queryFn: async () => (await getLines<TuneProposal>('/api/tune')).filter((p) => ['open', 'applying', 'stale'].includes(p.status)),
});

export const useHistory = (companyKey: string) =>
    useQuery({ queryKey: ['history', companyKey], queryFn: () => getLines<HistoryLine>(`/api/history?company=${encodeURIComponent(companyKey)}`) });

// A fresh install has no runs/index.json until its first run: a 404 is just "no runs".
export const useRuns = () =>
    useQuery({
        queryKey: ['runs'],
        queryFn: async (): Promise<RunSummary[]> => {
            const res = await fetch(dataUrl('runs/index.json'));
            if (res.status === 404) return [];
            if (!res.ok) throw new Error(`runs/index.json: ${res.status}`);
            return res.json();
        },
    });

export const useReport = (run: string | undefined) =>
    useQuery({ queryKey: ['report', run], queryFn: () => getJson<Report>(`runs/${run}/report.json`), enabled: Boolean(run) });

// Lines the migration could not file under a company. The file doesn't exist before cutover: that is just "nothing".
export const useUnfiled = () =>
    useQuery({
        queryKey: ['unfiled'],
        queryFn: async (): Promise<Unfiled[]> => {
            const res = await fetch(dataUrl('data/unfiled-history.jsonl'));
            if (!res.ok) return [];
            return (await res.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
        },
    });

// The verticals the Searches panel offers. The owner edits data/verticals.json; a missing file just means no list.
export const useVerticals = () =>
    useQuery({ queryKey: ['verticals'], queryFn: () => getJson<{ name: string; group: string }[]>('data/verticals.json').catch(() => []) });

// The owner's one-tap reasons for Skip, Save and Rule out (data/reasons.json). A missing file means no chips, just the buttons.
export type Reasons = { skip: string[]; save: string[]; ruleOut: string[] };
const NO_REASONS: Reasons = { skip: [], save: [], ruleOut: [] };
export const useReasons = (): Reasons =>
    useQuery({ queryKey: ['reasons'], queryFn: () => getJson<Partial<Reasons>>('data/reasons.json').then(
        (r) => ({ skip: Array.isArray(r?.skip) ? r.skip : [], save: Array.isArray(r?.save) ? r.save : [], ruleOut: Array.isArray(r?.ruleOut) ? r.ruleOut : [] }),
        () => NO_REASONS,
    ), staleTime: Infinity }).data ?? NO_REASONS;

// The owner's pay floor from data/profile.json, in dollars. Null when unset, missing or not USD (the page compares only US dollars).
export const useFloor = (): number | null =>
    useQuery({ queryKey: ['profile'], queryFn: () => getJson<{ payFloor?: unknown; currency?: string }>('data/profile.json').then(
        (p) => (typeof p?.payFloor === 'number' && (p.currency ?? 'USD') === 'USD' ? p.payFloor : null),
        () => null,
    ), staleTime: Infinity }).data ?? null;

// Which runs start on their own (data/schedule.json, UTC). Missing file: none do.
export type Schedule = Record<string, { days: number[] | null; hours: number[] }>;
export const useSchedule = (): Schedule =>
    useQuery({ queryKey: ['schedule'], queryFn: () => getJson<Schedule>('data/schedule.json').then(cleanSchedule, () => ({})), staleTime: Infinity }).data ?? {};

export const useThread = (company: string) =>
    useQuery({ queryKey: ['thread', company], queryFn: () => getApi<{ messages: unknown[] }>(`/api/thread?company=${encodeURIComponent(company)}`) });

type Written = { table: string; id: string; record: Record<string, unknown> | null };

// Swaps the rows an action wrote into the cached table. Its seq stays, so the next refetch gets them once more: harmless.
function patchList<T>(client: QueryClient, table: string, idField: string, written: Written[]) {
    const rows = written.filter((w) => w.table === table);
    if (!rows.length) return;
    client.setQueryData<Table<T>>([table], (t) => t && {
        ...t,
        rows: mergeRows(t.rows, idField, rows.filter((w) => !w.record).map((w) => w.id), rows.flatMap((w) => (w.record ? [w.record as T] : []))),
    });
}

// Returns a function that sends one owner action, toasts the outcome and refreshes the record lists.
// A guard that wants a yes (409 needsConfirm) asks in a confirm dialog, then resends once with confirmed: true.
export function useAct() {
    const toast = useToast();
    const ask = useConfirm();
    const client = useQueryClient();
    const mutation = useMutation({
        mutationFn: async ({ body }: { body: Record<string, unknown>; done: string }) => {
            try {
                return await act(body);
            } catch (e) {
                if (!(e instanceof NeedsConfirm)) throw e;
                if (!(await ask(e.message))) return null;
                return act({ ...body, confirmed: true });
            }
        },
        onSuccess: (out, { done }) => {
            if (out === null) return; // declined: nothing was sent
            toast(done);
            // A dispatched run can take 10s or more to show on GitHub, and polling stops while the list is empty,
            // so look again a few times. A run that never shows is just not a run (most actions don't start one).
            for (const sec of [4, 10, 20, 40]) window.setTimeout(() => client.invalidateQueries({ queryKey: ['status'] }), sec * 1000);
            // The reply lists the company and posting rows the action wrote: patch those into the lists (null = deleted).
            // An older backend sends none, so the lists reload as before.
            const written = (out as { written?: Written[] }).written;
            if (written) {
                patchList<Company>(client, 'companies', 'key', written);
                patchList<Posting>(client, 'postings', 'id', written);
            }
            return Promise.all([...(written ? [] : [client.invalidateQueries({ queryKey: ['companies'] }), client.invalidateQueries({ queryKey: ['postings'] })]), client.invalidateQueries({ queryKey: ['supplement'] }), client.invalidateQueries({ queryKey: ['tune'] }), client.invalidateQueries({ queryKey: ['status'] })]);
        },
        // A refused action usually means the page was out of date (404 no such held change, 409 stale): reload so it shows the real state.
        onError: (e) => { toast((e as Error).message); client.invalidateQueries({ queryKey: ['companies'] }); client.invalidateQueries({ queryKey: ['postings'] }); },
    });
    const { mutateAsync } = mutation;
    // true on success, false on failure or a declined confirm, so callers can close a form only when it worked.
    return useCallback(
        (body: Record<string, unknown>, done: string) => mutateAsync({ body, done }).then((out) => out !== null, () => false),
        [mutateAsync],
    );
}

// The kits listing (applications/*/meta.json). A kit made from a posting carries its postingId.
export const useKits = () =>
    useQuery({
        queryKey: ['kits'],
        queryFn: async () => {
            const dirs = (await getJson<{ name: string; type: string }[]>('applications').catch(() => [])).filter((x) => x.type === 'dir');
            return Promise.all(dirs.map(async (d) => ({ name: d.name, meta: await getJson<KitMeta>(`applications/${d.name}/meta.json`).catch((): KitMeta => ({})) })));
        },
    });

// The newest follow-up draft for one application (followups/<company key>-<role slug>/followup-N.md), or null.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// followups/<kit folder name>-<last 12 of the application id's slug>: one folder per application (followup.yml builds the same).
export const followUpName = (company: string, role: string, applicationId: string) => `${companyKey(company)}-${slug(role)}-${slug(applicationId).slice(-12)}`;
export const useFollowUp = (company: string, role: string, applicationId: string, enabled = true) => {
    const name = followUpName(company, role, applicationId);
    return useQuery({
        queryKey: ['followup', name],
        enabled,
        queryFn: async () => {
            const nums = (await getJson<{ name: string }[]>(`followups/${name}`).catch(() => [])).flatMap((f) => /^followup-(\d+)\.md$/.exec(f.name)?.[1] ?? []).map(Number);
            return nums.length ? getText(`followups/${name}/followup-${Math.max(...nums)}.md`) : null;
        },
    });
};

// The New queue and the Jobs list are derived from the records, never stored.
export function useNewQueue(): { items: NewItem[]; isPending: boolean; isError: boolean } {
    const companies = useCompanies();
    const postings = usePostings();
    const items = newQueue(companies.data ?? [], postings.data ?? []) as NewItem[]; // lib JS infers kind as string
    return { items, isPending: companies.isPending || postings.isPending, isError: companies.isError || postings.isError };
}

// Saved jobs by company, shown last on New. Not part of the queue, so the nav count ignores them.
export function useSavedGroups(): { groups: SavedGroup[]; isPending: boolean; isError: boolean } {
    const companies = useCompanies();
    const postings = usePostings();
    const groups = useMemo(() => savedGroups(companies.data ?? [], postings.data ?? []) as SavedGroup[], [companies.data, postings.data]);
    return { groups, isPending: companies.isPending || postings.isPending, isError: companies.isError || postings.isError };
}

export function useJobs(): { rows: Job[]; isPending: boolean; isError: boolean } {
    const companies = useCompanies();
    const postings = usePostings();
    const rows = jobsList(companies.data ?? [], postings.data ?? []) as Job[];
    return { rows, isPending: companies.isPending || postings.isPending, isError: companies.isError || postings.isError };
}

// Models said no to these. Nothing here is hidden for good: Save or Review overrides the call.
const NO_VERDICT = /^(skip|near miss|pass|role-level pass)/i;

// Unread passes: jobs and companies. The Passed page lists them and the nav counts them.
// Roles the owner's sweep filter or title triage passed on are kept apart in `filtered` and not counted.
export function usePassed() {
    const { data: companies = [], isPending: p1, isError: e1 } = useCompanies();
    const { data: postings = [], isPending: p2, isError: e2 } = usePostings();
    const all = postings
        .flatMap((p) => {
            const company = companyOf(companies, p) as Company | undefined;
            if (!company || p.modelSays !== 'pass' || p.posted === 'no' || company.stance === 'Ruled out' || activeApplication(company) || jobEntry(company, p)) return [];
            return [{ p, company }];
        })
        .sort((a, b) => b.p.firstRun.localeCompare(a.p.firstRun));
    const isFiltered = (p: Posting) => p.filteredBy != null || p.triage?.keep === false;
    const jobs = all.filter(({ p }) => !isFiltered(p));
    const filtered = all.filter(({ p }) => isFiltered(p));
    // Suggested rule-outs first: they wait for the owner's yes or no.
    const suggested = (c: Company) => Boolean(c.ruleOutSuggested) && c.stance !== 'Ruled out';
    const dismissed = companies
        .filter((c) => suggested(c) || (c.stance !== 'Ruled out' && c.stance !== 'To review' && !activeApplication(c) && NO_VERDICT.test(c.verdict) && c.passedSeen !== c.verdict))
        .sort((a, b) => Number(suggested(b)) - Number(suggested(a)) || a.name.localeCompare(b.name));
    const byKey = new Map(companies.map((c) => [c.key, c]));
    const dropped = (droppedFromSaved(companies) as { key: string; company: string; postingId: string; role: string; url?: string; leadKey: string; fromSaved: string; reasons: { state: string; reason: string; at: string }[] }[])
        .map((d) => ({ ...d, co: byKey.get(d.key) as Company }));
    return { jobs, filtered, dropped, dismissed, postings, isPending: p1 || p2, isError: e1 || e2 };
}

export type ActiveRun = { workflow: string; title?: string; status: string; step?: string | null; startedAt?: string; url?: string };

// What is running on GitHub right now. Polls every 20s while anything is; an action refreshes it
// (four times, because GitHub takes a moment to list a new run), and finished work reloads the data.
export function useActiveRuns(): ActiveRun[] {
    const client = useQueryClient();
    const { data = [] } = useQuery({
        queryKey: ['status'],
        queryFn: async () => (await getApi<{ runs: ActiveRun[] }>('/api/status')).runs ?? [],
        refetchInterval: (q) => (q.state.data?.length ? 20000 : false),
    });
    // Any run that left the list finished: reload what it may have written, kits included.
    const ids = data.map((r) => r.url ?? `${r.workflow} ${r.title ?? ''}`).join('\n');
    const was = useRef('');
    useEffect(() => {
        const now = new Set(ids.split('\n'));
        if (was.current && was.current.split('\n').some((id) => !now.has(id))) for (const queryKey of [['companies'], ['postings'], ['kits']]) client.invalidateQueries({ queryKey });
        was.current = ids;
    }, [ids, client]);
    return data;
}

// Plain words for a run's title (see the run-name lines in the workflows). Null for runs that aren't about one company.
export function describeRun(title = ''): { what: string; company: string; role?: string } | null {
    const [company, role] = title.replace(/^\w+ /, '').split(' | ');
    const what = title.startsWith('ask ') ? 'Answering a question' : title.startsWith('fill ') ? 'Looking up facts'
        : title.startsWith('job ') ? 'Searching a job' : title.startsWith('kit ') ? 'Building a kit'
        : title.startsWith('review ') ? 'Reviewing a kit' : title.startsWith('revise ') ? 'Revising a resume'
        : title.startsWith('piece ') ? 'Writing kit pieces'
        : title.startsWith('followup ') ? 'Drafting a follow-up' : null;
    return what ? { what, company, role } : null;
}

// Short labels for what is running on one company (and one role, when given). Empty when nothing is.
export function useWorking(company: string, role?: string, strict?: boolean): string[] {
    return useActiveRuns().flatMap((r) => {
        const d = describeRun(r.title);
        if (!d || d.company.toLowerCase() !== company.toLowerCase()) return [];
        if (strict && role && !d.role) return [];
        if (role && d.role && d.role.toLowerCase() !== role.toLowerCase()) return [];
        return [d.what + (r.status === 'queued' ? ' (waiting for your PC)' : '')];
    });
}

export type ActivityRun = { id: number; workflow: string; title?: string; status: string; conclusion: string | null; createdAt: string; startedAt?: string; updatedAt: string; url: string; summary?: string };

// Recent runs, every state. Polls every 20s by default; the bar's Status link asks every 5 minutes.
// Observers share the query, so the shortest interval mounted wins.
export const useActivity = (interval = 20000) =>
    useQuery({
        queryKey: ['activity'],
        queryFn: async () => (await getApi<{ runs: ActivityRun[] }>('/api/activity')).runs,
        refetchInterval: interval,
    });

// The page's GitHub token (status and expiry). Checked hourly; a failed check shows nothing.
export const useToken = () =>
    useQuery({ queryKey: ['token'], queryFn: () => getApi<{ status: number; expires: string | null }>('/api/token'), refetchInterval: 3600000, retry: false });

// The posting check runs for every company at once, so a "Check" button anywhere waits on it.
export const useChecking = () => useActiveRuns().some((r) => r.workflow === 'check-postings');
