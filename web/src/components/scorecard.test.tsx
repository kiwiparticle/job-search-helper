import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RunLead } from '../model';
import { posting } from '../test-fixtures';
import { mergedChecks, Scorecard } from './Scorecard';

const stubProfile = (profile: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(profile))));
beforeEach(() => stubProfile({ payFloor: 170000, currency: 'USD' }));
afterEach(() => vi.unstubAllGlobals());

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const lead = (claude: string, codex: string): RunLead => ({
    key: 'k', company: 'X Corp', role: 'Staff Engineer', foundBy: 'both',
    opinions: { claude: { verdict: 'Lead', checks: [{ label: 'Pay', mark: claude, value: 'a' }] }, codex: { verdict: 'Pass', checks: [{ label: 'Pay', mark: codex, value: 'b' }] } },
});

test('mergedChecks: models that disagree on a mark differ, else the shared mark', () => {
    expect(mergedChecks(lead('good', 'unknown'))).toMatchObject([{ label: 'Pay', mark: 'differ' }]);
    expect(mergedChecks(lead('good', 'good'))).toMatchObject([{ label: 'Pay', mark: 'good' }]);
});

test('a posted range shows short with a bar against the floor', async () => {
    const { container } = wrap(<Scorecard posting={posting({ pay: '$145,000–$195,000' })} lead={lead('good', 'unknown')} />);
    expect(screen.getByText('$145–195k')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Pay range against the $170k floor' })).toBeInTheDocument();
    expect(screen.getByText('Claude: Lead · Codex: Pass')).toBeInTheDocument();
    expect(screen.getByText('models differ on 1')).toBeInTheDocument();
    expect(container.querySelector('.sc-check')).toHaveTextContent('≠ Pay');
});

test('with no floor in the profile the bar has no floor marker or floor text', async () => {
    stubProfile({});
    const { container } = wrap(<Scorecard posting={posting({ pay: '$145,000–$195,000' })} />);
    expect(await screen.findByRole('img', { name: 'Pay range' })).toBeInTheDocument();
    expect(container.querySelector('.floor')).toBeNull();
});

test('pay that does not parse shows as written with no bar; an estimate is labelled and gets no bar', () => {
    const { unmount } = wrap(<Scorecard posting={posting({ pay: '€90k–€110k' })} />);
    expect(screen.getByText('€90k–€110k')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    wrap(<Scorecard posting={posting({ pay: '', payEstimate: { range: '$150k-$180k' } })} />);
    expect(screen.getByText('est.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
});

test('no write-up reads Not reviewed yet; the fit score shows its bucket name', () => {
    wrap(<Scorecard posting={posting({ fit: 4 })} />);
    expect(screen.getByText('Not reviewed yet')).toBeInTheDocument();
    expect(screen.getByText('Good fit')).toBeInTheDocument();
});

test('no fit score reads Not scored', () => {
    wrap(<Scorecard posting={posting()} />);
    expect(screen.getByText('Not scored')).toBeInTheDocument();
});

test('Scorecard shows the re-check movement and why', () => {
    const rescore = { at: '2026-11-25T15:00:00Z', by: 'claude', fitFrom: 3, fitTo: 4, fingerprintFrom: 2, fingerprintTo: 4, why: 'async counts' };
    const { unmount } = wrap(<Scorecard posting={posting({ fit: 4, rescore })} />);
    expect(screen.getByText('↑ 3→4 · fingerprint 2→4 · re-check Nov 25')).toBeInTheDocument();
    expect(screen.getByText('async counts')).toBeInTheDocument();
    unmount();
    const { unmount: u2 } = wrap(<Scorecard posting={posting({ fit: 3, rescore: { ...rescore, fitFrom: 3, fitTo: 3 } })} />);
    expect(screen.getByText('fingerprint 2→4 · re-check Nov 25')).toBeInTheDocument();
    u2();
    wrap(<Scorecard posting={posting({ fit: 3, rescore: { ...rescore, fitFrom: 3, fitTo: 3, fingerprintTo: 2 } })} />);
    expect(screen.getByText('re-check Nov 25: no change')).toBeInTheDocument();
});

test('Scorecard hides the re-check line once a later change moved fit', () => {
    const rescore = { at: '2026-11-25T15:00:00Z', by: 'claude', fitFrom: 3, fitTo: 4, fingerprintFrom: 2, fingerprintTo: 4, why: 'async counts' };
    wrap(<Scorecard posting={posting({ fit: 2, rescore })} />);
    expect(screen.queryByText(/re-check/)).toBeNull();
    expect(screen.queryByText('async counts')).toBeNull();
});

test('a stored Remote / ZZ check and another searcher\'s Location show as one Location row', () => {
    const l: RunLead = { key: 'k', company: 'X', role: 'R', foundBy: 'both', opinions: {
        claude: { verdict: 'Lead', checks: [{ label: 'Remote / ZZ', mark: 'good', value: 'a' }] },
        codex: { verdict: 'Lead', checks: [{ label: 'Location', mark: 'good', value: 'b' }] } } };
    expect(mergedChecks(l)).toMatchObject([{ label: 'Location', mark: 'good', by: [{ id: 'claude' }, { id: 'codex' }] }]);
    expect(mergedChecks(l)[0].by.every((b) => b.check)).toBe(true);
});
