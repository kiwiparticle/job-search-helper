import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../toast';
import { SettingsPage, tryTitle } from './SettingsPage';
import { shown } from '../../../lib/settings.js';
import { QA_ROLE, QA_ROLE_NOT } from '../../../lib/titleWords.js';

const posts: Record<string, unknown>[] = [];
beforeEach(() => {
    posts.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response('{"ok":true}'); }
        if (url.includes('reasons.json')) return new Response('{"skip":["Pay too low"],"save":[]}');
        if (url.includes('sweep-filter.json')) return new Response('{"version":2,"titleMustNot":["SDET"]}');
        if (url.includes('profile.json')) return new Response('{"who":"A tester","payFloor":120000}');
        return new Response('[]');
    }));
});
afterEach(() => vi.unstubAllGlobals());

test('Reasons: add one and save sends the tab, what was shown, and the new lists', async () => {
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ToastProvider><MemoryRouter><SettingsPage /></MemoryRouter></ToastProvider>
        </QueryClientProvider>,
    );
    const box = await screen.findByLabelText('Add to Skip a job');
    expect(screen.getByRole('button', { name: 'Save reasons' })).toBeDisabled();
    await userEvent.type(box, 'Contract only{Enter}');
    expect(screen.getByText('Changes not saved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save reasons' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
        type: 'setSettings', tab: 'reasons',
        before: { skip: ['Pay too low'], save: [], ruleOut: [] },
        value: { skip: ['Pay too low', 'Contract only'], save: [], ruleOut: [] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save reasons' })).toBeDisabled());
});

test('tryTitle says what the sweep would do and names the deciding word', () => {
    const v = { ...shown('titles', { titleMustNot: ['SDET'] }), roleWords: QA_ROLE, roleNotWords: QA_ROLE_NOT } as Record<string, string[]>;
    expect(tryTitle('Senior SDET, Platform', v, null).text).toBe('Saved, but passed: it has “SDET” from “Pass on titles with”.');
    expect(tryTitle('QA Analyst', { ...v, titleMustNot: [] }, null)).toEqual({ ok: true, text: 'Kept. It goes to triage for a quick look.' });
    expect(tryTitle('QA Manager', v, null).text).toBe('Not saved: it has “manager” from “But never titles with”.');
    expect(tryTitle('Junior QA Engineer', v, null).text).toBe('Not saved: it has “junior” from “Drop before saving”.');
    expect(tryTitle('Product Designer', v, null).ok).toBe(false);
});
