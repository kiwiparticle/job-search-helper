import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STRINGS = ['who', 'levels', 'levelsOut', 'stack', 'location', 'strengths', 'offStack', 'domainsFirst', 'fitRubric'];

// Parse step: missing strings read as '', a bad payFloor as null, currency defaults to USD.
export function cleanProfile(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const p = {};
    for (const k of STRINGS) p[k] = typeof r[k] === 'string' ? r[k] : '';
    p.payFloor = Number.isFinite(r.payFloor) && r.payFloor > 0 ? r.payFloor : null;
    p.currency = typeof r.currency === 'string' && r.currency ? r.currency : 'USD';
    return p;
}

export function loadProfile(repoDir) {
    try {
        return cleanProfile(JSON.parse(readFileSync(join(repoDir, 'data/profile.json'), 'utf8')));
    } catch {
        throw new Error('data/profile.json is missing or broken: copy examples/data/profile.json and edit it');
    }
}

const floorText = ({ payFloor, currency }) => {
    if (payFloor === null) return 'none';
    const n = payFloor.toLocaleString('en-US');
    return currency === 'USD' ? `$${n}` : `${n} ${currency}`;
};

export function profileSlots(p) {
    return {
        PROFILE_WHO: p.who,
        PROFILE_LEVELS: p.levels,
        PROFILE_LEVELS_OUT: p.levelsOut,
        PROFILE_STACK: p.stack,
        PROFILE_LOCATION: p.location,
        PROFILE_STRENGTHS: p.strengths,
        PROFILE_OFF_STACK: p.offStack,
        PROFILE_DOMAINS_FIRST: p.domainsFirst,
        PROFILE_FIT_RUBRIC: p.fitRubric,
        PROFILE_PAY_FLOOR: floorText(p),
    };
}

// Replaces {{NAME}} with env[NAME] ?? slots[NAME] ?? ''. Budget sizing passes env = {} (only the profile text is known then).
export const fillSlots = (text, slots, env = process.env) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => env[k] ?? slots[k] ?? '');
