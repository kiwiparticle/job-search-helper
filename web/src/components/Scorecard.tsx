import { CHECK_LABELS, checkLabel } from '../../../lib/checks.js';
import { FIT_LABEL, fitIndex, payRange, shortPay } from '../format';
import type { Check, Posting, RunLead } from '../model';
import { useFloor } from '../data';
import { opinionsOf, useModels } from '../models';
import { Tip } from './ui';

export type Mark = 'good' | 'concern' | 'unknown' | 'differ';
type Merged = { label: string; mark: Mark; by: { id: string; check?: Check }[] };

// One row per check any model made. Models that checked it but gave different marks differ.
export function mergedChecks(lead: Pick<RunLead, 'claude' | 'codex' | 'opinions'>): Merged[] {
    const says = opinionsOf(lead).map(([id, v]) => ({ id, checks: new Map((v.checks ?? []).map((c) => [checkLabel(c.label), c])) }));
    return (CHECK_LABELS as string[]).filter((l) => says.some((m) => m.checks.has(l))).map((label) => {
        const by = says.map((m) => ({ id: m.id, check: m.checks.get(label) }));
        const marks = new Set(by.flatMap((b) => (b.check ? [b.check.mark] : [])));
        return { label, by, mark: (marks.size > 1 ? 'differ' : [...marks][0]) as Mark };
    });
}

const ICON: Record<string, string> = { good: '✓', concern: '!', unknown: '?', differ: '≠' };
const SHORT: Record<string, string> = { 'Size / stability': 'Size' };
const LO = 100_000;
const HI = 300_000;
const at = (n: number) => `${(Math.min(Math.max((n - LO) / (HI - LO), 0), 1) * 100).toFixed(1)}%`;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const k = (n: number) => Math.round(n / 1000);

function PayBar({ min, max, floor }: { min: number; max: number; floor: number | null }) {
    const seg = (from: number, to: number, cls: string) => to > from && <i className={cls} style={{ left: at(from), right: `calc(100% - ${at(to)})` }} />;
    // With no floor the whole range reads as above it and no marker is drawn.
    const line = floor ?? 0;
    return (
        <div className="pay-bar" role="img" aria-label={floor == null ? 'Pay range' : `Pay range against the $${k(floor)}k floor`}>
            {seg(min, Math.min(max, line), 'below')}
            {seg(Math.max(min, line), max, 'above')}
            {min === max && <i className={min < line ? 'below dot' : 'above dot'} style={{ left: at(min) }} />}
            {floor != null && <i className="floor" style={{ left: at(floor) }} />}
        </div>
    );
}

// What the last re-check did to this job's fit, and why.
function Recheck({ r }: { r: NonNullable<Posting['rescore']> }) {
    const { fitFrom: from, fitTo: to } = r;
    const moved = from != null && to != null && from !== to;
    const when = `re-check ${dayOf(r.at)}`;
    const fpFrom = r.fingerprintFrom ?? null, fpTo = r.fingerprintTo ?? null;
    const fp = fpFrom !== fpTo ? ` · fingerprint ${fpFrom ?? '–'}→${fpTo ?? '–'}` : '';
    return (
        <>
            <span className={moved ? (to > from ? 'rescore-up' : 'rescore-down') : 'meta small'}>{moved ? `${to > from ? '↑' : '↓'} ${from}→${to}${fp} · ${when}` : fp ? `${fp.slice(3)} · ${when}` : `${when}: no change`}</span>
            {r.why && <span className="meta small">{r.why}</span>}
        </>
    );
}

// Pay, fit and checks at a glance, over the job pane. A job no model has written up yet still shows pay and fit.
export function Scorecard({ posting, lead, pending }: { posting: Posting; lead?: RunLead; pending?: boolean }) {
    const { label } = useModels();
    const floor = useFloor();
    const r = payRange(posting);
    const checks = lead ? mergedChecks(lead) : [];
    const differ = checks.filter((c) => c.mark === 'differ').length;
    const says = lead ? opinionsOf(lead) : [];
    const fits = says.filter(([, v]) => typeof v.fit === 'number');
    return (
        <div className="scorecard">
            <div className="sc-cell">
                <span className="sc-label">Pay{r?.estimate && <> <span>est.</span></>}</span>
                <span className="sc-big">{r ? (r.min === r.max ? `$${k(r.min)}k` : `$${k(r.min)}–${k(r.max)}k`) : shortPay(posting)}</span>
                {r && !r.estimate && <PayBar min={r.min} max={r.max} floor={floor} />}
            </div>
            <div className="sc-cell">
                <span className="sc-label">Fit</span>
                <span className="sc-big">{FIT_LABEL[fitIndex(posting.fit)]}</span>
                {posting.rescore && posting.fit === posting.rescore.fitTo && <Recheck r={posting.rescore} />}
                {fits.length > 0 && <span className="meta small">{fits.map(([id, v]) => `${label(id)} ${v.fit}`).join(' · ')}</span>}
            </div>
            <div className="sc-cell">
                <span className="sc-label">Checks</span>
                {pending ? <span className="meta">Loading…</span> : !lead ? <span className="meta">Not reviewed yet</span> : (
                    <>
                        <span className="sc-marks">
                            {checks.map((c) => (
                                <Tip key={c.label} text={`${c.label}: ${c.by.map((b) => `${label(b.id)} ${b.check ? `${b.check.mark}${b.check.value ? ` (${b.check.value})` : ''}` : 'not checked'}`).join(' · ')}`}>
                                    <span className="sc-check" tabIndex={0}><b className={`mk ${c.mark}`} aria-hidden="true">{ICON[c.mark] ?? '?'}</b> {SHORT[c.label] ?? c.label}</span>
                                </Tip>
                            ))}
                        </span>
                        <span className="meta small">{says.map(([id, v]) => `${label(id)}: ${typeof v.verdict === 'string' && v.verdict ? v.verdict : 'Not reviewed'}`).join(' · ')}</span>
                        {differ > 0 && <span className="meta small low">models differ on {differ}</span>}
                    </>
                )}
            </div>
        </div>
    );
}
