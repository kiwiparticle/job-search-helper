import { CAPS, capText } from './caps.js';
// The per-lead checklist, in display order. Labels come from the instructions' "Output (per lead)" section.
export const CHECK_LABELS = ['Pay', 'Location', 'Pace', 'Culture', 'Tech fit', 'Level', 'On-call', 'Posting', 'Size / stability'];
// Stored data and older instructions may still say the old label, "Remote / " plus a US state code.
export const checkLabel = (l) => (typeof l === 'string' && /^Remote \/ [A-Z]{2}$/.test(l) ? 'Location' : l);
const MARKS = ['good', 'concern', 'unknown'];

export function cleanChecks(raw) {
    if (!Array.isArray(raw)) return [];
    const byLabel = new Map();
    for (const c of raw) {
        const label = c && typeof c === 'object' ? checkLabel(c.label) : null;
        if (!label || !CHECK_LABELS.includes(label) || byLabel.has(label)) continue;
        byLabel.set(label, { label, value: capText(c.value, CAPS.check) ?? '', mark: MARKS.includes(c.mark) ? c.mark : 'unknown' });
    }
    return CHECK_LABELS.filter((l) => byLabel.has(l)).map((l) => byLabel.get(l));
}
