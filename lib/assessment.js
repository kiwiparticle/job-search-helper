import { CAPS, capText } from './caps.js';
// The longer read on a lead, beyond the checklist: the case for and against, what's unknown,
// and a labeled salary guess when no pay is posted. Model output is untrusted, so everything is trimmed and capped.
const LISTS = [['for', 'Case for'], ['against', 'Case against'], ['unknown', 'Still unknown']];
export const ASSESSMENT_LISTS = LISTS;
const CONFIDENCE = ['low', 'medium', 'high'];

// Text cut at the cap ends in an ellipsis, so a clipped sentence reads as clipped.
const str = (v, max) => {
    const full = capText(v, Infinity);
    return full && full.length > max ? `${full.slice(0, max - 1).trimEnd()}…` : full ?? '';
};

export function cleanAssessment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const [key] of LISTS) {
        const items = Array.isArray(raw[key]) ? raw[key].map((x) => str(x, CAPS.listItem)).filter(Boolean).slice(0, CAPS.listItems) : [];
        if (items.length) out[key] = items;
    }
    return Object.keys(out).length ? out : null;
}

export function cleanPayEstimate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const range = str(raw.range, CAPS.pay);
    if (!range) return null;
    const confidence = CONFIDENCE.includes(String(raw.confidence).toLowerCase()) ? String(raw.confidence).toLowerCase() : 'low';
    return { range, confidence, basis: str(raw.basis, CAPS.basis) };
}
