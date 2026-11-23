import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ACTIONS, isDirect, labelOf, type ActionDef, type Ctx } from '../actions';
import { ToastProvider } from '../toast';
import { ActionsMenu } from './Actions';
import { OpenAction } from './OpenAction';

const posts: Record<string, unknown>[] = [];
let release: () => void = () => {};
let hold: Promise<void> | null = null;
beforeEach(() => {
    posts.length = 0;
    hold = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/action') { posts.push(JSON.parse(String(init?.body))); if (hold) await hold; return new Response('{"ok":true}'); }
        if (url.includes('models.json')) return new Response('', { status: 404 });
        return new Response('{"runs":[]}');
    }));
});
const registrySize = ACTIONS.length;
afterEach(() => { vi.unstubAllGlobals(); ACTIONS.length = registrySize; });

const show = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const ctx: Ctx = { company: 'Acme' };
const synth = (o: Partial<ActionDef>): ActionDef => ({ id: 's', label: 'Synth', tip: 't', items: ['company'], params: [], submit: 'Go', body: () => ({ type: 's' }), done: () => 'ok', ...o });
const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));

test('labelOf and isDirect', () => {
    const d = synth({ label: (c) => (c.sweepOff ? 'Resume' : 'Stop'), params: [{ kind: 'text', name: 'a', label: 'A', show: (c) => Boolean(c.sweepOff) }] });
    expect(labelOf(d, ctx)).toBe('Stop');
    expect(labelOf(d, { ...ctx, sweepOff: true })).toBe('Resume');
    expect(labelOf(synth({}), ctx)).toBe('Synth');
    expect(isDirect(d, ctx)).toBe(true);
    expect(isDirect(d, { ...ctx, sweepOff: true })).toBe(false);
});

test('a function label shows per ctx, danger adds the class', async () => {
    ACTIONS.push(synth({ label: (c) => (c.sweepOff ? 'Resume' : 'Stop'), danger: true }));
    const { unmount } = show(<ActionsMenu item="company" ctx={ctx} />);
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Stop' })).toHaveClass('menu-item', 'danger');
    unmount();
    show(<ActionsMenu item="company" ctx={{ ...ctx, sweepOff: true }} />);
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Resume' })).toBeInTheDocument();
});

test('a direct action posts once without a dialog or onDone, even on a double click', async () => {
    ACTIONS.push(synth({}));
    const onDone = vi.fn();
    show(<ActionsMenu item="company" ctx={ctx} onDone={onDone} />);
    await openMenu();
    hold = new Promise((r) => { release = r; });
    const item = await screen.findByRole('menuitem', { name: 'Synth' });
    fireEvent.click(item);
    fireEvent.click(item);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(posts).toEqual([{ type: 's' }]);
    expect(onDone).not.toHaveBeenCalled();
});

test('last items render after the legacy children', async () => {
    ACTIONS.push(synth({ id: 'l', label: 'Last one', last: true }), synth({ id: 'f', label: 'First one' }));
    show(<ActionsMenu item="company" ctx={ctx}><button role="menuitem">Legacy</button></ActionsMenu>);
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Legacy' });
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent).slice(-4)).toEqual(['First one', 'Legacy', 'Rule out company…', 'Last one']);
});

test('focus returns to the trigger after Escape and after a modal closes', async () => {
    ACTIONS.push(synth({ params: [{ kind: 'text', name: 'a', label: 'A' }] }));
    show(<ActionsMenu item="company" ctx={ctx} />);
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Synth' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions ▾' })).toHaveFocus());
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Synth' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions ▾' })).toHaveFocus());
});

test('OpenAction posts a direct def on click and is disabled while sending', async () => {
    const d = synth({});
    show(<OpenAction def={d} ctx={ctx}>Do it</OpenAction>);
    hold = new Promise((r) => { release = r; });
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Do it' })).toBeDisabled());
    expect(screen.queryByRole('dialog')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Do it' })).toBeEnabled());
    expect(posts).toHaveLength(1);
});
