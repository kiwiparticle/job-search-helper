import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ActionDef } from '../actions';
import { ToastProvider } from '../toast';
import { OpenAction } from './OpenAction';
import { ReviewJobButton } from './ReviewJobButton';

let runs: { title: string; status: string }[] = [];
beforeEach(() => {
    runs = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url === '/api/status' ? JSON.stringify({ runs }) : '{}', { status: url.includes('models.json') ? 404 : 200 })));
});
afterEach(() => vi.unstubAllGlobals());
let client: QueryClient;
const show = (ui: React.ReactNode) => render(<QueryClientProvider client={(client = new QueryClient())}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const def: ActionDef = { id: 'x', label: 'Thing…', tip: 't', items: ['company'], params: [], submit: 'Go', disabled: (w) => w.length > 0, body: () => ({}), done: () => 'ok' };
const ctx = { company: 'Acme', role: 'Staff' };

test('swapping between a def with and without disabled keeps hooks stable', () => {
    const plain: ActionDef = { ...def, disabled: undefined };
    const { rerender } = show(<OpenAction def={plain} ctx={ctx}>Open</OpenAction>);
    const wrap = (d: ActionDef) => <QueryClientProvider client={new QueryClient()}><ToastProvider><OpenAction def={d} ctx={ctx}>Open</OpenAction></ToastProvider></QueryClientProvider>;
    expect(() => { rerender(wrap(def)); rerender(wrap(plain)); }).not.toThrow();
});

test('clicking opens the modal', async () => {
    show(<OpenAction def={def} ctx={ctx}>Open</OpenAction>);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('disabled while a run for this role is active, showing busyText', async () => {
    runs = [{ title: 'job Acme | Staff', status: 'in_progress' }];
    show(<OpenAction def={def} ctx={ctx} busyText="Working…">Open</OpenAction>);
    expect(await screen.findByRole('button', { name: 'Working…' })).toBeDisabled();
});

test('a company-level run does not disable it', async () => {
    runs = [{ title: 'ask Acme', status: 'in_progress' }];
    show(<OpenAction def={def} ctx={ctx} busyText="Working…">Open</OpenAction>);
    await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
});

test('ReviewJobButton shows Reviewing… for its job run only', async () => {
    runs = [{ title: 'ask X Corp', status: 'in_progress' }];
    const { unmount } = show(<ReviewJobButton company="X Corp" role="Staff" url="https://x/1" />);
    await waitFor(() => expect(client.getQueryData(['status'])).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled();
    unmount();
    runs = [{ title: 'job X Corp | Staff', status: 'in_progress' }];
    show(<ReviewJobButton company="X Corp" role="Staff" url="https://x/1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reviewing…' })).toBeDisabled());
});
