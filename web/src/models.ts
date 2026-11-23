import { useQuery } from '@tanstack/react-query';
import { getJson } from './api';
import type { RunLead, Verdict } from './model';
import { NAME } from './types';

export type ModelEntry = { id: string; label: string; runner: string; model?: string; ctx?: number; enabled?: boolean; instructions?: string; missing?: boolean };
// reviewer: null or 'each' = each searcher reviews the other, 'none' = no review, else a model id.
export type SearchDefault = { searchers: string[]; reviewer: string | null };
export type Defaults = { search: SearchDefault; ask: { model: string }; fill: { model: string }; searches?: Record<string, SearchDefault> };

// What the page assumes until data/models.json loads (or when it can't be read).
const FALLBACK: { models: ModelEntry[]; defaults: Defaults } = {
    models: [{ id: 'claude', label: 'Claude', runner: 'claude' }, { id: 'codex', label: 'Codex', runner: 'codex' }],
    defaults: { search: { searchers: ['claude'], reviewer: 'none' }, ask: { model: 'both' }, fill: { model: 'claude' } },
};

// Mirrors lib/models.js cleanDefaults (not validEntry: the server also drops entries with an unknown runner).
// A model is usable when listed and not `enabled: false`; `missing` is ignored, as on the server.
export function cleanDefaults(raw: unknown, models: ModelEntry[]): Defaults {
    const d = (raw ?? {}) as any;
    const has = (id: unknown) => models.some((m) => m.id === id && m.enabled !== false);
    const F = FALLBACK.defaults;
    const off = (id: unknown) => models.some((m) => m.id === id && m.enabled === false);
    // A model turned off drops out of a default: off searchers go, an off reviewer becomes no review.
    const trim = (s: any) => {
        if (!s || !Array.isArray(s.searchers)) return s;
        const searchers = s.searchers.filter((id: unknown) => !off(id));
        const named = typeof s.reviewer === 'string' && s.reviewer !== 'none' && s.reviewer !== 'each';
        const offOrSole = named && (off(s.reviewer) || (searchers.length === 1 && searchers[0] === s.reviewer));
        return { ...s, searchers, reviewer: offOrSole ? 'none' : s.reviewer };
    };
    const valid = (s: any): SearchDefault | null =>
        s && Array.isArray(s.searchers) && s.searchers.length >= 1 && s.searchers.length <= 2
        && s.searchers.every(has) && new Set(s.searchers).size === s.searchers.length
        && (s.reviewer == null || s.reviewer === 'none' || s.reviewer === 'each' || has(s.reviewer))
            ? { searchers: s.searchers, reviewer: s.reviewer === 'each' ? null : s.reviewer ?? null } : null;
    const cleanSearch = (s: any) => valid(trim(s));
    const searches = Object.fromEntries(Object.entries(d.searches ?? {})
        .filter(([k]) => /^[a-z]{2,20}$/.test(k)).map(([k, v]) => [k, cleanSearch(v)]).filter(([, v]) => v));
    const ask = d.ask?.model;
    const both = has('claude') && has('codex');
    const fill = d.fill?.model;
    return {
        search: cleanSearch(d.search) ?? F.search,
        ask: (ask === 'both' ? both : has(ask)) ? { model: ask } : both ? F.ask : { model: 'claude' },
        fill: has(fill) ? { model: fill } : F.fill,
        ...(Object.keys(searches).length && { searches }),
    };
}

// The model defaults for a workflow: its own entry, else the general search one.
export const searchDefaults = (defaults: Defaults, workflow?: string): SearchDefault =>
    (workflow && defaults.searches?.[workflow]) || defaults.search;

// Rough size of one run's prompt, in tokens. The real check is in the runner's setup; this only greys out a hopeless pick.
// Lenient lower bound (trimmed context + prompt + instructions); setup trims to fit and is the authoritative check.
export const WORKFLOW_TOKENS: Record<string, number> = { search: 25000 };
const OTHER_TOKENS = 8000;

export function fitsBudget(entry: ModelEntry, workflow: string): { ok: boolean; why?: string } {
    if (!entry.ctx) return { ok: true };
    const need = WORKFLOW_TOKENS[workflow] ?? OTHER_TOKENS;
    const limit = Math.floor(entry.ctx * 0.6);
    return need <= limit ? { ok: true } : { ok: false, why: `context too small (about ${limit.toLocaleString('en-US')} usable, ${need.toLocaleString('en-US')} needed)` };
}

// The registry the owner keeps in data/models.json. Models that can't be used are left out of the pickers.
export function useModels() {
    const { data } = useQuery({
        queryKey: ['models'],
        queryFn: () => getJson<typeof FALLBACK>('data/models.json').catch(() => null),
    });
    const ok = Array.isArray(data?.models) && data.models.length > 0;
    const all = ok ? data!.models : FALLBACK.models;
    const defaults = ok ? cleanDefaults(data!.defaults, all) : FALLBACK.defaults;
    const models = all.filter((m) => m.enabled !== false && !m.missing);
    const label = (id: string) => all.find((m) => m.id === id)?.label ?? NAME[id] ?? id;
    // False for a choice value naming a model that is off ('both' needs Claude and Codex). Other values pass.
    const on = (id: string) => models.some((m) => m.id === id);
    const allowed = (v: string) => (v === 'both' ? on('claude') && on('codex') : !all.some((m) => m.id === v) || on(v));
    return { models, all, defaults, label, allowed };
}

// Each model's say on a lead, from `opinions` or, on older runs, the claude and codex fields.
export function opinionsOf(lead: Pick<RunLead, 'claude' | 'codex' | 'opinions'>): Array<[string, Verdict]> {
    const from = lead.opinions ?? { claude: lead.claude, codex: lead.codex };
    return Object.entries(from).filter((e): e is [string, Verdict] => Boolean(e[1]));
}

export const NONE = 'none';
export const EACH = 'each';

// The reviewer pick shown first. A model that is the sole searcher can't review, so it starts on NONE.
export function startReviewer(def: string | null, sole: string | null): string {
    if (def === null || def === EACH) return sole ? NONE : EACH;
    return def === sole ? NONE : def;
}

// What the server resolves when no `reviewer` is sent. A default model id stays itself even when it is the sole searcher.
export function serverReviewer(def: string | null, sole: string | null): string {
    return def === null || def === EACH ? (sole ? NONE : EACH) : def;
}

// The fixed reviewer choices; callers append the model options.
export function reviewerOptions(sole: string | null): { value: string; label: string }[] {
    return [{ value: NONE, label: 'None (no review)' }, ...(sole ? [] : [{ value: EACH, label: 'Each other' }])];
}

// The reviewer in effect: the owner's pick unless it can't apply (the sole searcher, or Each other with one searcher), else the start pick.
export function resolveReviewer(picked: string | undefined, def: string | null, sole: string | null): string {
    const unusable = picked === undefined || picked === sole || (sole !== null && picked === EACH);
    return unusable ? startReviewer(def, sole) : picked;
}

const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// "Claude and Codex, no review": who a search uses by default, with the same reviewer rule the pickers apply.
export function searchSummary(defaults: Defaults, workflow: string, label: (id: string) => string): string {
    const d = searchDefaults(defaults, workflow);
    const r = resolveReviewer(undefined, d.reviewer, d.searchers.length < 2 ? d.searchers[0] : null);
    const review = r === NONE ? 'no review' : r === EACH ? 'reviewing each other' : `reviewed by ${label(r)}`;
    return `${andList(d.searchers.map(label))}, ${review}`;
}
