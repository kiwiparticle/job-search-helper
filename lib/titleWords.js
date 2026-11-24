// Title-word matching for the board-sweep filter (data/sweep-filter.json), shared by the sweep (lib/sweepFilter.js) and the
// page's Settings › Job titles, so no Node imports here.
// { version, titleMust: [], titleMustNot: [], titleNonSoftware: [], softwareWords: [], levels: [], locations: [], titleDrop: [] }: words match
// whole, any case, a space or hyphen inside one matching either or none. An empty list checks nothing, and a role with no location passes the location rule. A titleNonSoftware word
// ("Mechanical") rejects only a title with no softwareWords word, so "SWE - Mechanical Modeling" stays.
// roleWords / roleNotWords pick which titles the sweep stores at all: one roleWords word and no roleNotWords word.
// Absent means the engineering defaults below; a QA/SDET search sets its own (see the setup skill).
export const DEFAULT_DROP = ['intern', 'internship', 'junior', 'apprentice', 'co-op', 'coop'];
export const DEFAULT_ROLE = ['engineer', 'engineers', 'developer', 'developers', 'swe', 'sde', 'programmer', 'architect', 'technologist',
    'tech lead', 'technical lead', 'member of technical staff', 'mts', 'front end', 'full stack', 'back end'];
export const DEFAULT_ROLE_NOT = ['manager', 'director', 'head', 'vp', 'recruiter', 'recruiters', 'recruiting', 'recruitment', 'sales', 'support', 'accountant', 'designer', 'analyst'];
// QA / QE / SDET titles; its not-list keeps "QA Analyst". The setup skill and Settings › Job titles use these.
export const QA_ROLE = ['qa', 'qe', 'sdet', 'quality', 'quality assurance', 'test', 'tester', 'testing', 'automation', 'engineer in test', 'verification'];
export const QA_ROLE_NOT = DEFAULT_ROLE_NOT.filter((w) => w !== 'analyst');

export const words = (v) => (Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()) : []);

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A space or hyphen in a word matches a space, hyphen, underscore or nothing: "Full Stack" matches Full-Stack and FullStack.
export const hasWord = (text, list) => list.some((w) => new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase()).replace(/[\s-]+/g, '[\\s_-]?')}($|[^a-z0-9])`).test(String(text).toLowerCase()));

// Whether the sweep stores a title at all: a role word and no role-not word. Null filter: the engineering defaults.
export const roleTest = (filter) => (title) => hasWord(title, filter?.roleWords ?? DEFAULT_ROLE) && !hasWord(title, filter?.roleNotWords ?? DEFAULT_ROLE_NOT);

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
