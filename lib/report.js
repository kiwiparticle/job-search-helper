import { NEAR_MISS_VERDICTS } from './mergeCandidates.js';

const ORDER = ['Strong apply', 'Worth interviewing', 'Human review needed', 'Interesting but concerning'];
const lower = (s) => String(s ?? '').toLowerCase();
const isNearMiss = (l) => NEAR_MISS_VERDICTS.some((v) => lower(l.finalVerdict).startsWith(lower(v)));
const rank = (l) => {
    const i = ORDER.findIndex((v) => lower(l.finalVerdict).startsWith(lower(v)));
    return i < 0 ? ORDER.length : i;
};

export const splitLeads = (leads) => ({
    shown: leads.filter((l) => !isNearMiss(l)).sort((a, b) => rank(a) - rank(b)),
    nearMisses: leads.filter(isNearMiss),
});

export function buildReport({ run, workflow, finishedAt = new Date().toISOString(), models, labels, leads, changes, held = [], refused, notes = [] }) {
    const { shown, nearMisses } = splitLeads(leads);
    return {
        run, workflow, finishedAt, models, ...(labels && { labels }), leads: shown, nearMisses, changes, held, refused, notes,
        counts: { leads: shown.length, nearMisses: nearMisses.length, changes: changes.length },
    };
}

const opinion = (name, op) => (op ? `- ${name}: ${op.verdict}. ${op.note}` : `- ${name}: not reviewed`);
// Old reports carry only top-level claude/codex opinions.
const opinionsOf = (l) => l.opinions ?? { claude: l.claude, codex: l.codex };
const LEGACY_LABELS = { claude: 'Claude', codex: 'Codex' };

const leadMd = (l, label) => [
    `### ${l.company} — ${l.role}`,
    `Verdict: ${l.finalVerdict}. Found by: ${l.foundBy}.${l.reviewed ? '' : ' Unreviewed.'}`,
    l.postingState && `Board check ${l.postingCheckedAt}: ${{ live: 'listed on the board', closed: 'not on the board', unknown: 'could not check' }[l.postingState]}.`,
    l.pay && `Pay: ${l.pay}`,
    l.facts,
    ...Object.entries(opinionsOf(l)).map(([id, op]) => opinion(label(id), op)),
    ...l.questions.map((q) => `- Ask: ${q}`),
    l.url && `Link: ${l.url}`,
].filter(Boolean).join('\n');

const show = (v) => (Array.isArray(v) ? v.join('; ') : String(v ?? '') || 'empty');
const changeMd = (c) => `- ${c.company}: ${Object.entries(c.fields ?? {}).map(([f, { from, to }]) => `${f} ${show(from)} → ${show(to)}`).join('; ') || 'new company'} (${c.by})`;
const heldMd = (c) => `- ${c.company}: ${c.reason}`;

export function renderReportMd(r) {
    const label = (id) => r.labels?.[id] ?? LEGACY_LABELS[id] ?? id;
    const models = Object.entries(r.models ?? {}).filter(([, v]) => v.status).map(([m, v]) => `${label(m)} ${v.status}${v.reason ? ` (${v.reason})` : ''}`).join(', ');
    const out = [
        `Models: ${models || 'unknown'}. ${r.counts.leads} leads, ${r.counts.nearMisses} near misses, ${r.counts.changes} company changes.`,
        '',
        '## Leads',
        r.leads.length ? r.leads.map((l) => leadMd(l, label)).join('\n\n') : 'Nothing new.',
        '',
        '## Near misses',
        r.nearMisses.length ? r.nearMisses.map((l) => `- ${l.company} — ${l.role}: ${Object.values(opinionsOf(l)).find((o) => o?.note)?.note ?? ''}${l.postingState === 'closed' ? ` (not on the board, checked ${l.postingCheckedAt})` : ''} ${l.url ?? ''}`.trim()).join('\n') : 'None.',
    ];
    if (r.changes.length) out.push('', '## Company changes', r.changes.map(changeMd).join('\n'));
    if (r.held.length) out.push('', '## Held for your decision', r.held.map(heldMd).join('\n'));
    if (r.refused.length) out.push('', '## Not changed', r.refused.map((c) => `- ${c.company}: ${c.reason} (${c.by})`).join('\n'));
    if (r.notes?.length) out.push('', '## Notes', r.notes.map((n) => `- ${n}`).join('\n'));
    return out.join('\n') + '\n';
}
