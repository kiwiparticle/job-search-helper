import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger, renderLedger, COLUMNS } from '../lib/ledger.js';

const SAMPLE = `# Job Search Ledger — Current State

One row per company.

| ${COLUMNS.join(' | ')} |
| ${COLUMNS.map(() => '---').join(' | ')} |
| Classgrove.world | Applied | Applied 2026-11-09; do not resurface | Unscored | Education |  |  | Applied to Senior Software Engineer. | Track response | 2026-11-09 |
| Initech | Watching | Watch | 3/5 | Office software | Best Places 2026 | Data Engineer (too junior) | No current role \\| maybe later. | New role | 2026-11-01 |

Trailing notes.
`;
const real = () => SAMPLE;
const table = (cell) => `# L\n\n| Company | Reason |\n| --- | --- |\n| Acme | ${cell} |\n\ntrailer\n`;

test('round-trips a ledger byte-for-byte', () => {
    const md = real();
    assert.equal(renderLedger(parseLedger(md)), md);
});

test('keeps an escaped pipe inside a cell', () => {
    const p = parseLedger(table('a \\| b'));
    assert.equal(p.rows[0].Reason, 'a | b');
    assert.match(renderLedger(p), /a \\\| b/);
});

test('finds Classgrove.world as Applied', () => {
    const row = parseLedger(real()).rows.find((r) => r.Company === 'Classgrove.world');
    assert.equal(row.Status, 'Applied');
});

test('an edited row re-renders, untouched rows keep their line', () => {
    const p = parseLedger(table('old'));
    p.rows[0].Reason = 'new';
    assert.equal(renderLedger(p), table('new'));
});

test('a new row renders in column order', () => {
    const p = parseLedger(table('x'));
    p.rows.push({ Company: 'Beta', Reason: 'y' });
    assert.match(renderLedger(p), /\| Acme \| x \|\n\| Beta \| y \|\n\ntrailer/);
});

test('COLUMNS matches the ledger header', () => {
    assert.deepEqual(parseLedger(real()).columns, COLUMNS);
});
