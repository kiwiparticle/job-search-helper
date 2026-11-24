// The owner's board-sweep filter (data/sweep-filter.json). A role it rejects is saved as a pass, never sent to a model.
// Loading it from disk; the matching lives in lib/titleWords.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DROP, DEFAULT_ROLE, DEFAULT_ROLE_NOT, words } from './titleWords.js';

export { DEFAULT_DROP, DEFAULT_ROLE, DEFAULT_ROLE_NOT, hasWord, roleTest, rejectReason } from './titleWords.js';

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

// Title words dropped before a role is stored: the filter's titleDrop, or the default when there is no filter file.
export const dropWords = (repoDir) => loadFilter(repoDir)?.titleDrop ?? DEFAULT_DROP;
