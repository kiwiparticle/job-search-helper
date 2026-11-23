import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../lib/ownerActions.js';
import { blankCompany } from '../lib/companies.js';
import { notesOf } from '../lib/notes.js';

const today = '2026-11-16';
const co = (over = {}) => ({ ...blankCompany('Ostrander'), ...over });
const app = (over = {}) => ({ id: 'a1', role: 'Staff Engineer', leadKey: 'ostrander::staffengineer', appliedOn: '2026-11-12', outcome: 'applied', ...over });
const job = { postingId: 'key:1', leadKey: 'ostrander::senior', role: 'Senior Engineer', url: 'https://x.example/1', today };
const throws = (fn, status, re, needsConfirm) => assert.throws(fn, (e) => e.status === status && re.test(e.message) && Boolean(e.needsConfirm) === Boolean(needsConfirm));
const lastEvent = (c) => c.events.at(-1);

test('setStance sets the stance and logs it; bad stance is 400', () => {
    const c = co({ stance: 'Watching' });
    A.setStance(c, { stance: 'Dormant', today });
    assert.equal(c.stance, 'Dormant');
    assert.deepEqual(c.events, [{ date: today, text: 'Stance Watching → Dormant' }]);
    throws(() => A.setStance(c, { stance: 'Nope', today }), 400, /stance/);
});

test('setStance needs confirm for Ruled out and for an active application', () => {
    const c = co({ stance: 'Watching' });
    throws(() => A.setStance(c, { stance: 'Ruled out', today }), 409, /Rule out/, true);
    A.setStance(c, { stance: 'Ruled out', confirmed: true, today });
    assert.equal(lastEvent(c).text, 'Stance Watching → Ruled out');
    const e = co({ stance: 'Watching' });
    A.setStance(e, { stance: 'Ruled out', ruleOutAsked: true, today });
    assert.equal(e.stance, 'Ruled out');
    const d = co({ applications: [app()] });
    throws(() => A.setStance(d, { stance: 'Ruled out', ruleOutAsked: true, today }), 409, /You applied/, true);
    throws(() => A.setStance(d, { stance: 'Dormant', today }), 409, /You applied for Staff Engineer on 2026-11-12/, true);
    assert.equal(d.stance, '');
    assert.equal(d.events.length, 0);
});

test('saveJob and skipJob write the job; stance Watching only when blank', () => {
    const c = co();
    A.saveJob(c, job);
    assert.deepEqual(c.jobs['key:1'], { state: 'saved', role: 'Senior Engineer', leadKey: 'ostrander::senior', url: 'https://x.example/1', at: today });
    assert.equal(c.stance, 'Watching');
    const d = co({ stance: 'Dormant' });
    A.skipJob(d, job);
    assert.equal(d.jobs['key:1'].state, 'skipped');
    assert.equal(d.stance, 'Dormant');
    assert.equal(lastEvent(d).text, 'Skipped Senior Engineer');
    throws(() => A.saveJob(co(), { ...job, url: 'javascript:alert(1)' }), 400, /http/);
    throws(() => A.saveJob(co(), { ...job, role: 'x'.repeat(201) }), 400, /Role/);
});

test('addJob computes the posting id and saves', () => {
    const c = co();
    A.addJob(c, { role: 'Staff Engineer', url: 'https://boards.greenhouse.io/ostrander/jobs/123', today });
    assert.equal(c.jobs['greenhouse:123'].state, 'saved');
    A.addJob(c, { role: 'Other Role', url: 'https://x.example/o', today });
    assert.equal(Object.keys(c.jobs).length, 2);
    assert.equal(c.events.length, 2);
    throws(() => A.addJob(c, { role: '', url: 'https://x.example/o', today }), 400, /Role/);
    throws(() => A.addJob(c, { role: 'R', today }), 400, /^Add a link to the job posting\.$/);
});

test('markApplied adds an application; the same id twice is 409 without confirm', () => {
    const c = co();
    const args = { applicationId: 'a1', postingId: 'key:1', role: 'Staff Engineer', today };
    A.markApplied(c, args);
    assert.equal(c.applications.length, 1);
    assert.equal(lastEvent(c).text, 'Applied for Staff Engineer');
    throws(() => A.markApplied(c, { ...args, confirmed: true }), 409, /already recorded/);
    assert.equal(c.applications.length, 1);
    throws(() => A.markApplied(c, { ...args, applicationId: 'a2', confirmed: true }), 409, /open application for this job/);
});

test('markApplied for a second job needs confirm naming the first; confirmed gives two', () => {
    const c = co({ applications: [app()] });
    const args = { applicationId: 'a2', postingId: 'key:2', role: 'Principal Engineer', today };
    throws(() => A.markApplied(c, args), 409, /^You applied for Staff Engineer on 2026-11-12\. Apply for this one too\?$/, true);
    assert.equal(c.applications.length, 1);
    A.markApplied(c, { ...args, confirmed: true });
    assert.equal(c.applications.length, 2);
});

test('setOutcome sets, reopens, and requires a reason for passed', () => {
    const c = co({ applications: [app()] });
    throws(() => A.setOutcome(c, { applicationId: 'a1', outcome: 'passed', today }), 400, /why/);
    A.setOutcome(c, { applicationId: 'a1', outcome: 'passed', reason: 'pay too low', today });
    assert.deepEqual([c.applications[0].outcome, c.applications[0].reason, c.applications[0].outcomeOn], ['passed', 'pay too low', today]);
    assert.equal(lastEvent(c).text, 'Passed: pay too low');
    A.setOutcome(c, { applicationId: 'a1', outcome: 'applied', today });
    assert.equal(c.applications[0].outcome, 'applied');
    assert.equal(c.applications[0].reason, undefined);
    A.setOutcome(c, { applicationId: 'a1', outcome: 'rejected', today });
    assert.equal(c.applications[0].outcomeOn, today);
    throws(() => A.setOutcome(c, { applicationId: 'a1', outcome: 'x', today }), 400, /outcome/);
    throws(() => A.setOutcome(c, { applicationId: 'zz', outcome: 'rejected', today }), 404, /application/);
});

test('deleteApplication always needs confirm', () => {
    const c = co({ applications: [app()] });
    throws(() => A.deleteApplication(c, { applicationId: 'a1', today }), 409, /Delete/, true);
    assert.equal(c.applications.length, 1);
    A.deleteApplication(c, { applicationId: 'a1', confirmed: true, today });
    assert.equal(c.applications.length, 0);
    throws(() => A.deleteApplication(c, { applicationId: 'a1', confirmed: true, today }), 404, /application/);
});

test('addPostingLink sets url, postingId and leadKey', () => {
    const c = co({ applications: [app({ leadKey: undefined })] });
    A.addPostingLink(c, { applicationId: 'a1', url: 'https://jobs.lever.co/ostrander/11111111-2222-3333-4444-555555555555', today });
    assert.equal(c.applications[0].postingId, 'lever:11111111-2222-3333-4444-555555555555');
    assert.equal(c.applications[0].leadKey, 'ostrander::staffengineer');
    throws(() => A.addPostingLink(c, { applicationId: 'a1', url: 'ftp://x', today }), 400, /http/);
    throws(() => A.addPostingLink(c, { applicationId: 'a1', url: '', today }), 400, /required/);
});

test('markSeen sets seenGone on matching jobs and applications', () => {
    const c = co({ jobs: { 'key:1': { state: 'saved', role: 'R' } }, applications: [app({ postingId: 'key:2' })] });
    A.markSeen(c, { postingIds: ['key:1', 'key:2', 'key:9'], goneAtById: { 'key:1': '2026-11-10', 'key:2': '2026-11-11' }, today });
    assert.equal(c.jobs['key:1'].seenGone, '2026-11-10');
    assert.equal(c.applications[0].seenGone, '2026-11-11');
    assert.equal(c.events.length, 1);
});

const proposal = () => ({ id: 'p1', by: 'claude', at: today, text: 't', base: { reason: 'old' }, changes: { reason: 'new' } });

test('applyProposal applies with the base check; dismissProposal just removes', () => {
    const c = co({ reason: 'old', proposals: [proposal(), { ...proposal(), id: 'p2' }] });
    A.applyProposal(c, { id: 'p1', today });
    assert.equal(c.reason, 'new');
    assert.deepEqual(c.proposals.map((p) => p.id), ['p2']);
    throws(() => A.applyProposal(c, { id: 'p2', today }), 409, /reason/);
    A.dismissProposal(c, { id: 'p2', today });
    assert.equal(c.proposals.length, 0);
    assert.equal(c.reason, 'new');
    assert.equal(c.events.length, 2);
    throws(() => A.dismissProposal(c, { id: 'p2', today }), 404, /proposal/);
});

test('applyProposal needs confirm for Ruled out', () => {
    const c = co({ stance: 'Watching', proposals: [{ ...proposal(), base: { stance: 'Watching' }, changes: { stance: 'Ruled out' } }] });
    throws(() => A.applyProposal(c, { id: 'p1', today }), 409, /Rule out/, true);
});

test('undoChange sets from when every field still equals to; else 409', () => {
    const c = co({ reason: 'new', domain: 'B' });
    const fields = { reason: { from: 'old', to: 'new' }, domain: { from: 'A', to: 'B' } };
    A.undoChange(c, { fields, today });
    assert.deepEqual([c.reason, c.domain], ['old', 'A']);
    assert.equal(c.events.length, 1);
    const d = co({ reason: 'new', domain: 'edited' });
    throws(() => A.undoChange(d, { fields, today }), 409, /domain/);
    assert.equal(d.reason, 'new');
    throws(() => A.undoChange(d, { fields: {}, today }), 400, /Nothing/);
});

test('mergeInto carries jobs, applications, proposals, events and aliases', () => {
    const t = co({ name: 'Quillfeather PBC', key: 'quillfeatherpbc', jobs: { a: { state: 'saved' } }, possibleDuplicateOf: 'quillfeather' });
    const s = co({ name: 'Quillfeather', key: 'quillfeather', aliases: ['Quillfeather Inc'], jobs: { a: { state: 'skipped' }, b: { state: 'saved' } }, applications: [app({ outcome: 'rejected' })], proposals: [proposal()], events: [{ date: 'd', text: 'old' }], rolesSkipped: ['X'] });
    A.mergeInto(t, s, { today });
    assert.deepEqual(Object.keys(t.jobs).sort(), ['a', 'b']);
    assert.equal(t.jobs.a.state, 'saved');
    assert.equal(t.applications.length, 1);
    assert.equal(t.proposals.length, 1);
    assert.deepEqual(t.aliases, ['Quillfeather', 'Quillfeather Inc']);
    assert.deepEqual(t.rolesSkipped, ['X']);
    assert.equal(t.possibleDuplicateOf, undefined);
    assert.deepEqual(t.events.map((e) => e.text), ['old', 'Merged Quillfeather into this company']);
});

test('mergeInto refuses itself', () => {
    const t = co();
    throws(() => A.mergeInto(t, co({ name: 'Ostrander' }), { today }), 400, /same/);
    assert.equal(t.events.length, 0);
});

test('mergeInto allows an applied or ruled-out source; target stance wins unless blank', () => {
    const t = co({ stance: 'Watching' });
    A.mergeInto(t, co({ name: 'Other', key: 'other', stance: 'Ruled out', applications: [app()] }), { today });
    assert.equal(t.applications.filter((a) => a.outcome === 'applied').length, 1);
    assert.equal(t.stance, 'Watching');
    const b = co();
    A.mergeInto(b, co({ name: 'Other', key: 'other', stance: 'Ruled out' }), { today });
    assert.equal(b.stance, 'Ruled out');
});

test('keepSeparate clears possibleDuplicateOf and records the other key', () => {
    const c = co({ possibleDuplicateOf: 'quillfeather' });
    A.keepSeparate(c, { otherKey: 'quillfeather', today });
    assert.deepEqual([c.possibleDuplicateOf, c.distinctFrom], [undefined, ['quillfeather']]);
    assert.equal(c.events.length, 1);
    throws(() => A.keepSeparate(c, { today }), 400, /Which/);
});

test('every action leaves exactly one new event', () => {
    const cases = [
        (c) => A.setStance(c, { stance: 'Dormant', confirmed: true, today }),
        (c) => A.saveJob(c, job),
        (c) => A.skipJob(c, job),
        (c) => A.addJob(c, { role: 'R', url: 'https://x.example/r', today }),
        (c) => A.markApplied(c, { applicationId: 'n', role: 'R', confirmed: true, today }),
        (c) => A.setOutcome(c, { applicationId: 'a1', outcome: 'rejected', today }),
        (c) => A.deleteApplication(c, { applicationId: 'a1', confirmed: true, today }),
        (c) => A.addPostingLink(c, { applicationId: 'a1', url: 'https://x.example/j', today }),
        (c) => A.markSeen(c, { postingIds: [], goneAtById: {}, today }),
        (c) => A.applyProposal(c, { id: 'p1', today }),
        (c) => A.dismissProposal(c, { id: 'p1', today }),
        (c) => A.undoChange(c, { fields: { reason: { from: 'old', to: 'new' } }, today }),
        (c) => A.mergeInto(c, co({ name: 'Other', key: 'other' }), { today }),
        (c) => A.keepSeparate(c, { otherKey: 'x', today }),
    ];
    for (const run of cases) {
        const c = co({ reason: 'new', applications: [app()], proposals: [proposal()] });
        c.proposals[0].base = { reason: 'new' };
        run(c);
        assert.equal(c.events.length, 1, run.toString());
    }
});

test('applyProposal applies only MODEL_FIELDS', () => {
    const evil = { applications: [], jobs: { x: 1 }, events: [], override: 'yes', reason: 'new' };
    const c = co({ reason: 'old', applications: [app()], jobs: { k: { state: 'saved' } }, proposals: [{ ...proposal(), base: { ...evil, reason: 'old' }, changes: evil }] });
    c.proposals[0].base = { applications: c.applications, jobs: c.jobs, events: c.events, override: undefined, reason: 'old' };
    A.applyProposal(c, { id: 'p1', today });
    assert.equal(c.reason, 'new');
    assert.equal(c.applications.length, 1);
    assert.deepEqual(Object.keys(c.jobs), ['k']);
    assert.equal(c.override, undefined);
    assert.deepEqual(c.events.map((e) => e.text), ["Accepted claude's proposal: reason"]);
    const e = co({ proposals: [{ ...proposal(), changes: { applications: [] } }] });
    throws(() => A.applyProposal(e, { id: 'p1', today }), 400, /nothing that can be applied/);
});

test('saveJob, skipJob and markApplied cap and type-check postingId and leadKey', () => {
    for (const bad of [{ postingId: 5 }, { postingId: 'x'.repeat(201) }, { leadKey: 5 }, { leadKey: 'x'.repeat(201) }]) {
        throws(() => A.saveJob(co(), { ...job, ...bad }), 400, /Bad/);
        throws(() => A.skipJob(co(), { ...job, ...bad }), 400, /Bad/);
        throws(() => A.markApplied(co(), { applicationId: 'n', role: 'R', today, ...bad }), 400, /Bad/);
    }
});

test('Reopen refuses 409 for the same job, and needs confirm when another job is open', () => {
    const closed = app({ id: 'a1', outcome: 'rejected', postingId: 'key:1' });
    const dup = co({ applications: [closed, app({ id: 'a2', postingId: 'key:1', leadKey: 'z' })] });
    throws(() => A.setOutcome(dup, { applicationId: 'a1', outcome: 'applied', confirmed: true, today }), 409, /open application for this job/);
    const other = co({ applications: [closed, app({ id: 'a2', postingId: 'key:2', leadKey: 'other::r', role: 'Principal', appliedOn: '2026-11-01' })] });
    other.applications[0].leadKey = 'ostrander::x';
    throws(() => A.setOutcome(other, { applicationId: 'a1', outcome: 'applied', today }), 409, /^You applied for Principal on 2026-11-01\. Apply for this one too\?$/, true);
    assert.equal(other.applications[0].outcome, 'rejected');
    A.setOutcome(other, { applicationId: 'a1', outcome: 'applied', confirmed: true, today });
    assert.equal(other.applications[0].outcome, 'applied');
});

test('setLinks stores both links with one event, clears one with an empty string, rejects non-http(s)', () => {
    const c = co();
    A.setLinks(c, { careersUrl: 'https://x.example/careers', jobsUrl: 'https://boards.greenhouse.io/x', today });
    assert.deepEqual([c.careersUrl, c.jobsUrl], ['https://x.example/careers', 'https://boards.greenhouse.io/x']);
    assert.deepEqual(c.events, [{ date: today, text: 'Edited careers links' }]);
    A.setLinks(c, { careersUrl: 'https://x.example/careers', jobsUrl: '', today });
    assert.equal(c.jobsUrl, '');
    A.setLinks(c, { today });
    assert.deepEqual([c.careersUrl, c.jobsUrl], ['', '']);
    throws(() => A.setLinks(c, { careersUrl: 'javascript:x', today }), 400, /http\(s\)/);
});

test('setLinks trims the values it stores, and a no-change save adds no event', () => {
    const c = co();
    A.setLinks(c, { careersUrl: ' https://x.example/careers ', jobsUrl: '', today });
    assert.equal(c.careersUrl, 'https://x.example/careers');
    A.setLinks(c, { careersUrl: 'https://x.example/careers ', jobsUrl: ' ', today });
    assert.equal(c.events.length, 1);
});

test('setCulture stores the text with one event, no-change adds none, over-cap is refused', () => {
    const c = { events: [] };
    A.setCulture(c, { culture: ' Glassdoor 3.1, 22 reviews ', today });
    assert.equal(c.culture, 'Glassdoor 3.1, 22 reviews');
    A.setCulture(c, { culture: 'Glassdoor 3.1, 22 reviews', today });
    assert.equal(c.events.length, 1);
    throws(() => A.setCulture(c, { culture: 'x'.repeat(601), today }), 400, /at most/);
});

test('setSweep toggles the flag with one event each way, no-change adds none', () => {
    const c = { events: [] };
    A.setSweep(c, { off: true, today });
    A.setSweep(c, { off: true, today });
    assert.equal(c.sweepOff, true);
    A.setSweep(c, { off: false, today });
    assert.equal('sweepOff' in c, false);
    assert.equal(c.events.length, 2);
});

test('setPostingUrl edits the job entry and posting in place, keeps ids, resets the check, one event', () => {
    const c = { name: 'X', jobs: { a: { state: 'saved', role: 'Eng', leadKey: 'x|eng', url: 'https://old.example/1' } }, events: [] };
    const p = { id: 'a', company: 'X', url: 'https://old.example/1', posted: 'no', postedCheckedAt: '2026-11-01', goneAt: '2026-11-01' };
    A.setPostingUrl(c, p, { postingId: 'a', url: ' https://new.example/2 ', today });
    assert.equal(c.jobs.a.url, 'https://new.example/2');
    assert.deepEqual(p, { id: 'a', company: 'X', url: 'https://new.example/2' });
    assert.deepEqual(c.events, [{ date: today, text: 'Edited link for Eng' }]);
    A.setPostingUrl(c, p, { postingId: 'a', url: 'https://new.example/2', today });
    assert.equal(c.events.length, 1);
    throws(() => A.setPostingUrl(c, p, { postingId: 'a', url: 'javascript:x', today }), 400, /http\(s\)/);
    throws(() => A.setPostingUrl(c, undefined, { postingId: 'zz', url: 'https://n.example', today }), 404, /No such job/);
    // Entry saved under another id (matched by leadKey) is still found.
    const c2 = { name: 'X', jobs: { old: { state: 'saved', role: 'Eng', leadKey: 'x|eng', url: 'https://o.example' } }, events: [] };
    A.setPostingUrl(c2, { id: 'new', leadKey: 'x|eng', company: 'X', url: 'https://o.example' }, { postingId: 'new', url: 'https://n.example', today });
    assert.equal(c2.jobs.old.url, 'https://n.example');
});

test('setNote adds dated notes, edits and deletes by index, reads the old string form', () => {
    const c = { events: [], note: 'old one' };
    assert.deepEqual(notesOf(c), [{ at: '', text: 'old one' }]);
    A.setNote(c, { note: ' call back Fri ', today });
    assert.deepEqual(c.notes, [{ at: '', text: 'old one' }, { at: today, text: 'call back Fri' }]);
    assert.equal(c.note, undefined);
    A.setNote(c, { index: 0, was: 'old one', note: 'older one', today });
    assert.equal(c.notes[0].text, 'older one');
    assert.equal(c.notes[0].at, '');
    A.setNote(c, { index: 0, was: 'older one', note: '', today });
    assert.deepEqual(c.notes.map((n) => n.text), ['call back Fri']);
    throws(() => A.setNote(c, { index: 0, was: 'older one', note: '', today }), 409, /changed/); // a double delete
    A.setNote(c, { index: 0, was: 'call back Fri', note: '', today });
    assert.equal(c.notes, undefined);
    throws(() => A.setNote(c, { index: 3, was: 'x', note: 'x', today }), 404, /gone/);
    throws(() => A.setNote(c, { note: 'x'.repeat(1501), today }), 400, /at most/);
    for (const index of [-1, 1.5, '0', null]) throws(() => A.setNote(c, { index, was: 'x', note: 'x', today }), 400, /Bad note index/);
    throws(() => A.setNote(c, { index: 0, note: 'x', today }), 400, /Bad note index/);
});

test('setNote on a job converts its old string and edits in place', () => {
    const c = { events: [], jobNotes: { p1: 'good team' } };
    A.setNote(c, { postingId: 'p1', index: 0, was: 'good team', note: 'great team', today });
    assert.deepEqual(c.jobNotes.p1, [{ at: '', text: 'great team' }]);
    A.setNote(c, { postingId: 'p1', index: 0, was: 'great team', note: 'great team', today });
    assert.equal(c.events.length, 1);
    A.setNote(c, { postingId: 'p1', index: 0, was: 'great team', note: '', today });
    assert.equal(c.jobNotes, undefined);
});

test('setNote refuses a 51st note', () => {
    const c = { events: [], notes: Array.from({ length: 50 }, (_, i) => ({ at: today, text: `n${i}` })) };
    throws(() => A.setNote(c, { note: 'one more', today }), 400, /50 notes/);
});

test('setStance Ruled out adds its note as a new entry after the old string', () => {
    const c = { name: 'X', events: [], note: 'old' };
    A.setStance(c, { stance: 'Ruled out', confirmed: true, note: ' no remote ', today });
    assert.deepEqual(c.notes, [{ at: '', text: 'old' }, { at: today, text: 'no remote' }]);
    assert.equal(c.note, undefined);
    assert.equal(c.stance, 'Ruled out');
});

test('Rule out keeps its note past the 50-note cap', () => {
    const c = { name: 'X', events: [], notes: Array.from({ length: 50 }, (_, i) => ({ at: today, text: `n${i}` })) };
    A.setStance(c, { stance: 'Ruled out', confirmed: true, note: 'no remote', today });
    assert.equal(c.notes.length, 51);
    assert.equal(c.stance, 'Ruled out');
});

test('setNote logs Added, Edited and Deleted separately', () => {
    const c = { events: [] };
    A.setNote(c, { note: 'a', today });
    A.setNote(c, { index: 0, was: 'a', note: 'b', today });
    A.setNote(c, { index: 0, was: 'b', note: '', today });
    A.setNote(c, { postingId: 'p', note: 'a', today });
    A.setNote(c, { postingId: 'p', index: 0, was: 'a', note: '', today });
    const texts = c.events.map((e) => e.text ?? e.what ?? JSON.stringify(e));
    for (const t of ['Added note', 'Edited note', 'Deleted note', 'Added a job note', 'Deleted a job note']) assert.ok(texts.some((x) => x.includes(t)), t);
});

test('mergeInto keeps both companies\' notes and job notes', () => {
    const target = { key: 't', name: 'T', events: [], notes: [{ at: '2026-11-01', text: 'mine' }] };
    const source = { key: 's', name: 'S', events: [], note: 'theirs', jobNotes: { p1: 'job note' } };
    A.mergeInto(target, source, { today });
    assert.deepEqual(target.notes.map((n) => n.text), ['mine', 'theirs']);
    assert.deepEqual(target.jobNotes.p1, [{ at: '', text: 'job note' }]);
});

test('mergeInto carries the source\'s flags', () => {
    const target = { key: 't', name: 'T', events: [], jobFlags: { a: { at: '1', role: 'A', leadKey: 'a' } } };
    const source = { key: 's', name: 'S', events: [], flag: { at: '2' }, jobFlags: { b: { at: '2', role: 'B', leadKey: 'b' } } };
    A.mergeInto(target, source, { today });
    assert.deepEqual(target.flag, { at: '2' });
    assert.deepEqual(Object.keys(target.jobFlags), ['b', 'a']);
    const bare = { key: 't2', name: 'T2', events: [] };
    A.mergeInto(bare, { key: 's2', name: 'S2', events: [] }, { today });
    assert.ok(!('jobFlags' in bare) && !('flag' in bare));
});

test('markPassedRead clears the flag of a job it skips', () => {
    const c = co({ jobFlags: { 'key:1': { at: '1', role: job.role, leadKey: job.leadKey } } });
    A.markPassedRead(c, { jobs: [job], today });
    assert.ok(!c.jobFlags);
});

test('markPassedRead skips the jobs and remembers the verdict it was shown', () => {
    const c = co({ verdict: 'Near miss' });
    A.markPassedRead(c, { jobs: [job], verdict: true, today });
    assert.equal(c.jobs['key:1'].state, 'skipped');
    assert.equal(c.passedSeen, 'Near miss');
    assert.equal(lastEvent(c).text, 'Marked passed items read');
    throws(() => A.markPassedRead(co(), { jobs: 'x', today }), 400, /jobs/);
});

test('an owner stance change clears the model mark; undoing a model stance restores the owner one', () => {
    const c = co({ stance: 'Dormant', stanceBy: 'claude' });
    A.setStance(c, { stance: 'Watching', today });
    assert.equal(c.stanceBy, undefined);
    const m = co({ stance: 'Dormant', stanceBy: 'codex' });
    A.undoChange(m, { fields: { stance: { from: 'Watching', to: 'Dormant' }, stanceBy: { from: undefined, to: 'codex' } }, today });
    assert.equal(m.stance, 'Watching');
    assert.equal(m.stanceBy, undefined);
});

test('a reason is kept on the job, and earlier reasons survive a later state change', () => {
    const c = co();
    A.skipJob(c, { ...job, reason: ' Pay too low ' });
    A.saveJob(c, { ...job, reason: 'Great domain' });
    A.skipJob(c, job);
    assert.deepEqual(c.jobs['key:1'].reasons, [{ state: 'skipped', reason: 'Pay too low', at: today }, { state: 'saved', reason: 'Great domain', at: today }]);
    assert.equal(c.jobs['key:1'].state, 'skipped');
    throws(() => A.skipJob(co(), { ...job, reason: 'x'.repeat(121) }), 400, /at most 120/);
    assert.equal('reasons' in (() => { const d = co(); A.saveJob(d, job); return d.jobs['key:1']; })(), false);
});

test('keepCompany declines a suggested rule-out and makes the stance the owner\'s; setStance clears the suggestion', () => {
    const c = co({ stance: '', stanceBy: undefined, ruleOutSuggested: { by: 'claude', reason: 'x' } });
    A.keepCompany(c, { today });
    assert.deepEqual([c.stance, c.ruleOutSuggested, c.stanceBy], ['Watching', undefined, undefined]);
    throws(() => A.keepCompany(c, { today }), 404, /Nothing to keep/);
    const d = co({ stance: 'Dormant', stanceBy: 'codex', ruleOutSuggested: { by: 'codex', reason: 'x' } });
    A.setStance(d, { stance: 'Ruled out', confirmed: true, today });
    assert.deepEqual([d.stance, d.ruleOutSuggested], ['Ruled out', undefined]);
});

test('setStage sets, clears, and refuses closed or unknown stages', () => {
    const c = co({ applications: [app()] });
    A.setStage(c, { applicationId: 'a1', stage: 'screening', today });
    assert.deepEqual([c.applications[0].stage, c.applications[0].stageOn], ['screening', today]);
    assert.equal(lastEvent(c).text, 'Moved Staff Engineer to Screening');
    A.setStage(c, { applicationId: 'a1', stage: '', today: '2026-11-17' });
    assert.deepEqual([c.applications[0].stage, c.applications[0].stageOn], [undefined, '2026-11-17']);
    throws(() => A.setStage(c, { applicationId: 'a1', stage: 'hired', today }), 400, /stage/);
    A.setOutcome(c, { applicationId: 'a1', outcome: 'rejected', today });
    throws(() => A.setStage(c, { applicationId: 'a1', stage: 'offer', today }), 409, /open/);
});

test('setNextStep sets, clears, validates, logs nothing; closing clears stage fields', () => {
    const c = co({ applications: [app()] });
    A.setNextStep(c, { applicationId: 'a1', text: ' Recruiter call ', on: '2026-11-24', today });
    assert.deepEqual(c.applications[0].next, { text: 'Recruiter call', on: '2026-11-24' });
    assert.deepEqual(c.events, []);
    throws(() => A.setNextStep(c, { applicationId: 'a1', text: 'x'.repeat(201), today }), 400, /200/);
    throws(() => A.setNextStep(c, { applicationId: 'a1', text: 'x', on: '11/24', today }), 400, /date/);
    throws(() => A.setNextStep(c, { applicationId: 'a1', text: 'x', on: '2026-02-30', today }), 400, /date/);
    throws(() => A.setNextStep(c, { applicationId: 'a1', text: 'x', on: '2026-13-01', today }), 400, /date/);
    throws(() => A.setNextStep(c, { applicationId: 'a1', text: 'x', on: ['2026-11-24'], today }), 400, /date/);
    A.setStage(c, { applicationId: 'a1', stage: 'offer', today });
    A.setOutcome(c, { applicationId: 'a1', outcome: 'rejected', today });
    assert.deepEqual([c.applications[0].stage, c.applications[0].stageOn, c.applications[0].next], [undefined, undefined, undefined]);
    A.setOutcome(c, { applicationId: 'a1', outcome: 'applied', today });
    assert.equal(c.applications[0].stage, undefined);
    const d = co({ applications: [app({ next: { text: 'a' } })] });
    A.setNextStep(d, { applicationId: 'a1', text: '', today });
    assert.equal(d.applications[0].next, undefined);
});

test('setFlag flags a company or a job, keeps the first date, adds the note to notes', () => {
    const c = { name: 'X', events: [], note: 'old' };
    A.setFlag(c, { on: true, note: ' check culture ', today: '2026-11-20' });
    assert.deepEqual(c.flag, { at: '2026-11-20' });
    assert.deepEqual(c.notes.map((n) => n.text), ['old', 'check culture']);
    A.setFlag(c, { on: true, today: '2026-11-22' });
    assert.equal(c.flag.at, '2026-11-20');
    A.setFlag(c, { postingId: 'p1', leadKey: 'x::sr', role: 'Senior', url: 'https://x.com/j/1', on: true, note: 'pay?', today });
    assert.deepEqual(c.jobFlags.p1, { at: today, role: 'Senior', leadKey: 'x::sr', url: 'https://x.com/j/1' });
    assert.deepEqual(c.jobNotes.p1.map((n) => n.text), ['pay?']);
    A.setFlag(c, { postingId: 'p1', role: 'Senior', on: false, today });
    assert.equal(c.jobFlags, undefined);
    const events = c.events.length;
    A.setFlag(c, { postingId: 'p1', role: 'Senior', on: false, today });
    assert.equal(c.events.length, events);
    throws(() => A.setFlag(c, { on: 'yes', today }), 400, /Bad flag/);
    throws(() => A.setFlag(c, { postingId: 'p2', on: true, today }), 400, /Role/);
});

test('Skip, Mark applied and Rule out clear flags', () => {
    const c = { name: 'X', events: [], flag: { at: today }, jobFlags: { p1: { at: today, role: 'A', leadKey: 'x::a' }, p2: { at: today, role: 'B', leadKey: 'x::b' } } };
    A.skipJob(c, { postingId: 'p1', leadKey: 'x::a', role: 'A', today });
    assert.deepEqual(Object.keys(c.jobFlags), ['p2']);
    A.markApplied(c, { applicationId: 'a1', postingId: 'p2', leadKey: 'x::b', role: 'B', today });
    assert.equal(c.jobFlags, undefined);
    c.jobFlags = { p3: { at: today, role: 'C', leadKey: 'x::c' } };
    throws(() => A.setStance(c, { stance: 'Ruled out', today }), 409, /Rule out/, true);
    assert.equal(c.flag.at, today);
    assert.deepEqual(Object.keys(c.jobFlags), ['p3']);
    A.setStance(c, { stance: 'Ruled out', confirmed: true, today });
    assert.equal(c.flag, undefined);
    assert.equal(c.jobFlags, undefined);
});

test('skipping a saved job marks it fromSaved; saving again clears it', () => {
    const c = { name: 'X', events: [], stance: 'Watching' };
    const job = { postingId: 'p1', leadKey: 'x::r', role: 'R' };
    A.skipJob(c, { ...job, today });
    assert.equal(c.jobs.p1.fromSaved, undefined);
    A.saveJob(c, { ...job, today });
    A.skipJob(c, { ...job, reason: 'Too big', today });
    assert.equal(c.jobs.p1.fromSaved, today);
    A.saveJob(c, { ...job, today });
    assert.equal(c.jobs.p1.fromSaved, undefined);
});

test('applyJob sets applying, clears the flag, logs it; skipping it marks fromSaved', () => {
    const c = { name: 'X', events: [], stance: 'Watching', jobFlags: { p1: { at: today, role: 'R', leadKey: 'x::r' } } };
    A.saveJob(c, { postingId: 'p1', leadKey: 'x::r', role: 'R', today });
    A.applyJob(c, { postingId: 'p1', leadKey: 'x::r', role: 'R', url: 'https://x.com/j/1', today });
    assert.equal(c.jobs.p1.state, 'applying');
    assert.equal(c.jobFlags, undefined);
    assert.equal(c.events.at(-1).text, 'Applying for R');
    A.skipJob(c, { postingId: 'p1', leadKey: 'x::r', role: 'R', today });
    assert.equal(c.jobs.p1.fromSaved, today);
});

test('setSendTo stores who to follow up with on an open application', () => {
    const c = { name: 'X', events: [], applications: [{ id: 'a1', role: 'R', appliedOn: '2026-11-10', outcome: 'applied' }] };
    A.setSendTo(c, { applicationId: 'a1', sendTo: '  Dana Reyes <dana@x.com> ', today });
    assert.equal(c.applications[0].sendTo, 'Dana Reyes <dana@x.com>');
    assert.match(lastEvent(c).text, /Send-to set for R/);
    const n = c.events.length;
    A.setSendTo(c, { applicationId: 'a1', sendTo: 'Dana Reyes <dana@x.com>', today });
    assert.equal(c.events.length, n);
    A.setSendTo(c, { applicationId: 'a1', sendTo: '', today });
    assert.equal(c.applications[0].sendTo, undefined);
    throws(() => A.setSendTo(c, { applicationId: 'a1', sendTo: 'x'.repeat(201), today }), 400, /200/);
    c.applications[0].outcome = 'rejected';
    throws(() => A.setSendTo(c, { applicationId: 'a1', sendTo: 'Dana', today }), 409, /not open/);
});
