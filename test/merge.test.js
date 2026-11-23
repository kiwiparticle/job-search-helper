import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyKey, sameCompany, leadKey } from '../lib/keys.js';
import { readModelOutput, readReview } from '../lib/readModelOutput.js';
import { mergeCandidates as merge } from '../lib/mergeCandidates.js';
import { readRoute } from '../lib/models.js';
import { reviewInput } from '../lib/run.js';
const LEGACY = readRoute('/nonexistent');
const mergeCandidates = ({ claude, codex, reviews }) => merge({ outputs: { claude, codex }, route: LEGACY, reviews });

const dir = (files) => {
    const d = mkdtempSync(join(tmpdir(), 'jsout-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    return d;
};

const brindle = { company: 'Brindle Health', role: 'Senior Software Engineer, Full-Stack', url: 'https://jobs.lever.co/brindle/x', verdict: 'Worth interviewing', note: 'Broad product role.', questions: ['Python share?'] };
const cartwheel = { company: 'Cartwheel Engine', role: 'Staff Software Engineer', url: 'https://jobs.ashbyhq.com/cartwheel/x', verdict: 'Human review needed', note: 'Slack responsiveness flag.', questions: ['On-call cadence?'] };

test('Lanternby and Lanternby Software are one company', () => assert.ok(sameCompany('Lanternby', 'Lanternby Software')));
test('alias form matches either side', () => assert.ok(sameCompany('Initech / Globex', 'Globex')));
test('different companies do not match', () => assert.ok(!sameCompany('Relevant Healthcare', 'Lanternby Software')));
test('companyKey ignores case and punctuation', () => assert.equal(companyKey('Classgrove.world'), companyKey('CLASSGROVE WORLD')));
test('leadKey ignores role punctuation', () => assert.equal(
    leadKey('Brindle Health', 'Senior Software Engineer, Full-Stack'),
    leadKey('Brindle', 'Senior Software Engineer (Full Stack)'),
));

test('fenced JSON still parses', () => {
    const out = readModelOutput(dir({ 'status.txt': 'ok\n', 'candidates.json': 'Here you go:\n```json\n[' + JSON.stringify(brindle) + ']\n```\n' }));
    assert.equal(out.status, 'ok');
    assert.equal(out.candidates[0].company, 'Brindle Health');
});
test('candidates wrapped in an object still parse', () => {
    const out = readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': JSON.stringify({ candidates: [brindle] }) }));
    assert.equal(out.candidates.length, 1);
});
test('missing candidates.json is failed, not thrown', () => assert.equal(readModelOutput(dir({ 'status.txt': 'ok' })).status, 'failed'));

test('a failed searcher says why: the runner reason first, else what the reader saw', () => {
    assert.equal(readModelOutput(dir({ 'status.txt': 'ok' })).reason, 'finished but wrote no candidates.json');
    assert.equal(readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': '{oops' })).reason, 'candidates.json is not a valid JSON list');
    assert.equal(readModelOutput(dir({ 'status.txt': 'failed\n', 'reason.txt': 'timed out (50 min limit)\n' })).reason, 'timed out (50 min limit)');
    assert.equal(readModelOutput(dir({ 'status.txt': 'limit' })).reason, 'hit its usage limit');
    assert.equal(readModelOutput(dir({})).reason, 'no status: its search job never finished');
    assert.equal(readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': '[]' })).reason, undefined);
});
test('unparseable candidates.json is failed', () => assert.equal(readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': 'no leads today, sorry' })).status, 'failed'));
test('auth status is kept', () => assert.equal(readModelOutput(dir({ 'status.txt': 'auth' })).status, 'auth'));
test('missing dir is failed', () => assert.equal(readModelOutput('/nonexistent/jsout').status, 'failed'));
test('readReview returns null for a bad file', () => assert.equal(readReview('/nonexistent/review.json'), null));

const ok = (candidates) => ({ status: 'ok', candidates });
const routeDir = (a, b) => {
    const d = mkdtempSync(join(tmpdir(), 'jsrt-'));
    for (const [id, c] of Object.entries({ a, b })) {
        mkdirSync(join(d, id));
        writeFileSync(join(d, id, 'status.txt'), 'ok');
        writeFileSync(join(d, id, 'candidates.json'), JSON.stringify(c));
    }
    return d;
};

test('questions are the union of both models', () => {
    const [lead] = mergeCandidates({ claude: ok([cartwheel]), codex: ok([{ ...cartwheel, questions: ['On-call cadence?', 'Slack meaning?'] }]), reviews: {} });
    assert.deepEqual(lead.questions, ['On-call cadence?', 'Slack meaning?']);
});

test('two different roles at one company from one model stay separate', () => {
    const a = { company: 'Acme', role: 'Staff Engineer', verdict: 'Worth interviewing' };
    const b = { company: 'Acme', role: 'Senior Designer', verdict: 'Skip' };
    const leads = mergeCandidates({ claude: ok([a, b]), codex: ok([{ ...a }]), reviews: {} });
    assert.equal(leads.length, 2);
    assert.equal(leads.find((l) => l.role === 'Staff Engineer').foundBy, 'both');
    assert.equal(leads.find((l) => l.role === 'Senior Designer').foundBy, 'claude');
});

test('parenthetical notes are ignored when matching companies', () => {
    assert.ok(sameCompany('Lanternby Software (Holdco subsidiary)', 'Lanternby Software'));
    assert.ok(sameCompany('Lantern Foundation (Lantern)', 'Lantern Foundation'));
});

test('malformed candidate entries are dropped, not thrown', () => {
    const out = readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([null, 5, { role: 'x' }, { company: 'A', role: 'B', questions: 5 }]) }));
    assert.equal(out.status, 'ok');
    assert.equal(out.candidates.length, 1);
    assert.deepEqual(out.candidates[0].questions, []);
});

test('a list with no valid candidate marks the model failed', () => {
    assert.equal(readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': '[null, {"role":"x"}]' })).status, 'failed');
});

test('an empty list is still ok', () => {
    assert.equal(readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': '[]' })).status, 'ok');
});

test('non-http posting URLs are dropped', () => {
    const out = readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'A', role: 'B', url: 'javascript:alert(1)' }, { company: 'C', role: 'D', url: 'https://ok.example/job' }]) }));
    assert.equal(out.candidates[0].url, '');
    assert.equal(out.candidates[1].url, 'https://ok.example/job');
});

test('a usage-limit status is kept and treated as no output', () => {
    const out = readModelOutput(dir({ 'status.txt': 'limit', 'candidates.json': JSON.stringify([brindle]) }));
    assert.equal(out.status, 'limit');
    assert.deepEqual(out.candidates, []);
});

test('checks are cleaned: known labels in a fixed order, unknown marks become unknown', () => {
    const out = readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{
        company: 'A', role: 'B',
        checks: [
            { label: 'Pace', value: '"move fast"', mark: 'concern' },
            { label: 'Pay', value: '$180k', mark: 'good' },
            { label: 'Vibes', value: 'x', mark: 'good' },
            { label: 'On-call', value: 'unstated', mark: 'maybe?' },
            'junk',
        ],
    }]) }));
    assert.deepEqual(out.candidates[0].checks, [
        { label: 'Pay', value: '$180k', mark: 'good' },
        { label: 'Pace', value: '"move fast"', mark: 'concern' },
        { label: 'On-call', value: 'unstated', mark: 'unknown' },
    ]);
});

test('missing checks become an empty list', () => {
    const out = readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ company: 'A', role: 'B', checks: 'nope' }]) }));
    assert.deepEqual(out.candidates[0].checks, []);
});

test('each model\'s checks and summary ride along on its opinion', () => {
    const cl = { ...cartwheel, summary: 'Good stack, pace flag.', checks: [{ label: 'Pace', value: 'Slack', mark: 'concern' }] };
    const review = { reviewer: 'codex', items: [{ key: leadKey(cartwheel.company, cartwheel.role), agree: true, verdict: 'Human review needed', note: 'Agrees.', checks: [{ label: 'Pace', value: 'Slack', mark: 'concern' }] }] };
    const [lead] = mergeCandidates({ claude: ok([cl]), codex: ok([]), reviews: { codex: review } });
    assert.equal(lead.opinions.claude.note, 'Good stack, pace flag.');
    assert.deepEqual(lead.opinions.claude.checks, [{ label: 'Pace', value: 'Slack', mark: 'concern' }]);
    assert.deepEqual(lead.opinions.codex.checks, [{ label: 'Pace', value: 'Slack', mark: 'concern' }]);
});

test('assessment and pay estimate are cleaned and carried through the merge', () => {
    const noPay = {
        ...brindle, pay: 'Not posted',
        assessment: { for: ['Broad product role.', '  ', 7], against: ['Pace language: "move fast".'], unknown: 'not a list', extra: ['dropped'] },
        payEstimate: { range: '$165–190k', confidence: 'HIGH', basis: 'Comparable Senior SWE roles at similar edtechs.' },
    };
    const lead = mergeCandidates({ claude: { candidates: [noPay] }, codex: { candidates: [{ ...brindle, verdict: 'Worth interviewing', payEstimate: { range: '$160–180k', confidence: 'maybe' } }] } })[0];
    assert.deepEqual(lead.opinions.claude.assessment, { for: ['Broad product role.'], against: ['Pace language: "move fast".'] });
    assert.equal(lead.opinions.claude.payEstimate.confidence, 'high');
    assert.equal(lead.opinions.codex.assessment, null);
    assert.equal(lead.opinions.codex.payEstimate.confidence, 'low');
    assert.equal(lead.payEstimate.range, '$165–190k');
});

test('malformed assessment and estimate drop out instead of breaking the lead', () => {
    const bad = { ...brindle, assessment: 'long text', payEstimate: { confidence: 'high' } };
    const lead = mergeCandidates({ claude: { candidates: [bad] }, codex: { candidates: [] } })[0];
    assert.equal(lead.opinions.claude.assessment, null);
    assert.equal(lead.payEstimate, null);
});

test('three-way ids: qwen + claude searchers, codex reviews', () => {
    const route = { searchers: ['qwen', 'claude'], reviewer: 'codex' };
    const [lead] = merge({ outputs: { qwen: ok([brindle]), claude: ok([]) }, route,
        reviews: { codex: { items: [{ key: 'brindle::seniorsoftwareengineerfullstack', agree: true, verdict: 'Worth interviewing', note: 'ok' }] } } });
    assert.equal(lead.foundBy, 'qwen');
    assert.ok(lead.opinions.qwen);
    assert.deepEqual(lead.reviewers, ['codex']);
    assert.equal(lead.reviewed, true);
});

test('a lone searcher\'s finds are all reviewed by the named reviewer', () => {
    const d = routeDir([brindle, cartwheel], []);
    const items = reviewInput(d, 'b', { searchers: ['a'], reviewer: 'b' });
    assert.equal(items.length, 2);
});

test('overview passes from the finder to the lead', () => {
    const [lead] = mergeCandidates({ claude: ok([{ ...cartwheel, overview: 'Builds checkout.' }]), codex: ok([]), reviews: {} });
    assert.equal(lead.overview, 'Builds checkout.');
});

test('both found: one lead, both opinions, reviewed', () => {
    const [lead] = mergeCandidates({ claude: ok([cartwheel]), codex: ok([{ ...cartwheel, note: 'Agrees.' }]), reviews: {} });
    assert.equal(lead.foundBy, 'both');
    assert.equal(lead.finalVerdict, 'Human review needed');
    assert.equal(lead.reviewed, true);
    assert.equal(lead.opinions.codex.note, 'Agrees.');
    assert.equal('disputed' in lead, false);
});

test('searchers disagree: a lead verdict beats a pass, and both opinions stay', () => {
    const [lead] = mergeCandidates({ claude: ok([{ ...brindle, verdict: 'Skip' }]), codex: ok([brindle]), reviews: {} });
    assert.equal(lead.finalVerdict, 'Worth interviewing');
    assert.equal(lead.opinions.claude.verdict, 'Skip');
    const [lead2] = mergeCandidates({ claude: ok([brindle]), codex: ok([{ ...brindle, verdict: 'Human review needed' }]), reviews: {} });
    assert.equal(lead2.finalVerdict, 'Worth interviewing');
});

test('a reviewer never changes the verdict; its opinion rides along', () => {
    const review = { reviewer: 'claude', items: [{ key: leadKey(cartwheel.company, cartwheel.role), agree: false, verdict: 'Skip', note: 'Pace fail.' }] };
    const [lead] = mergeCandidates({ claude: ok([]), codex: ok([cartwheel]), reviews: { claude: review } });
    assert.equal(lead.foundBy, 'codex');
    assert.equal(lead.finalVerdict, 'Human review needed');
    assert.equal(lead.opinions.claude.verdict, 'Skip');
    assert.deepEqual(lead.reviewers, ['claude']);
});

test('a failed searcher adds nothing; the other\'s leads are unreviewed', () => {
    const [lead] = mergeCandidates({ claude: ok([brindle]), codex: { status: 'failed', candidates: [] }, reviews: {} });
    assert.equal(lead.reviewed, false);
    assert.equal(lead.opinions.codex, undefined);
});

test('different roles at one company from two searchers stay two leads', () => {
    const cl = { company: 'Cooperative Assay Labs', role: 'Senior Frontend Engineer', verdict: 'Skip' };
    const cx = { company: 'Cooperative Assay Labs', role: 'Senior Backend Engineer', verdict: 'Worth interviewing' };
    assert.equal(mergeCandidates({ claude: ok([cl]), codex: ok([cx]), reviews: {} }).length, 2);
});

test('the same board job under different role wording is one lead', () => {
    const url = 'https://boards.greenhouse.io/acme/jobs/123';
    const leads = mergeCandidates({ claude: ok([{ company: 'Acme', role: 'Staff Engineer', url, verdict: 'Skip' }]), codex: ok([{ company: 'Acme Inc', role: 'Staff Software Engineer', url, verdict: 'Worth interviewing' }]), reviews: {} });
    assert.equal(leads.length, 1);
    assert.equal(leads[0].finalVerdict, 'Worth interviewing');
});

test('a named reviewer gets every find it did not make, joint finds included', () => {
    const d = routeDir([brindle, cartwheel], [brindle]);
    const items = reviewInput(d, 'c', { searchers: ['a', 'b'], reviewer: 'c' });
    assert.deepEqual(items.map((i) => i.company).sort(), ['Brindle Health', 'Cartwheel Engine']);
    assert.deepEqual(reviewInput(d, 'a', { searchers: ['a', 'b'], reviewer: 'a' }), []);
});

test('fit: a whole number 1-5 is kept, anything else dropped; two searchers give the higher', () => {
    const d = (fit) => readModelOutput(dir({ 'status.txt': 'ok', 'candidates.json': JSON.stringify([{ ...brindle, fit }]) })).candidates[0].fit;
    assert.deepEqual([d(4), d('5'), d(0), d(6), d(3.5), d('x')], [4, 5, undefined, undefined, undefined, undefined]);
    const [lead] = mergeCandidates({ claude: ok([{ ...brindle, fit: 3 }]), codex: ok([{ ...brindle, fit: 5 }]), reviews: {} });
    assert.equal(lead.fit, 5);
    const [none] = mergeCandidates({ claude: ok([brindle]), codex: ok([]), reviews: {} });
    assert.equal('fit' in none, false);
});
