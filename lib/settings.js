// The page's Settings tabs: the owner file each one edits, the keys it may change and how each value is checked.
// Shared by the page (what it shows) and the setSettings action (what it writes). No Node imports.
import { DEFAULT_DROP, DEFAULT_ROLE, DEFAULT_ROLE_NOT } from './titleWords.js';

const list = (max, { min = 0, len = 60 } = {}) => (v) => {
    if (!Array.isArray(v) || v.length > max || !v.every((w) => typeof w === 'string' && w.trim() && w.length <= len)) return undefined;
    const out = [...new Set(v.map((w) => w.trim()))];
    return out.length >= min ? out : undefined;
};
const text = (len, { required = false } = {}) => (v) => (typeof v === 'string' && v.length <= len && (!required || v.trim()) ? v.trim() : undefined);
const money = (v) => (v === null || (Number.isInteger(v) && v > 0 && v < 1e8) ? v : undefined); // null: no floor
const currency = (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : undefined);

// shown: the value a key shows when the file lacks it.
export const SETTINGS = {
    reasons: {
        path: 'data/reasons.json',
        keys: { skip: [list(20), []], save: [list(20), []], ruleOut: [list(20), []] },
    },
    titles: {
        path: 'data/sweep-filter.json',
        bump: true, // a new version re-checks roles the old words passed on
        keys: {
            roleWords: [list(100, { min: 1 }), DEFAULT_ROLE], roleNotWords: [list(100), DEFAULT_ROLE_NOT], titleDrop: [list(100), DEFAULT_DROP],
            titleMustNot: [list(100), []], levels: [list(100), []], locations: [list(100), []],
        },
    },
    profile: {
        path: 'data/profile.json',
        keys: {
            who: [text(300, { required: true }), ''], levels: [text(300), ''], levelsOut: [text(300), ''], location: [text(300), ''],
            stack: [text(600), ''], strengths: [text(600), ''], offStack: [text(600), ''], domainsFirst: [text(600), ''],
            payFloor: [money, null], currency: [currency, 'USD'], fitRubric: [text(4000), ''],
        },
    },
};

// What a tab shows for a parsed file (null when the file is missing): each key's value, or its default.
export function shown(tab, obj) {
    const o = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    return Object.fromEntries(Object.entries(SETTINGS[tab].keys).map(([k, [, dflt]]) => [k, o[k] ?? dflt]));
}

// The file's new text for a save: { text } or { status, error }. `before` is what the page showed when the person
// started editing; if the file has moved since, nothing is written (409). Keys the tab doesn't own are kept.
export function applySettings(tab, fileText, before, value) {
    const spec = SETTINGS[tab];
    if (!spec) return { status: 400, error: 'unknown settings tab' };
    let obj = {};
    if (fileText != null) {
        try { obj = JSON.parse(fileText); } catch { return { status: 409, error: `${spec.path} isn't valid JSON. Fix it in the repo first.` }; }
    }
    if (JSON.stringify(shown(tab, obj)) !== JSON.stringify(before)) return { status: 409, error: 'These settings changed since you opened them. Reload the page and try again.' };
    const clean = {};
    for (const [k, [check]] of Object.entries(spec.keys)) {
        const v = check(value?.[k]);
        if (v === undefined) return { status: 400, error: `bad ${k}` };
        clean[k] = v;
    }
    const next = { ...obj, ...clean };
    for (const k of Object.keys(clean)) if (clean[k] === null) delete next[k]; // no pay floor: leave the key out
    if (spec.bump) next.version = (Number.isInteger(obj.version) ? obj.version : 0) + 1;
    const indent = fileText?.match(/^\{\n( +)"/)?.[1].length ?? 4;
    return { text: `${JSON.stringify(next, null, indent)}\n` };
}
