import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCompany } from '../lib/companies.js';
import { blankPosting } from '../lib/postingsFile.js';
import { activeApplication, isProtected, jobEntry, applicationFor, companyOf, hasActiveLead, pastOutcomes, squash, sameRole } from '../lib/tags.js';

const co = (extra = {}) => ({ ...blankCompany('Acme'), ...extra });
const post = (extra = {}) => ({ ...blankPosting({ id: 'key:abcd1234', companyKey: 'acme', leadKey: 'acme::seniorengineer', role: 'Senior Engineer', url: '', source: 'model' }), wasLead: true, ...extra });

test('jobEntry finds an entry by id, else by leadKey', () => {
    const entry = { state: 'skipped', leadKey: 'acme::seniorengineer' };
    assert.equal(jobEntry(co({ jobs: { 'greenhouse:1': entry } }), post()), entry);
    assert.equal(jobEntry(co({ jobs: { 'key:abcd1234': entry } }), post({ leadKey: 'x' })), entry);
    assert.equal(jobEntry(co(), post()), undefined);
});

test('isProtected: applied application or Ruled out stance', () => {
    assert.equal(isProtected(co({ applications: [{ outcome: 'applied' }] })), true);
    assert.equal(isProtected(co({ applications: [{ outcome: 'no response' }] })), false);
    assert.equal(isProtected(co({ stance: 'Ruled out' })), true);
    assert.deepEqual(activeApplication(co({ applications: [{ outcome: 'applied', id: 1 }] })), { outcome: 'applied', id: 1 });
});

test('applicationFor matches by postingId, else leadKey', () => {
    const byId = { postingId: 'key:abcd1234' };
    const byKey = { leadKey: 'acme::seniorengineer' };
    assert.equal(applicationFor(co({ applications: [byId] }), post()), byId);
    assert.equal(applicationFor(co({ applications: [byKey] }), post()), byKey);
});

test('companyOf matches key and alias keys', () => {
    const a = co({ aliases: ['Acme Labs'] });
    assert.equal(companyOf([a], post()), a);
    assert.equal(companyOf([a], post({ companyKey: 'acmelabs' })), a);
    assert.equal(companyOf([a], post({ companyKey: 'zed' })), undefined);
});

test('hasActiveLead', () => {
    assert.equal(hasActiveLead(co({ applications: [{ outcome: 'applied', postingId: 'key:abcd1234' }] }), [post()]), false);
    assert.equal(hasActiveLead(co(), [post({ posted: 'no' })]), false);
    assert.equal(hasActiveLead(co(), [post({ wasLead: false })]), false);
    assert.equal(hasActiveLead(co({ jobs: { 'key:abcd1234': { state: 'skipped', leadKey: 'acme::seniorengineer' } } }), [post()]), false);
    assert.equal(hasActiveLead(co({ jobs: { 'key:abcd1234': { state: 'saved', leadKey: 'acme::seniorengineer' } } }), [post()]), true);
    assert.equal(hasActiveLead(co({ jobs: { 'key:abcd1234': { state: 'applying', leadKey: 'acme::seniorengineer' } } }), [post()]), true);
    assert.equal(hasActiveLead(co(), [post()]), true);
    assert.equal(hasActiveLead(co(), [post({ companyKey: 'other' })]), false);
});

test('pastOutcomes lists closed applications', () => {
    const c = co({ applications: [
        { outcome: 'rejected', outcomeOn: '2026-11-01' }, { outcome: 'passed', outcomeOn: '2026-11-02' },
        { outcome: 'no response', outcomeOn: '2026-11-03' }, { outcome: 'applied' },
    ] });
    assert.deepEqual(pastOutcomes(c), ['Rejected 2026-11-01', 'Passed 2026-11-02', 'No response 2026-11-03']);
});

test('squash and sameRole', () => {
    assert.equal(squash('Senior Engineer (Remote)'), 'seniorengineer');
    assert.equal(sameRole('seniorengineer', 'seniorengineerplatform'), true);
    assert.equal(sameRole('staff', 'seniorstaff'), false);
});
