// Pulls posted pay out of posting text. Pure. Returns "$120,000–$150,000 | $110,000–$140,000" (up to 3 distinct hits) or null.
const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?/gi;
const TAIL = /^\s*(?:-|–|—|to|and)\s*\$?\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?/i;
const NOT_MONEY = /^\s?(?:million|billion|mm?\b|b\b|bn\b)/i; // $5 million, $2M
const PAY_WORD = /\b(salary|compensation|pay|base|range|ote|annual(?:ly)?|per year|yearly|a year|usd|wage)\b|\/\s?(?:yr|year)/i;
const FUNDING = /\b(funding|raised|revenue|valuation|investors?|stipend|arr)\b/i;
const HOURLY = /^\s*(?:\/|per\s|an?\s)?\s?(?:hr|hour|hourly)/i;

const num = (s, k) => parseFloat(s.replace(/,/g, '')) * (k ? 1000 : 1);
const annual = (n) => n >= 30_000 && n <= 1_500_000;
const hourly = (n) => n >= 15 && n <= 300;

export function findPay(text) {
    const s = String(text ?? '');
    const hits = [];
    let used = 0; // end of the last range, so its second figure isn't read again
    for (const m of s.matchAll(MONEY)) {
        if (m.index < used) continue;
        let end = m.index + m[0].length;
        if (NOT_MONEY.test(s.slice(end, end + 12))) continue;
        let lo = num(m[1], m[2]);
        let hi = null;
        const t = s.slice(end, end + 40).match(TAIL);
        if (t && !NOT_MONEY.test(s.slice(end + t[0].length, end + t[0].length + 12))) {
            hi = num(t[1], t[2]);
            if (!m[2] && t[2] && lo < 1000) lo *= 1000; // $120-140k
            end += t[0].length;
        }
        used = end;
        const near = s.slice(Math.max(0, m.index - 120), end + 120);
        if (FUNDING.test(near)) continue;
        const isHourly = HOURLY.test(s.slice(end, end + 14));
        const ok = isHourly ? hourly : annual;
        if (!ok(lo) || (hi !== null && (!ok(hi) || hi < lo))) continue;
        if (hi === null && !isHourly && !PAY_WORD.test(near)) continue; // a lone figure needs a pay word nearby
        if (hi === null && isHourly && !hourly(lo)) continue;
        const hit = s.slice(m.index, end).replace(/\s+/g, ' ').trim() + (isHourly ? '/hr' : '');
        if (!hits.includes(hit)) hits.push(hit);
    }
    return hits.length ? hits.slice(0, 3).join(' | ') : null;
}
