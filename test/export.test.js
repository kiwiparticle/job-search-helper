import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger, exportLedger, COLUMNS } from '../lib/ledger.js';
import { blankCompany } from '../lib/companies.js';
import { blankPosting } from '../lib/postingsFile.js';

const co = (name, o = {}) => ({ ...blankCompany(name), stance: 'Watching', ...o });
const app = (o = {}) => ({ id: 'a1', role: 'Staff', appliedOn: '2026-10-01', outcome: 'applied', ...o });
const exported = (companies, postings = []) => parseLedger(exportLedger(companies, postings)).rows;
const status = (c, postings) => exported([c], postings)[0].Status;

test('status: application first, then rejected, active lead, then the stance', () => {
    const lead = { ...blankPosting({ id: 'p', companyKey: 'acme', leadKey: 'acme::x', role: 'X', url: '', source: 'run' }), wasLead: true };
    assert.equal(status(co('Acme', { applications: [app()] }), [lead]), 'Applied');
    assert.equal(status(co('Acme', { applications: [app({ outcome: 'rejected' })] })), 'Rejected');
    assert.equal(status(co('Acme', { applications: [app({ outcome: 'rejected' })] }), [lead]), 'Rejected');
    assert.equal(status(co('Acme'), [lead]), 'Active lead');
    assert.equal(status(co('Acme', { stance: 'Ruled out' }), []), 'Ruled out (company)');
    assert.equal(status(co('Acme', { stance: 'Dormant' })), 'Dormant');
    assert.equal(status(co('Acme', { stance: 'Watching', jobs: { p: { state: 'saved', role: 'X', leadKey: 'acme::x', at: 'd' } } }), [lead]), 'Active lead');
});

test('passed and no response go into the Reason as text', () => {
    const c = co('Acme', { reason: 'why', applications: [app({ id: 'a', outcome: 'passed', reason: 'pay too low', outcomeOn: '2026-10-02' }), app({ id: 'b', outcome: 'no response', outcomeOn: '2026-10-03' })] });
    const [r] = exported([c]);
    assert.equal(r.Reason, 'why; Passed: pay too low; No response');
    assert.equal(r.Status, 'Rejected');
    assert.equal(status(co('Acme', { applications: [app({ outcome: 'passed', reason: 'took another offer' })] })), 'Rejected');
    assert.equal(exported([co('Acme', { applications: [app({ outcome: 'no response' })] })])[0].Reason, 'No response');
});

test('a skipped job entry is appended to Roles skipped', () => {
    const c = co('Acme', { rolesSkipped: ['Old role'], jobs: { p: { state: 'skipped', role: 'Staff', leadKey: 'acme::staff', at: 'd' }, q: { state: 'saved', role: 'Kept', at: 'd' } } });
    assert.equal(exported([c])[0]['Roles skipped'], 'Old role; Staff');
});

test('columns carry over and header and footer are kept', () => {
    const c = co('Acme', { verdict: 'v', fingerprint: 'f', domain: 'd', awards: 'a', recheckTrigger: 't', lastChecked: '2026-11-01' });
    const [r] = exported([c]);
    assert.deepEqual(COLUMNS.map((k) => r[k]), ['Acme', 'Watching', 'v', 'f', 'd', 'a', '', '', 't', '2026-11-01']);
    const out = exportLedger([c], [], { before: 'H\n|a|\n|-|', after: '\nfoot' });
    assert.ok(out.startsWith('H\n') && out.endsWith('\nfoot'));
});
