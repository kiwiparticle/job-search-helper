import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import fixture from '../../test/fixtures/models-searches.json';
import { cleanDefaults, fitsBudget, opinionsOf, resolveReviewer, runModelsText, searchDefaults, useModels } from './models';

const verdict = (verdict: string) => ({ verdict });

test('opinionsOf prefers opinions over the legacy fields', () => {
    expect(opinionsOf({ claude: verdict('Skip'), opinions: { qwen: verdict('Good'), codex: null } })).toEqual([['qwen', verdict('Good')]]);
});

test('opinionsOf falls back to claude and codex on old runs', () => {
    expect(opinionsOf({ claude: verdict('Good'), codex: null })).toEqual([['claude', verdict('Good')]]);
    expect(opinionsOf({})).toEqual([]);
});

test('fitsBudget only refuses a search when the estimate exceeds the usable context', () => {
    const entry = { id: 'qwen', label: 'Qwen', runner: 'local' };
    expect(fitsBudget({ ...entry, ctx: 30000 }, 'search').ok).toBe(false);
    expect(fitsBudget({ ...entry, ctx: 30000 }, 'search').why).toMatch(/context/);
    expect(fitsBudget({ ...entry, ctx: 30000 }, 'ask').ok).toBe(true);
    expect(fitsBudget({ ...entry, ctx: 64000 }, 'search').ok).toBe(true);
    expect(fitsBudget({ ...entry, ctx: 128000 }, 'search').ok).toBe(true);
    expect(fitsBudget(entry, 'search').ok).toBe(true);
});

test('resolveReviewer: an unset pick follows the default, a pick that cannot apply falls back', () => {
    expect(resolveReviewer(undefined, null, null)).toBe('each');
    expect(resolveReviewer(undefined, 'none', null)).toBe('none');
    expect(resolveReviewer('qwen', null, null)).toBe('qwen');
    expect(resolveReviewer('each', 'none', null)).toBe('each');
    expect(resolveReviewer('each', 'qwen', 'claude')).toBe('qwen');
    expect(resolveReviewer('each', null, 'claude')).toBe('none');
    expect(resolveReviewer('claude', null, 'claude')).toBe('none');
});

test('cleanDefaults matches the server fixture', () => {
    expect(cleanDefaults(fixture.raw.defaults, fixture.raw.models)).toEqual(fixture.cleaned);
});

test('cleanDefaults omits searches when no entry survives', () => {
    const raw = { ...fixture.raw.defaults, searches: { links: { searchers: ['off'], reviewer: null }, Bad_Key: { searchers: ['claude'], reviewer: null } } };
    expect(cleanDefaults(raw, fixture.raw.models)).toEqual({ search: fixture.cleaned.search, ask: fixture.cleaned.ask, fill: fixture.cleaned.fill });
});

test('searchDefaults picks the workflow entry, else search', () => {
    const d = cleanDefaults(fixture.raw.defaults, fixture.raw.models);
    expect(searchDefaults(d, 'culture')).toEqual({ searchers: ['claude'], reviewer: 'none' });
    expect(searchDefaults(d, 'daily')).toBe(d.search);
    expect(searchDefaults(d)).toBe(d.search);
});

afterEach(() => vi.unstubAllGlobals());

test('useModels drops a disabled reviewer from a default and keeps the rest', async () => {
    const reg = { models: fixture.raw.models, defaults: { search: { searchers: ['codex'], reviewer: 'off' }, ask: { model: 'both' }, fill: { model: 'claude' } } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(reg))));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useModels(), { wrapper });
    await waitFor(() => expect(result.current.models.some((m) => m.id === 'qwen')).toBe(true));
    expect(result.current.defaults.search).toEqual({ searchers: ['codex'], reviewer: 'none' });
});

test('runModelsText names searchers and reviewers, guessing reviewers on old rows', () => {
    const L = (id: string) => id.toUpperCase();
    expect(runModelsText({ a: { status: 'ok' }, b: { status: 'auth' }, c: {} }, undefined, L)).toBe('A and B, reviewed by C');
    expect(runModelsText({ a: { status: 'ok' }, b: { status: 'ok' } }, ['a', 'b'], L)).toBe('A and B, reviewing each other');
    expect(runModelsText({ a: { status: 'ok' } }, [], L)).toBe('A, no review');
    expect(runModelsText(undefined, undefined, L)).toBe('');
});
