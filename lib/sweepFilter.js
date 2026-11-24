// The owner's board-sweep filter (data/sweep-filter.json). A role it rejects is saved as a pass, never sent to a model.
// { version, titleMust: [], titleMustNot: [], titleNonSoftware: [], softwareWords: [], levels: [], locations: [], titleDrop: [] }: words match
// whole, any case, a space or hyphen inside one matching either or none. An empty list checks nothing, and a role with no location passes the location rule. A titleNonSoftware word
// ("Mechanical") rejects only a title with no softwareWords word, so "SWE - Mechanical Modeling" stays.
// roleWords / roleNotWords pick which titles the sweep stores at all: one roleWords word and no roleNotWords word.
// Absent means the engineering defaults below; a QA/SDET search sets its own (see the setup skill).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_DROP = ['intern', 'internship', 'junior', 'apprentice', 'co-op', 'coop'];
export const DEFAULT_ROLE = ['engineer', 'engineers', 'developer', 'developers', 'swe', 'sde', 'programmer', 'architect', 'technologist',
    'tech lead', 'technical lead', 'member of technical staff', 'mts', 'front end', 'full stack', 'back end'];
export const DEFAULT_ROLE_NOT = ['manager', 'director', 'head', 'vp', 'recruiter', 'recruiters', 'recruiting', 'recruitment', 'sales', 'support', 'accountant', 'designer', 'analyst'];

const words = (v) => (Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()) : []);

// The filter, or null when the file is missing or broken (then nothing is filtered).
export function loadFilter(repoDir) {
    try {
        const raw = JSON.parse(readFileSync(join(repoDir, 'data/sweep-filter.json'), 'utf8'));
        if (!Number.isInteger(raw?.version)) return null;
        return { version: raw.version, titleMust: words(raw.titleMust), titleMustNot: words(raw.titleMustNot), titleNonSoftware: words(raw.titleNonSoftware), softwareWords: words(raw.softwareWords), levels: words(raw.levels), locations: words(raw.locations), titleDrop: Array.isArray(raw.titleDrop) ? words(raw.titleDrop) : DEFAULT_DROP,
            roleWords: Array.isArray(raw.roleWords) ? words(raw.roleWords) : DEFAULT_ROLE, roleNotWords: Array.isArray(raw.roleNotWords) ? words(raw.roleNotWords) : DEFAULT_ROLE_NOT };
    } catch {
        return null;
    }
}

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A space or hyphen in a word matches a space, hyphen, underscore or nothing: "Full Stack" matches Full-Stack and FullStack.
export const hasWord = (text, list) => list.some((w) => new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase()).replace(/[\s-]+/g, '[\\s_-]?')}($|[^a-z0-9])`).test(String(text).toLowerCase()));

// Whether the sweep stores a title at all: a role word and no role-not word. Null filter: the engineering defaults.
export const roleTest = (filter) => (title) => hasWord(title, filter?.roleWords ?? DEFAULT_ROLE) && !hasWord(title, filter?.roleNotWords ?? DEFAULT_ROLE_NOT);

// Title words dropped before a role is stored: the filter's titleDrop, or the default when there is no filter file.
export const dropWords = (repoDir) => loadFilter(repoDir)?.titleDrop ?? DEFAULT_DROP;

// Why the filter rejects a role, or null when it passes.
export function rejectReason(filter, { title, location }) {
    if (!filter) return null;
    if (filter.titleMust.length && !hasWord(title, filter.titleMust)) return 'title has none of the required words';
    if (hasWord(title, filter.titleMustNot)) return 'title has an excluded word';
    if (hasWord(title, filter.titleNonSoftware ?? []) && !hasWord(title, filter.softwareWords ?? [])) return 'title names non-software engineering';
    if (filter.levels.length && !hasWord(title, filter.levels)) return 'title names none of the levels';
    if (location && filter.locations.length && !hasWord(location, filter.locations)) return 'location is not one of the allowed ones';
    return null;
}
