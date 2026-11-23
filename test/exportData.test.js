import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows } from '../lib/store.js';
import { parseCompanies, blankCompany } from '../lib/companies.js';
import { parsePostings, blankPosting } from '../lib/postingsFile.js';
import { exportData } from '../bin/export-data.js';

test('export output parses back to the rows in D1', async () => {
    const db = sqliteD1();
    await applySchema(db);
    const co = { ...blankCompany('Acme'), key: 'acme' };
    const p = blankPosting({ id: 'key:1', companyKey: 'acme', leadKey: 'acme::x', role: 'X', url: '', source: 'run' });
    await writeRows(db, {
        companies: [{ id: 'acme', version: null, record: co }],
        postings: [{ id: 'key:1', version: null, record: p }],
        history: [{ companyKey: 'acme', rows: [{ date: '2026-11-01', text: 'a' }, { date: '2026-11-02', text: 'b' }] }],
    });
    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    await exportData(db, dir);
    const read = (f) => readFileSync(join(dir, 'data', f), 'utf8');
    assert.deepEqual(parseCompanies(read('companies.jsonl')), (await loadAll(db, 'companies')).map((r) => r.record));
    assert.deepEqual(parsePostings(read('postings.jsonl')), (await loadAll(db, 'postings')).map((r) => r.record));
    assert.deepEqual(read('history.jsonl').trim().split('\n').map((l) => JSON.parse(l).text), ['a', 'b']);
});
