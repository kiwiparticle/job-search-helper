import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,29}$/;
// Reviewer tokens: 'none' = no review, 'each' = each searcher reviews the other (stored as null).
const RESERVED = ['both', 'owner', 'review', 'incoming', 'none', 'each'];
const RUNNERS = ['claude', 'codex', 'opencode', 'agy'];

export const DEFAULT_MODELS = {
    models: [
        { id: 'claude', label: 'Claude', runner: 'claude' },
        { id: 'codex', label: 'Codex', runner: 'codex' },
    ],
    defaults: {
        search: { searchers: ['claude'], reviewer: 'none' },
        ask: { model: 'both' },
        fill: { model: 'claude' },
    },
};

const validEntry = (m) => m && typeof m === 'object'
    && typeof m.id === 'string' && ID.test(m.id) && !RESERVED.includes(m.id)
    && typeof m.label === 'string'
    && RUNNERS.includes(m.runner)
    && (m.runner !== 'opencode' || (typeof m.model === 'string' && m.model));

const validId = (id) => typeof id === 'string' && ID.test(id) && !RESERVED.includes(id);

// Keep each defaults part only if well formed and naming enabled models in the registry.
function cleanDefaults(d, models) {
    const has = (id) => models.some((m) => m.id === id && m.enabled !== false);
    const D = DEFAULT_MODELS.defaults;
    const off = (id) => models.some((m) => m.id === id && m.enabled === false);
    // A model turned off drops out of a default: off searchers go, an off reviewer becomes no review.
    const trim = (s) => {
        if (!s || !Array.isArray(s.searchers)) return s;
        const searchers = s.searchers.filter((id) => !off(id));
        const named = typeof s.reviewer === 'string' && s.reviewer !== 'none' && s.reviewer !== 'each';
        const offOrSole = named && (off(s.reviewer) || (searchers.length === 1 && searchers[0] === s.reviewer));
        return { ...s, searchers, reviewer: offOrSole ? 'none' : s.reviewer };
    };
    const valid = (s) => s && Array.isArray(s.searchers) && s.searchers.length >= 1 && s.searchers.length <= 2
        && s.searchers.every(has) && new Set(s.searchers).size === s.searchers.length
        && (s.reviewer == null || s.reviewer === 'none' || s.reviewer === 'each' || has(s.reviewer))
        ? { searchers: s.searchers, reviewer: s.reviewer === 'each' ? null : s.reviewer ?? null } : null;
    const cleanSearch = (s) => valid(trim(s));
    const searches = Object.fromEntries(Object.entries(d?.searches ?? {})
        .filter(([k]) => /^[a-z]{2,20}$/.test(k)).map(([k, v]) => [k, cleanSearch(v)]).filter(([, v]) => v));
    const ask = d?.ask?.model;
    const both = has('claude') && has('codex');
    const fill = d?.fill?.model;
    return {
        search: cleanSearch(d?.search) ?? D.search,
        ask: (ask === 'both' ? both : has(ask)) ? { model: ask } : both ? D.ask : { model: 'claude' },
        fill: has(fill) ? { model: fill } : D.fill,
        ...(Object.keys(searches).length && { searches }),
    };
}

export function loadModels(repoDir) {
    try {
        const raw = JSON.parse(readFileSync(join(repoDir, 'data/models.json'), 'utf8'));
        if (!raw || !Array.isArray(raw.models)) return DEFAULT_MODELS;
        const models = raw.models.filter(validEntry);
        if (!models.length) return DEFAULT_MODELS;
        return { models, defaults: cleanDefaults(raw.defaults, models) };
    } catch {
        return DEFAULT_MODELS;
    }
}

export const getModel = (registry, id) => registry.models.find((m) => m.id === id) || null;

// `fromDefaults`: the id came from defaults (or their claude/codex fallback), so the fix is there.
function usable(registry, id, fromDefaults) {
    const m = getModel(registry, id);
    const hint = fromDefaults ? ` (a default; edit "defaults" in data/models.json to name enabled models)` : '';
    if (!m) throw new Error(`unknown model: ${id}${hint}`);
    if (m.enabled === false) throw new Error(`disabled model: ${id}${hint}`);
}

export function resolveRoute(registry, { workflow, searchers, reviewer } = {}) {
    const d = registry.defaults.searches?.[workflow] ?? registry.defaults.search;
    const s = searchers ?? d.searchers;
    const r0 = reviewer === undefined ? d.reviewer ?? null : reviewer;
    const r = r0 === 'each' ? null : r0;
    if (!Array.isArray(s) || s.length < 1) throw new Error('route needs at least one searcher');
    if (s.length > 2) throw new Error('route allows at most two searchers');
    if (new Set(s).size !== s.length) throw new Error('duplicate searcher');
    s.forEach((id) => usable(registry, id, searchers === undefined));
    if (r !== null && r !== 'none') {
        usable(registry, r, reviewer === undefined);
        if (s.length === 1 && s[0] === r) throw new Error('a model cannot review its own finds');
    }
    return { searchers: [...s], reviewer: r };
}

// The named reviewer's id, or null for "each other" (null) and "no review" ('none').
export const namedReviewer = (route) => (route.reviewer && route.reviewer !== 'none' ? route.reviewer : null);

export const reviewersOf = (route) =>
    route.reviewer === 'none' ? [] : namedReviewer(route) ? [route.reviewer] : route.searchers.length === 2 ? [...route.searchers] : [];

// A route.json's text, checked; throws when it is not valid JSON or not a valid route.
export function parseRoute(text) {
    const r = JSON.parse(text);
    const ids = (a) => Array.isArray(a) && a.every(validId);
    if (!ids(r.searchers) || r.searchers.length < 1 || r.searchers.length > 2
        || new Set(r.searchers).size !== r.searchers.length
        || !(r.reviewer == null || r.reviewer === 'none' || validId(r.reviewer))) throw new Error('not a valid route');
    // Runs from before 2026-11-20 may carry `advisory`; it no longer means anything.
    const { advisory, ...rest } = r;
    return { ...rest, reviewer: r.reviewer ?? null };
}

export function readRoute(runDir) {
    try {
        return parseRoute(readFileSync(join(runDir, 'route.json'), 'utf8'));
    } catch {
        return { searchers: ['claude', 'codex'], reviewer: null };
    }
}
