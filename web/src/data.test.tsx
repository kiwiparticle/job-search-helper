import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAct, useCompanies, useNewQueue, usePostings, useRuns, useWorking } from './data';
import type { Company } from './model';
import { company, lines } from './test-fixtures';
import { ToastProvider } from './toast';

const rec = (name: string, extra: Partial<Company> = {}) => company({ key: name.toLowerCase(), name, ...extra });
const proposal = { id: 'q1', by: 'claude', at: '2026-11-16', text: 'hi', base: {}, changes: {} };

let companies: Company[];
let calls: string[];
let actReplies: Response[];
let companiesStatus: number;
let runs: { title: string; status: string }[] = [];
beforeEach(() => {
    companies = [rec('Acme', { stance: '' }), rec('Bolt', { proposals: [proposal] })];
    calls = [];
    actReplies = [];
    companiesStatus = 200;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url === '/api/action' ? `${url} ${init?.body}` : url);
        if (url === '/api/companies') return new Response(lines(companies), { status: companiesStatus });
        if (url === '/api/postings') return new Response('');
        if (url === '/api/status') return new Response(JSON.stringify({ runs }));
        if (url.includes('runs%2Findex.json')) return new Response(JSON.stringify([{ run: '2026-11-15-search' }]));
        if (url === '/api/action') return actReplies.shift() ?? new Response('{"ok":true}');
        return new Response('{}', { status: 404 });
    }));
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
);
const count = (url: string) => calls.filter((c) => c === url).length;

describe('data hooks', () => {
    test('useRuns reads a missing runs/index.json as no runs', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
        const { result } = renderHook(() => useRuns(), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });
    test('useNewQueue derives proposal items from companies and postings', async () => {
        const { result } = renderHook(() => useNewQueue(), { wrapper });
        expect(result.current.isPending).toBe(true);
        await waitFor(() => expect(result.current.isPending).toBe(false));
        expect(result.current.items.map((i) => i.kind)).toEqual(['proposal']);
    });

    test('useNewQueue reports an error when companies fail to load', async () => {
        companiesStatus = 500;
        const { result } = renderHook(() => useNewQueue(), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
    });

    test('useCompanies follows x-next-after and returns every record', async () => {
        const [a, b] = companies;
        vi.mocked(fetch).mockImplementation(async (url) => (String(url) === '/api/companies?after=acme'
            ? new Response(lines([b]))
            : new Response(lines([a]), { headers: { 'x-next-after': 'acme' } })));
        const { result } = renderHook(() => useCompanies(), { wrapper });
        await waitFor(() => expect(result.current.data?.map((c) => c.name)).toEqual(['Acme', 'Bolt']));
    });

    test('a refetch asks only for what changed since the seq of the last load', async () => {
        const [a, b] = companies;
        vi.mocked(fetch).mockImplementation(async (url) => {
            calls.push(String(url));
            return String(url) === '/api/companies?since=5'
                ? new Response(JSON.stringify({ seq: 7, deleted: ['bolt'], rows: [{ ...a, name: 'Acme Inc' }, rec('Cog')] }))
                : new Response(lines([a, b]), { headers: { 'x-seq': '5' } });
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result } = renderHook(() => useCompanies(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
        await waitFor(() => expect(result.current.data?.map((c) => c.name)).toEqual(['Acme', 'Bolt']));
        await act(() => client.invalidateQueries({ queryKey: ['companies'] }));
        await waitFor(() => expect(result.current.data?.map((c) => c.name)).toEqual(['Acme Inc', 'Cog']));
        expect(calls.filter((c) => c.startsWith('/api/companies'))).toEqual(['/api/companies', '/api/companies?since=5']);
    });

    test('a failing second page puts the query in its error state', async () => {
        vi.mocked(fetch).mockImplementation(async (url) => (String(url) === '/api/companies?after=acme'
            ? new Response('', { status: 500 })
            : new Response(lines([companies[0]]), { headers: { 'x-next-after': 'acme' } })));
        const { result } = renderHook(() => useCompanies(), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.data).toBeUndefined();
    });

    test('useAct refetches companies and postings once after success', async () => {
        const { result } = renderHook(() => ({ list: useCompanies(), jobs: usePostings(), act: useAct() }), { wrapper });
        await waitFor(() => expect(result.current.list.data).toHaveLength(2));
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.act({ type: 'x' }, 'Done'); });
        expect(ok).toBe(true);
        await waitFor(() => expect(count('/api/companies')).toBe(2));
        await waitFor(() => expect(count('/api/postings')).toBe(2));
    });

    test('useAct patches the rows the reply carries instead of reloading', async () => {
        actReplies = [new Response(JSON.stringify({ ok: true, written: [
            { table: 'companies', id: 'acme', record: { ...companies[0], stance: 'Dormant' } },
            { table: 'companies', id: 'bolt', record: null },
        ] }))];
        const { result } = renderHook(() => ({ list: useCompanies(), act: useAct() }), { wrapper });
        await waitFor(() => expect(result.current.list.data).toHaveLength(2));
        await act(async () => { await result.current.act({ type: 'x' }, 'Done'); });
        await waitFor(() => expect(result.current.list.data?.map((c) => [c.name, c.stance])).toEqual([['Acme', 'Dormant']]));
        expect(count('/api/companies')).toBe(1);
    });

    test('useAct swallows a failure into a toast and reloads the lists', async () => {
        actReplies = [new Response('{"error":"nope"}', { status: 500 })];
        const { result } = renderHook(() => ({ list: useCompanies(), act: useAct() }), { wrapper });
        await waitFor(() => expect(result.current.list.data).toHaveLength(2));
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.act({ type: 'x' }, 'Done'); });
        expect(ok).toBe(false);
        await waitFor(() => expect(count('/api/companies')).toBe(2));
    });

    describe('a guard that needs a yes', () => {
        const guard = () => new Response(JSON.stringify({ error: 'You applied for X on 2026-11-01. Go ahead?', needsConfirm: true }), { status: 409 });
        const sent = () => calls.filter((c) => c.startsWith('/api/action')).map((c) => JSON.parse(c.slice('/api/action '.length)));

        test('accepting resends with confirmed: true', async () => {
            actReplies = [guard()];
            const { result } = renderHook(() => useAct(), { wrapper });
            let ok: boolean | undefined;
            await act(async () => {
                const sending = result.current({ type: 'markApplied', company: 'X' }, 'Done');
                await userEvent.click(await screen.findByRole('button', { name: 'Yes' }));
                ok = await sending;
            });
            expect(screen.queryByText('You applied for X on 2026-11-01. Go ahead?')).toBeNull();
            expect(ok).toBe(true);
            expect(sent()).toEqual([{ type: 'markApplied', company: 'X' }, { type: 'markApplied', company: 'X', confirmed: true }]);
        });

        test('declining resolves false and sends nothing more', async () => {
            actReplies = [guard()];
            const { result } = renderHook(() => useAct(), { wrapper });
            let ok: boolean | undefined;
            await act(async () => {
                const sending = result.current({ type: 'markApplied', company: 'X' }, 'Done');
                await userEvent.click(await screen.findByRole('button', { name: 'No' }));
                ok = await sending;
            });
            expect(ok).toBe(false);
            expect(sent()).toEqual([{ type: 'markApplied', company: 'X' }]);
        });
    });
});

describe('useWorking', () => {
    test('strict ignores runs that carry no role', async () => {
        runs = [{ title: 'ask Acme', status: 'in_progress' }, { title: 'job Acme | Staff', status: 'in_progress' }];
        const loose = renderHook(() => useWorking('Acme', 'Staff'), { wrapper });
        const strict = renderHook(() => useWorking('Acme', 'Staff', true), { wrapper });
        await waitFor(() => expect(loose.result.current).toHaveLength(2));
        expect(strict.result.current).toEqual(['Searching a job']);
        runs = [];
    });
});
