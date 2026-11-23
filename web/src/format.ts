// "13 min", "1 h 5 min", "under a minute". Empty when the duration is unknown.
export function formatDuration(ms?: number | null): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'under a minute';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
}

// "Today", "Yesterday", "9 days ago" from a YYYY-MM-DD date. Empty for anything else.
export function daysAgo(date: string, now = new Date()): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    const [y, m, d] = date.split('-').map(Number);
    const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
    if (days < 0) return '';
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

// "17 yrs (2009)" from a founded year; text with no year is shown as written. Empty when nothing is recorded.
export function companyAge(founded?: string, now = new Date()): string {
    const text = (founded ?? '').trim();
    const year = Number(text.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]);
    if (!year || year > now.getFullYear()) return text;
    const age = now.getFullYear() - year;
    return age < 1 ? `founded ${year}` : `${age} ${age === 1 ? 'yr' : 'yrs'} (${year})`;
}

export { fingerprintScore } from '../../lib/companies.js';
import { fingerprintScore } from '../../lib/companies.js';

// An outstanding company: a fingerprint of 4 or more that the model didn't hedge. Weak evidence words (thin,
// low or medium-low confidence, provisional, mostly company claims, unverified, mixed, limited) or a pace
// concern rule it out. A bare score ("4/5") counts.
const WEAK_EVIDENCE = /thin|\blow\b|provisional|company claims?|company evidence|company-written|mostly company|\(company\)|unverified|mixed|limited|pace concern/i;
export const isOutstanding = (c: { fingerprint?: string }) => (fingerprintScore(c.fingerprint) ?? 0) >= 4 && !WEAK_EVIDENCE.test(c.fingerprint ?? '');

// Awards in two or more of the last three years ("2021, 2023–2026" counts ranges). Free text, so years only.
export function hasRecentAwards(awards?: string, year = new Date().getFullYear()): boolean {
    const years = new Set<number>();
    for (const m of (awards ?? '').matchAll(/\b(20\d\d)(?:\s*[–—-]\s*(20\d\d))?\b/g)) {
        for (let y = Number(m[1]); y <= Number(m[2] ?? m[1]); y++) if (y > year - 3 && y <= year) years.add(y);
    }
    return years.size >= 2;
}

// Models often write a note like "Not posted" or "Unverified" into pay: with no digit in it, it is no pay at all.
const posted = (pay: string): string => (/\d/.test(pay) ? pay : '');

// Pay for a list row: the first range (else the first dollar amount) only, "Est. ..." for an unverified estimate, or a plain "No salary posted".
export function shortPay(p: { pay: string; payEstimate?: unknown }): string {
    const first = (s: string) => s.match(/\$?[\d,.]+k?\s*[–—-]\s*\$?[\d,.]+k?/i)?.[0] ?? s.match(/\$[\d,.]+k?/i)?.[0] ?? s.split(/ \(|, | base/)[0];
    if (posted(p.pay)) return first(p.pay);
    const range = (p.payEstimate as { range?: string } | null)?.range;
    return range ? `Est. ${first(range)}` : 'No salary posted';
}

const NOT_ANNUAL = /\/\s*(?:h(?:ou)?r|wk|week|mo|month)\b|per\s+(?:hour|week|month)|hourly|weekly|monthly/i;
const OTHER_CURRENCY = /\b(?:CAD|AUD|NZD|EUR|GBP|CHF|SGD|MXN)\b|\b(?:CA|C|A|NZ|AU|S|MX)\$|[€£¥]/i;

// The first "$a–$b" (or single "$a") in the posted pay, else in the estimate. A "k" on either end applies to both.
export function payRange(p: { pay: string; payEstimate?: unknown }): { min: number; max: number; estimate: boolean } | null {
    const estimate = !posted(p.pay);
    const text = posted(p.pay) || ((p.payEstimate as { range?: string } | null)?.range ?? '');
    const m = text.match(/\$\s*([\d,.]+)\s*(k)?(?:\s*[–—-]\s*\$?\s*([\d,.]+)\s*(k)?)?/i);
    if (!m) return null;
    // Only yearly US dollars can be set against the floor: hourly, weekly or monthly pay and other currencies stay as text.
    // The unit must belong to this range: the 20 characters after it, up to the next dollar amount ("; contractors $90/hr" is another rate).
    const unit = m[0] + text.slice(m.index! + m[0].length).split('$')[0].slice(0, 20);
    if (NOT_ANNUAL.test(unit) || OTHER_CURRENCY.test(text)) return null;
    const k = Boolean(m[2] || m[4]);
    const num = (s: string) => { const n = parseFloat(s.replace(/,/g, '')) || 0; return k && n < 1000 ? n * 1000 : n; };
    const min = num(m[1]);
    const max = m[3] ? num(m[3]) : min;
    return max < 1000 ? null : { min, max, estimate };
}

// The fit-score bucket names, best first; a lead's index is fitIndex(posting.fit).
export const FIT_LABEL = ['Strong fit', 'Good fit', 'Maybe', 'Low fit', 'Not scored'] as const;
export const fitIndex = (fit?: number): number => (fit == null ? 4 : fit >= 5 ? 0 : fit === 4 ? 1 : fit === 3 ? 2 : 3);

// Only a posted range counts toward the floor (from useFloor), never an estimate. No floor means never below.
export const belowFloor = (p: { pay: string; payEstimate?: unknown }, floor: number | null): boolean => {
    const r = payRange(p);
    return Boolean(r && !r.estimate && floor != null && r.max < floor);
};

// The first dollar amount in a pay string as a number, for sorting. 0 when there is none.
export function payNumber(pay: string): number {
    const m = pay.match(/\$?([\d,.]+)\s*(k)?/i);
    if (!m) return 0;
    return (parseFloat(m[1].replace(/,/g, '')) || 0) * (m[2] ? 1000 : 1);
}

// "Nov 14" from a YYYY-MM-DD date, read as a calendar day (no time zone shift). Anything else is returned as written.
export function dayText(date: string): string {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : date;
}

// "9am", "2:30pm" in the browser's time zone.
const clockText = (t: Date): string => {
    const h = t.getHours() % 12 || 12;
    return `${h}${t.getMinutes() ? ':' + String(t.getMinutes()).padStart(2, '0') : ''}${t.getHours() < 12 ? 'am' : 'pm'}`;
};

// The moment a run folder name (2026-11-18-tracked-142633) was made. Folder times are UTC. null when there is none.
const runTime = (run?: string): Date | null => {
    const m = run?.match(/^(\d{4})-(\d{2})-(\d{2}).*-(\d{2})(\d{2})\d*$/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
};

// "Nov 18, 9:26am" from a run folder name, in the browser's time zone. '' when there is none.
export const runStamp = (run?: string): string => {
    const t = runTime(run);
    return t ? `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clockText(t)}` : '';
};

// For a list row: "7:08am" when the run was today, "Nov 20" before that. '' when there is none.
export const rowStamp = (run?: string, now = new Date()): string => {
    const t = runTime(run);
    if (!t) return '';
    return t.toDateString() === now.toDateString() ? clockText(t) : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// A UTC wall-clock time today, in the browser's time zone: utcClock(10) is "5am" in New York in winter.
export const utcClock = (hour: number, minute = 0, now = new Date()): string =>
    clockText(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute)));

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// A cron schedule given in UTC (days 0-6 with Sunday 0, null for every day, and the hours it fires), shown in the browser's
// time zone: "Mon/Wed/Fri 6am", "daily 5am and 11am". A time zone far from UTC can move a run to another weekday; that shows too.
export function scheduleText(days: number[] | null, hours: number[], now = new Date()): string {
    const byClock = new Map<string, Set<number>>();
    for (const hour of hours) {
        for (const d of days ?? [0, 1, 2, 3, 4, 5, 6]) {
            // The next date (from today) whose UTC weekday is d, at this UTC hour, then read in local time.
            let t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
            while (t.getUTCDay() !== d) t = new Date(t.getTime() + 86400000);
            const clock = clockText(t);
            byClock.set(clock, (byClock.get(clock) ?? new Set()).add(t.getDay()));
        }
    }
    const dayText = (set: Set<number>) => (set.size === 7 ? 'daily' : [...set].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join('/'));
    const parts = [...byClock].map(([clock, set]) => [dayText(set), clock] as const);
    return parts.every(([d]) => d === parts[0][0]) ? `${parts[0][0]} ${parts.map(([, c]) => c).join(' and ')}` : parts.map(([d, c]) => `${d} ${c}`).join(', ');
}

// "today at 9am", "yesterday at 2:30pm", "Nov 16 at 9am" for a time, in the browser's time zone.
export function whenText(t: Date, now = new Date()): string {
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
    const day = days === 0 ? 'today' : days === 1 ? 'yesterday' : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${day} at ${clockText(t)}`;
}

// The same from a run folder name. '' when there is none.
export function runWhen(run?: string, now = new Date()): string {
    const t = runTime(run);
    return t ? whenText(t, now) : '';
}
