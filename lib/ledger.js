import { activeApplication, hasActiveLead } from './tags.js';

export const COLUMNS = ['Company', 'Status', 'Verdict', 'Fingerprint', 'Domain', 'Awards', 'Roles skipped', 'Reason', 'Re-check trigger', 'Last checked'];

const ORIGINAL = Symbol('original');

const splitCells = (line) => {
    const cells = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
        if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    cells.push(cur.trim());
    return cells.slice(1, -1);
};

const escapeCell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

export const rowCells = (row) => splitCells(row[ORIGINAL].line);

const rowKey = (row, columns) => JSON.stringify(columns.map((c) => row[c] ?? ''));

export function parseLedger(md) {
    const lines = md.split('\n');
    const head = lines.findIndex((l, i) => l.startsWith('|') && /^\|\s*-/.test(lines[i + 1] ?? ''));
    if (head < 0) throw new Error('ledger table not found');
    const columns = splitCells(lines[head]);
    let end = head + 2;
    while (end < lines.length && lines[end].startsWith('|')) end++;
    const rows = lines.slice(head + 2, end).map((line) => {
        const cells = splitCells(line);
        const row = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));
        Object.defineProperty(row, ORIGINAL, { value: { line, key: rowKey(row, columns) } });
        return row;
    });
    return {
        before: lines.slice(0, head + 2).join('\n'),
        columns,
        rows,
        after: lines.slice(end).join('\n'),
    };
}

export function renderLedger({ before, columns, rows, after }) {
    const body = rows.map((row) => {
        const orig = row[ORIGINAL];
        if (orig && orig.key === rowKey(row, columns)) return orig.line;
        return `| ${columns.map((c) => escapeCell(row[c])).join(' | ')} |`;
    });
    return [before, ...body, after].join('\n');
}

const LEDGER_STATUS = { 'Ruled out': 'Ruled out (company)' };
const HEADER = `# Job Search Ledger — Current State\n\n| ${COLUMNS.join(' | ')} |\n| ${COLUMNS.map(() => '---').join(' | ')} |`;

// Rollback path: D1 records -> today's ledger.md table. Skip current role is not reproduced.
// A ruled-out company stays Ruled out even if an old lead is still tagged: the old pipeline protects that status.
export function exportLedger(companies, postings, { before = HEADER, after = '' } = {}) {
    const rows = companies.map((c) => {
        const closed = (c.applications ?? []).filter((a) => a.outcome !== 'applied').sort((a, b) => (a.outcomeOn ?? a.appliedOn ?? '').localeCompare(b.outcomeOn ?? b.appliedOn ?? ''));
        const status = activeApplication(c) ? 'Applied'
            : closed.length ? 'Rejected'
                : c.stance !== 'Ruled out' && hasActiveLead(c, postings) ? 'Active lead'
                    : LEDGER_STATUS[c.stance] ?? c.stance;
        const notes = closed.flatMap((a) => (a.outcome === 'passed' ? [`Passed: ${a.reason ?? ''}`.trim()] : a.outcome === 'no response' ? ['No response'] : []));
        const skipped = Object.values(c.jobs ?? {}).filter((j) => j.state === 'skipped').map((j) => j.note ?? j.role);
        return {
            Company: c.name,
            Status: status,
            Verdict: c.verdict ?? '',
            Fingerprint: c.fingerprint ?? '',
            Domain: c.domain ?? '',
            Awards: c.awards ?? '',
            'Roles skipped': [...new Set([...(c.rolesSkipped ?? []), ...skipped])].join('; '),
            Reason: [c.reason, ...notes].filter(Boolean).join('; '),
            'Re-check trigger': c.recheckTrigger ?? '',
            'Last checked': c.lastChecked ?? '',
        };
    });
    return renderLedger({ before, columns: COLUMNS, rows, after });
}
