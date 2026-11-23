import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQueue, jobsList, nowPass, savedGroups, droppedFromSaved, rescoreCount } from '../lib/newQueue.js';
import { blankCompany } from '../lib/companies.js';
import { blankPosting } from '../lib/postingsFile.js';

const co = (name, extra = {}) => ({ ...blankCompany(name), stance: 'Watching', ...extra });
const post = (extra = {}) => ({ ...blankPosting({ id: 'key:p1', companyKey: 'acme', leadKey: 'acme::staffengineer', role: 'Staff Engineer', url: '', source: 'run' }), wasLead: true, modelSays: 'lead', ...extra });
const acme = co('Acme');

test('lead: an undisputed lead with no job state is a job item', () => {
    assert.deepEqual(newQueue([acme], [post()]), [{ kind: 'lead', about: 'job', company: 'Acme', postingId: 'key:p1' }]);
});

test('lead: a job entry (saved or skipped) takes the posting out of New, matched by leadKey too', () => {
    const jobs = { 'greenhouse:1': { state: 'skipped', leadKey: 'acme::staffengineer', at: '2026-11-10' } };
    const companies = [co('Acme', { jobs })];
    assert.deepEqual(newQueue(companies, [post()]), []);
    assert.deepEqual(newQueue([co('Acme', { jobs: { 'key:p1': { state: 'saved', at: '2026-11-10' } } })], [post()]), []);
});

test('lead: a skipped job with the same leadKey hides a new posting, in New and in Jobs', () => {
    const companies = [co('Acme', { jobs: { 'greenhouse:1': { state: 'skipped', leadKey: 'acme::staffengineer', at: '2026-11-10' } } })];
    assert.deepEqual(newQueue(companies, [post()]), []);
    assert.deepEqual(jobsList(companies, [post()]), []);
});

test('lead: any application for the role (rejected too) takes it out of New', () => {
    const companies = [co('Acme', { applications: [{ id: 'a1', postingId: 'key:p1', role: 'Staff Engineer', outcome: 'rejected' }] })];
    assert.deepEqual(newQueue(companies, [post()]), []);
});

test('lead: a lead the models later pass on (modelSays pass) with no entry is still a lead item', () => {
    assert.deepEqual(newQueue([acme], [post({ modelSays: 'pass' })]), [{ kind: 'lead', about: 'job', company: 'Acme', postingId: 'key:p1' }]);
});

test('lead: not a lead when not wasLead, posted no, Ruled out, or the company has an active application', () => {
    assert.deepEqual(newQueue([acme], [post({ wasLead: false })]), []);
    assert.deepEqual(newQueue([acme], [post({ posted: 'no' })]), []);
    assert.deepEqual(newQueue([co('Acme', { stance: 'Ruled out' })], [post()]), []);
    assert.deepEqual(newQueue([co('Acme', { applications: [{ id: 'a1', outcome: 'applied', leadKey: 'other' }] })], [post()]), []);
});

test('companies: New lists no company on its own, stanced or not', () => {
    assert.deepEqual(newQueue([co('Acme', { stance: '' }), co('Made', { stanceBy: 'claude', newFromRun: true })], []), []);
});

test('held: a ruled-out company has no held item', () => {
    assert.deepEqual(newQueue([co('Acme', { stance: 'Ruled out', heldUpdate: { run: 'r2' } })], []), []);
});

test('duplicate: possibleDuplicateOf is a company item', () => {
    assert.deepEqual(newQueue([co('Quillfeather PBC', { possibleDuplicateOf: 'quillfeather' })], []), [{ kind: 'duplicate', about: 'company', company: 'Quillfeather PBC' }]);
});

test('gone: a saved job whose posting went gone after its seenGone is a gone item', () => {
    const companies = [co('Acme', { jobs: { 'key:p1': { state: 'saved', at: '2026-11-01', seenGone: '2026-11-10' } } })];
    assert.deepEqual(newQueue(companies, [post({ goneAt: '2026-11-20' })]), [{ kind: 'gone', about: 'job', company: 'Acme', postingId: 'key:p1' }]);
});

test('gone: the same goneAt already seen is not a gone item', () => {
    const companies = [co('Acme', { jobs: { 'key:p1': { state: 'saved', at: '2026-11-01', seenGone: '2026-11-10' } } })];
    assert.deepEqual(newQueue(companies, [post({ goneAt: '2026-11-10' })]), []);
});

test('gone: an open application counts too; a rejected application does not', () => {
    const applied = [co('Acme', { applications: [{ id: 'a1', postingId: 'key:p1', outcome: 'applied', seenGone: '' }] })];
    assert.deepEqual(newQueue(applied, [post({ goneAt: '2026-11-20' })]), [{ kind: 'gone', about: 'job', company: 'Acme', postingId: 'key:p1' }]);
    const rejected = [co('Acme', { applications: [{ id: 'a1', postingId: 'key:p1', outcome: 'rejected' }] })];
    assert.deepEqual(newQueue(rejected, [post({ goneAt: '2026-11-20' })]), []);
});

test('proposal: one item per proposal, by its id', () => {
    const companies = [co('Acme', { proposals: [{ id: 'q1' }, { id: 'q2' }] })];
    assert.deepEqual(newQueue(companies, []), [
        { kind: 'proposal', about: 'company', company: 'Acme', proposalId: 'q1' },
        { kind: 'proposal', about: 'company', company: 'Acme', proposalId: 'q2' },
    ]);
});

test('duplicate: hidden when both websites are known and on different hosts', () => {
    const pair = (w1, w2) => newQueue([co('Plankwise', { possibleDuplicateOf: 'plank', website: w1 }), co('Plank', { website: w2 })], []).length;
    assert.equal(pair('https://plankwise.com', 'https://plank.com/'), 0);
    assert.equal(pair('https://www.plank.com', 'plank.com'), 1);
    assert.equal(pair('', 'https://plank.com/'), 1);
});

test('order: kind (lead, duplicate, gone, proposal), then company name', () => {
    const companies = [
        co('Zed'),
        co('Mid'),
        co('Aaa', { proposals: [{ id: 'q' }], jobs: { g: { state: 'saved', at: '2026-11-01' } } }),
        co('Bee', { stance: '' }),
        co('Acme', { possibleDuplicateOf: 'x' }),
    ];
    const postings = [
        post({ id: 'z', companyKey: 'zed' }),
        post({ id: 'm', companyKey: 'mid', disputed: true }),
        post({ id: 'g', companyKey: 'aaa', goneAt: '2026-11-20' }),
    ];
    const got = newQueue(companies, postings).map((i) => `${i.kind}:${i.company}`);
    assert.deepEqual(got, ['lead:Mid', 'lead:Zed', 'duplicate:Acme', 'gone:Aaa', 'proposal:Aaa']);
});

test('nothing reads a run list or a date: the result is the same with Date.now broken', () => {
    const realNow = Date.now;
    Date.now = () => { throw new Error('clock read'); };
    try {
        assert.equal(newQueue.length, 2);
        assert.equal(newQueue([acme], [post()]).length, 1);
    } finally {
        Date.now = realNow;
    }
});

test('jobsList: a posting is listed when it is a lead or has a saved entry, and not skipped, posted no, or Ruled out', () => {
    const companies = [co('Acme'), co('Saved Co', { key: 'savedco' }), co('Out', { stance: 'Ruled out' })];
    const lead = post({ id: 'key:lead', companyKey: 'acme' });
    const saved = post({ id: 'key:saved', companyKey: 'savedco', wasLead: false, leadKey: 'x' });
    const savedCo = companies[1];
    savedCo.jobs = { 'key:saved': { state: 'saved', at: '2026-11-01' } };
    const skipped = post({ id: 'key:skip', companyKey: 'acme', leadKey: 'skip' });
    companies[0].jobs = { 'key:skip': { state: 'skipped', at: '2026-11-01' } };
    const gone = post({ id: 'key:gone', companyKey: 'acme', leadKey: 'gone', posted: 'no' });
    const out = post({ id: 'key:out', companyKey: 'out', leadKey: 'out' });
    const got = jobsList(companies, [lead, saved, skipped, gone, out]).map((r) => r.posting.id);
    assert.deepEqual(got, ['key:lead', 'key:saved']);
    assert.equal(jobsList(companies, [saved])[0].entry.state, 'saved');
});

test('nowPass: true only for a lead the models now say pass on', () => {
    assert.equal(nowPass(post({ modelSays: 'pass' })), true);
    assert.equal(nowPass(post({ modelSays: 'lead' })), false);
    assert.equal(nowPass(post({ modelSays: 'pass', wasLead: false })), false);
});

test('flagged companies and jobs come first, newest first, and a flagged lead is not listed twice', () => {
    const companies = [
        co('A', { key: 'a', flag: { at: '2026-11-20' } }),
        co('B', { key: 'b', jobFlags: { 'key:p1': { at: '2026-11-22', role: 'Sr', leadKey: 'b::sr' } } }),
    ];
    const postings = [post({ id: 'key:p1', companyKey: 'b', leadKey: 'b::sr', role: 'Sr' })];
    assert.deepEqual(newQueue(companies, postings).map((i) => [i.kind, i.company, i.postingId]), [['flagged', 'B', 'key:p1'], ['flagged', 'A', undefined]]);
});

test('a flagged job with no posting row still shows', () => {
    const companies = [co('B', { key: 'b', jobFlags: { gone1: { at: '2026-11-22', role: 'Sr', leadKey: 'b::sr' } } })];
    assert.deepEqual(newQueue(companies, []).map((i) => i.postingId), ['gone1']);
});

test('savedGroups groups saved jobs by company, best fit first, with movement and gone', () => {
    const companies = [
        { name: 'Low', key: 'low', stance: 'Watching', jobs: { l1: { state: 'saved', role: 'Dev', leadKey: 'low::dev', at: '2026-11-20' } } },
        { name: 'Top', key: 'top', stance: 'Watching', jobFlags: { t2: { at: '2026-11-22', role: 'B', leadKey: 'top::b' } }, jobs: {
            t1: { state: 'saved', role: 'A', leadKey: 'top::a', at: '2026-11-20' },
            t2: { state: 'saved', role: 'B', leadKey: 'top::b', at: '2026-11-21' },
            t3: { state: 'skipped', role: 'C', leadKey: 'top::c', at: '2026-11-21' },
        } },
        { name: 'Out', key: 'out', stance: 'Ruled out', jobs: { o1: { state: 'saved', role: 'X', leadKey: 'out::x', at: '2026-11-20' } } },
    ];
    const postings = [
        { id: 't1', companyKey: 'top', leadKey: 'top::a', role: 'A', fit: 4, rescore: { fitFrom: 3, fitTo: 4 } },
        { id: 't2', companyKey: 'top', leadKey: 'top::b', role: 'B', fit: 5, posted: 'no' },
        { id: 'l1', companyKey: 'low', leadKey: 'low::dev', role: 'Dev', fit: 2, rescore: { fitFrom: 3, fitTo: 2 } },
    ];
    const groups = savedGroups(companies, postings);
    assert.deepEqual(groups.map((g) => [g.company, g.best]), [['Top', 5], ['Low', 2]]);
    assert.deepEqual(groups[0].roles.map((r) => [r.postingId, r.fit, r.move, r.gone, r.flagged]), [['t2', 5, null, true, true], ['t1', 4, 'up', false, false]]);
    assert.equal(groups[1].roles[0].move, 'down');
    assert.deepEqual(groups[0].roles.map((r) => r.postingRowId), ['t2', 't1']);
});

test('savedGroups keeps a saved job with no posting row and puts unscored companies last', () => {
    const companies = [
        { name: 'Bare', key: 'bare', stance: 'Watching', jobs: { b1: { state: 'saved', role: 'Hand added', leadKey: 'bare::handadded', at: '2026-11-20' } } },
        { name: 'Scored', key: 'scored', stance: 'Watching', jobs: { s1: { state: 'saved', role: 'S', leadKey: 'scored::s', at: '2026-11-20' } } },
    ];
    const groups = savedGroups(companies, [{ id: 's1', companyKey: 'scored', leadKey: 'scored::s', role: 'S', fit: 3 }]);
    assert.deepEqual(groups.map((g) => g.company), ['Scored', 'Bare']);
    assert.deepEqual(groups[1].roles[0], { postingId: 'b1', role: 'Hand added', fit: null, move: null, gone: false, flagged: false, hasPosting: false, postingRowId: null });
});

test('savedGroups leaves out a saved job with its own application', () => {
    const companies = [{ name: 'A', key: 'a', stance: 'Watching', applications: [{ id: 'x', postingId: 'a1', leadKey: 'a::r', role: 'R', outcome: 'applied', appliedOn: '2026-11-20' }],
        jobs: { a1: { state: 'saved', role: 'R', leadKey: 'a::r', at: '2026-11-20' }, a2: { state: 'saved', role: 'Q', leadKey: 'a::q', at: '2026-11-20' } } }];
    assert.deepEqual(savedGroups(companies, [])[0].roles.map((r) => r.postingId), ['a2']);
});

test('droppedFromSaved lists skipped jobs that were saved, newest first', () => {
    const companies = [
        { name: 'A', key: 'a', stance: 'Watching', jobs: { a1: { state: 'skipped', role: 'R', leadKey: 'a::r', at: '2026-11-21', fromSaved: '2026-11-21', reasons: [{ state: 'skipped', reason: 'Too big', at: '2026-11-21' }] },
            a2: { state: 'skipped', role: 'Q', leadKey: 'a::q', at: '2026-11-22' } } },
        { name: 'B', key: 'b', stance: 'Watching', jobs: { b1: { state: 'skipped', role: 'S', leadKey: 'b::s', at: '2026-11-22', fromSaved: '2026-11-22' } } },
        { name: 'C', key: 'c', stance: 'Ruled out', jobs: { c1: { state: 'skipped', role: 'T', leadKey: 'c::t', at: '2026-11-23', fromSaved: '2026-11-23' } } },
    ];
    const dropped = droppedFromSaved(companies);
    assert.deepEqual(dropped.map((d) => d.postingId), ['b1', 'a1']);
    assert.deepEqual(dropped.map((d) => d.fromSaved), ['2026-11-22', '2026-11-21']);
});

test('rescoreCount counts saved and flagged jobs with a posting, once each', () => {
    const companies = [
        { name: 'A', key: 'a', stance: 'Watching', jobFlags: { a1: { at: 'x' }, a2: { at: 'x' }, a9: { at: 'x' } }, jobs: { a1: { state: 'saved', role: 'X', leadKey: 'a::x' }, a3: { state: 'saved', role: 'Q', leadKey: 'a::q' } } },
        { name: 'Out', key: 'out', stance: 'Ruled out', jobs: { o1: { state: 'saved', role: 'X', leadKey: 'o::x' } } },
    ];
    const postings = [
        { id: 'a1', companyKey: 'a', leadKey: 'a::x' }, { id: 'a2', companyKey: 'a', leadKey: 'a::y' },
        { id: 'o1', companyKey: 'out', leadKey: 'o::x' },
    ];
    assert.equal(rescoreCount(companies, postings), 2); // a1 (saved and flagged) + a2 (flagged); a3 has no posting
});

test('applying jobs come right after flagged, newest first, and leave once applied', () => {
    const companies = [
        { name: 'A', key: 'a', stance: 'Watching', jobs: { a1: { state: 'applying', role: 'R', leadKey: 'a::r', at: '2026-11-21' } } },
        { name: 'B', key: 'b', stance: 'Watching', flag: { at: '2026-11-20' }, jobs: { b1: { state: 'applying', role: 'S', leadKey: 'b::s', at: '2026-11-22' } } },
        { name: 'C', key: 'c', stance: 'Watching', applications: [{ id: 'x', postingId: 'c1', leadKey: 'c::t', role: 'T', outcome: 'applied', appliedOn: '2026-11-22' }],
            jobs: { c1: { state: 'applying', role: 'T', leadKey: 'c::t', at: '2026-11-22' } } },
    ];
    const items = newQueue(companies, []);
    assert.deepEqual(items.map((i) => [i.kind, i.postingId]), [['flagged', undefined], ['applying', 'b1'], ['applying', 'a1']]);
});

test('an applying job stays on the Jobs list and counts for taken-down postings', () => {
    const companies = [{ name: 'A', key: 'a', stance: 'Watching', jobs: { a1: { state: 'applying', role: 'R', leadKey: 'a::r', at: '2026-11-21' } } }];
    const postings = [{ id: 'a1', companyKey: 'a', leadKey: 'a::r', role: 'R', wasLead: false, goneAt: '2026-11-22', posted: 'no' }];
    assert.equal(newQueue(companies, postings).some((i) => i.kind === 'gone' && i.postingId === 'a1'), true);
    const live = [{ ...postings[0], goneAt: undefined, posted: undefined }];
    assert.equal(jobsList(companies, live).length, 1);
});

test('a closed application for an earlier posting with the same title does not hide a new one', () => {
    const closed = { id: 'x', postingId: 'g1', leadKey: 'a::r', role: 'R', outcome: 'rejected', appliedOn: '2026-10-01' };
    const companies = [{ name: 'A', key: 'a', stance: 'Watching', applications: [closed],
        jobs: { g2: { state: 'applying', role: 'R', leadKey: 'a::r', at: '2026-11-21' }, g3: { state: 'saved', role: 'R', leadKey: 'a::r', at: '2026-11-21' } } }];
    const postings = [{ id: 'g2', companyKey: 'a', leadKey: 'a::r', role: 'R' }, { id: 'g3', companyKey: 'a', leadKey: 'a::r', role: 'R', fit: 4, rescore: { fitFrom: 3, fitTo: 5 } }];
    assert.deepEqual(newQueue(companies, postings).filter((i) => i.kind === 'applying').map((i) => i.postingId), ['g2']);
    const [role] = savedGroups(companies, postings)[0].roles;
    // A later search set fit 4 over the re-check's 5: no arrow.
    assert.deepEqual([role.postingId, role.move], ['g3', null]);
    // An open one for the same title still holds them back.
    companies[0].applications = [{ ...closed, outcome: 'applied' }];
    assert.deepEqual(newQueue(companies, postings).filter((i) => i.kind === 'applying'), []);
});
