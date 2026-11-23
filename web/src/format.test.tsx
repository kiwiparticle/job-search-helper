import { describe, expect, test, vi } from 'vitest';
import { belowFloor, companyAge, fingerprintScore, hasRecentAwards, isOutstanding, daysAgo, payRange, rowStamp, runStamp, runWhen, scheduleText, shortPay, utcClock } from './format';

const now = new Date('2026-11-18');

test('companyAge', () => {
    expect(companyAge('2009', now)).toBe('17 yrs (2009)');
    expect(companyAge('Founded in 2025.', now)).toBe('1 yr (2025)');
    expect(companyAge('2026', now)).toBe('founded 2026');
    expect(companyAge('a long time ago', now)).toBe('a long time ago');
    expect(companyAge(undefined, now)).toBe('');
    expect(companyAge('2099', now)).toBe('2099');
});

test('daysAgo', () => {
    const local = new Date(2026, 10, 18);
    expect(daysAgo('2026-11-18', local)).toBe('Today');
    expect(daysAgo('2026-11-17', local)).toBe('Yesterday');
    expect(daysAgo('2026-11-09', local)).toBe('9 days ago');
    expect(daysAgo('2026-12-01', local)).toBe('');
    expect(daysAgo('soon', local)).toBe('');
});

// The test setup pins the time zone to America/New_York (UTC-5 in November).
const winter = new Date('2026-11-19T12:00:00Z');

test('UTC times are shown in the browser time zone', () => {
    expect(utcClock(10, 0, winter)).toBe('5am');
    expect(utcClock(13, 30, winter)).toBe('8:30am');
    expect(runStamp('2026-11-18-tracked-142633')).toBe('Nov 18, 9:26am');
    expect(runStamp('nope')).toBe('');
    expect(runWhen('2026-11-18-tracked-142633', new Date('2026-11-18T20:00:00'))).toBe('today at 9:26am');
});

test('cron schedules are shown in the browser time zone', () => {
    expect(scheduleText([1, 3, 5], [11], winter)).toBe('Mon/Wed/Fri 6am');
    expect(scheduleText(null, [10], winter)).toBe('daily 5am');
    expect(scheduleText(null, [4, 16], winter)).toBe('daily 11pm and 11am');
    expect(scheduleText([2, 4], [11], winter)).toBe('Tue/Thu 6am');
});

test('a time zone far from UTC can move a run to another weekday', () => {
    vi.stubEnv('TZ', 'Pacific/Auckland');
    try {
        // Monday 13:00 UTC is Tuesday 02:00 in Auckland (UTC+13 in November).
        expect(scheduleText([1], [13], winter)).toBe('Tue 2am');
        expect(scheduleText([2, 4], [11], winter)).toBe('Wed/Fri 12am');
    } finally {
        vi.stubEnv('TZ', 'America/New_York');
    }
});

test('fingerprintScore and isOutstanding', () => {
    expect(fingerprintScore('4/5; medium confidence')).toBe(4);
    expect(fingerprintScore('3')).toBe(3);
    expect(fingerprintScore('Unscored — thin evidence')).toBeNull();
    expect(fingerprintScore('Technical fit 4.5/5')).toBeNull();
    expect(isOutstanding({ fingerprint: '5/5' })).toBe(true);
    expect(isOutstanding({ fingerprint: '4/5; medium confidence' })).toBe(true);
    expect(isOutstanding({ fingerprint: '3/5' })).toBe(false);
    expect(isOutstanding({ fingerprint: 'Pace fail' })).toBe(false);
    for (const weak of ['4/5 provisional', '4/5; medium-low confidence', '4/5 company claims; thin independent evidence', '4/5; pace concern; medium confidence', '4; open salaries (company); unverified independently'])
        expect(isOutstanding({ fingerprint: weak }), weak).toBe(false);
    expect(hasRecentAwards('Inc. Best Workplaces 2021, 2023–2026', 2026)).toBe(true);
    expect(hasRecentAwards('Fortune Best Small Workplaces 2024, 2025', 2026)).toBe(true);
    expect(hasRecentAwards('Inc. Best Workplaces 2026', 2026)).toBe(false);
    expect(hasRecentAwards('Fortune Best Medium Workplaces 2023, 2024', 2026)).toBe(false);
    expect(hasRecentAwards('Outside Magazine 50 Best Places to Work, 2018–2024', 2026)).toBe(false);
});

test('payRange reads the first range, payEstimate marks an estimate', () => {
    expect(payRange({ pay: '$145,000–$195,000 base + equity' })).toEqual({ min: 145000, max: 195000, estimate: false });
    expect(payRange({ pay: '$160K - $190K' })).toEqual({ min: 160000, max: 190000, estimate: false });
    expect(payRange({ pay: '$200k – $220k' })).toEqual({ min: 200000, max: 220000, estimate: false });
    expect(payRange({ pay: '$180-210k' })).toEqual({ min: 180000, max: 210000, estimate: false });
    expect(payRange({ pay: '$185k' })).toEqual({ min: 185000, max: 185000, estimate: false });
    expect(payRange({ pay: 'Competitive' })).toBeNull();
    expect(payRange({ pay: '', payEstimate: { range: '$150k-$180k' } })).toEqual({ min: 150000, max: 180000, estimate: true });
});

test('payRange: hourly or non-annual pay reads as null, so it is never amber', () => {
    expect(payRange({ pay: '$80/hr' })).toBeNull();
    expect(payRange({ pay: '$95 per hour' })).toBeNull();
    expect(payRange({ pay: '$70-$90, hourly' })).toBeNull();
    expect(payRange({ pay: '$85 - $110' })).toBeNull();
    expect(belowFloor({ pay: '$80/hr' }, 170000)).toBe(false);
    expect(payRange({ pay: '$10,000/month' })).toBeNull();
});

test('payRange: an hourly mention elsewhere in the text does not hide the yearly range', () => {
    expect(payRange({ pay: '$180k–$210k; contractors $90/hr' })).toEqual({ min: 180000, max: 210000, estimate: false });
    expect(payRange({ pay: '$90/hr' })).toBeNull();
});

test('belowFloor: only a posted top end under $170k', () => {
    expect(belowFloor({ pay: '$140k–$165k' }, 170000)).toBe(true);
    expect(belowFloor({ pay: '$145,000–$195,000' }, 170000)).toBe(false);
    expect(belowFloor({ pay: '', payEstimate: { range: '$120k-$150k' } }, 170000)).toBe(false);
    expect(belowFloor({ pay: 'Competitive' }, 170000)).toBe(false);
});

test('belowFloor: a profile floor is used; no floor never flags', () => {
    expect(belowFloor({ pay: '$120k-$150k' }, 170000)).toBe(true);
    expect(belowFloor({ pay: '$120k-$150k' }, 100000)).toBe(false);
    expect(belowFloor({ pay: '$120k-$150k' }, null)).toBe(false);
});

test('rowStamp: the clock today, the date before today', () => {
    const now = new Date('2026-11-18T20:00:00');
    expect(rowStamp('2026-11-18-tracked-142633', now)).toBe('9:26am');
    expect(rowStamp('2026-11-17-tracked-142633', now)).toBe('Nov 17');
    expect(rowStamp(undefined, now)).toBe('');
});

describe('payRange: only yearly US dollars', () => {
    test('other currencies and monthly or weekly pay stay as text', () => {
        expect(payRange({ pay: '$250,000–$280,000 CAD' })).toBeNull();
        expect(payRange({ pay: 'CA$172K–CA$229K' })).toBeNull();
        expect(payRange({ pay: '$10,000/month' })).toBeNull();
        expect(payRange({ pay: '$1,200 weekly' })).toBeNull();
        expect(payRange({ pay: '$180k–$210k USD' })).toEqual({ min: 180000, max: 210000, estimate: false });
    });
});

test('a pay note with no number reads as no pay, so the estimate shows', () => {
    expect(shortPay({ pay: 'Not posted', payEstimate: { range: '$160k-$190k' } })).toBe('Est. $160k-$190k');
    expect(shortPay({ pay: 'Unverified — posting not readable' })).toBe('No salary posted');
    expect(payRange({ pay: 'Not posted', payEstimate: { range: '$160k-$190k' } })).toEqual({ min: 160000, max: 190000, estimate: true });
});

test('shortPay: a single salary inside a sentence shows the amount', () => {
    expect(shortPay({ pay: 'US base $181,130 + 15% target bonus (~$27,170)' })).toBe('$181,130');
});
