import { expect, test } from 'vitest';
import { ADD_JOB, ASK, EDIT_LINKS, FILL_FACTS, MARK_APPLIED, RULE_OUT, SWEEP_TOGGLE, KIT_ADD, KIT_REVIEW, KIT_REVISE, REVIEW_JOB, RUN_SEARCH, SEARCH_JOB, actionsFor } from './actions';

const ctx = { company: 'Acme', role: 'Staff', url: 'https://x/1' };

test('actionsFor filters by item and availability', () => {
    expect(actionsFor('job', ctx).map((a) => a.id)).toEqual(['reviewJob', 'markApplied', 'ruleOut']);
    expect(actionsFor('job', { ...ctx, postingId: 'p1' }).map((a) => a.id)).toEqual(['reviewJob', 'markApplied', 'editPostingLink', 'ruleOut']);
    expect(actionsFor('job', { company: 'Acme', role: 'Staff' }).map((a) => a.id)).toEqual(['markApplied', 'ruleOut']);
    expect(actionsFor('company', { company: 'Acme' }).map((a) => a.id)).toEqual(['addJob', 'markApplied', 'searchJob', 'fillFacts', 'ask', 'editLinks', 'sweepToggle', 'ruleOut']);
    expect(actionsFor('kit', { company: 'Acme', role: 'Staff', pieces: 'resume' }).map((a) => a.id)).toEqual(['markApplied', 'kitReview', 'kitRevise', 'kitAdd']);
    expect(actionsFor('kit', { company: 'Acme', role: 'Staff', pieces: 'resume', applied: true }).map((a) => a.id)).toEqual(['kitReview', 'kitRevise', 'kitAdd']);
});

test('reviewJob body', () => {
    expect(REVIEW_JOB.body(ctx, {}, {})).toEqual({ type: 'reviewJob', company: 'Acme', role: 'Staff', url: 'https://x/1' });
    expect(REVIEW_JOB.body(ctx, {}, { searchers: ['claude'], reviewer: 'none' })).toEqual({ type: 'reviewJob', company: 'Acme', role: 'Staff', url: 'https://x/1', searchers: ['claude'], reviewer: 'none' });
});

test('searchJob body', () => {
    expect(SEARCH_JOB.body({ company: 'Acme' }, { role: 'Eng', url: 'https://x/2' }, {})).toEqual({ type: 'searchJob', company: 'Acme', role: 'Eng', url: 'https://x/2' });
});

test('fillFacts body sends model only when it is not claude', () => {
    expect(FILL_FACTS.body({ company: 'Acme' }, { model: 'claude' }, {})).toEqual({ type: 'fillFacts', company: 'Acme' });
    expect(FILL_FACTS.body({ company: 'Acme' }, { model: 'qwen' }, {})).toEqual({ type: 'fillFacts', company: 'Acme', model: 'qwen' });
});

test('ask body and done text', () => {
    expect(ASK.body({ company: 'Acme' }, { question: 'Why?', model: 'both' }, {})).toEqual({ type: 'ask', company: 'Acme', model: 'both', question: 'Why?' });
    const label = (id: string) => id.toUpperCase();
    expect(ASK.done({ company: 'Acme' }, { model: 'both' }, label)).toBe('Asked both models. The answer shows here in a few minutes.');
    expect(ASK.done({ company: 'Acme' }, { model: 'qwen' }, label)).toBe('Asked QWEN. The answer shows here in a few minutes.');
});

const kctx = { company: 'Acme', role: 'Staff', pieces: 'resume,answers' };

test('kit action bodies', () => {
    expect(KIT_REVIEW.body(kctx, { reviewers: 'both', note: '' }, {})).toEqual({ type: 'kitReview', company: 'Acme', role: 'Staff', reviewers: 'both', note: '' });
    expect(KIT_REVISE.body(kctx, { reviser: 'codex', note: 'n' }, {})).toEqual({ type: 'kitRevise', company: 'Acme', role: 'Staff', reviser: 'codex', note: 'n' });
    expect(KIT_ADD.body(kctx, { pieces: 'cover-letter,answers', drafter: 'claude', note: '' }, {})).toEqual({ type: 'kitAdd', company: 'Acme', role: 'Staff', pieces: 'cover-letter,answers', drafter: 'claude', note: '' });
});

test('kit titles are plain and Add a piece marks pieces the kit already has', () => {
    expect(KIT_REVIEW.title?.(kctx)).toBe('Review again');
    const p = KIT_ADD.params[0];
    if (p.kind !== 'checks') throw new Error('checks');
    expect(p.options(kctx)).toEqual([{ value: 'cover-letter', label: 'Cover letter' }, { value: 'answers', label: 'Form answers (new version)' }]);
});

test('runSearch body', () => {
    expect(RUN_SEARCH.body({ company: '', workflow: 'daily' }, {}, {})).toEqual({ type: 'run', workflow: 'daily' });
    expect(RUN_SEARCH.body({ company: '', workflow: 'vertical' }, { topic: 'A; B' }, { reviewer: 'each' })).toEqual({ type: 'run', workflow: 'vertical', topic: 'A; B', reviewer: 'each' });
});

test('company plain-button bodies', () => {
    const c = { company: 'Acme' };
    expect(ADD_JOB.body(c, { role: 'Eng', url: 'https://x/1' }, {})).toEqual({ type: 'addJob', company: 'Acme', role: 'Eng', url: 'https://x/1' });
    expect(MARK_APPLIED.body(c, { role: 'Eng', url: '' }, {})).toEqual({ type: 'markApplied', applicationId: expect.stringMatching(/^[0-9a-f-]{36}$/), company: 'Acme', role: 'Eng' });
    expect(MARK_APPLIED.body(c, { role: 'Eng', url: 'https://x/1' }, {})).toMatchObject({ role: 'Eng', url: 'https://x/1' });
    expect(MARK_APPLIED.body({ ...c, role: 'Staff', postingId: 'p1', leadKey: 'k', url: 'https://x/2' }, {}, {})).toEqual({ type: 'markApplied', applicationId: expect.any(String), company: 'Acme', postingId: 'p1', leadKey: 'k', role: 'Staff', url: 'https://x/2' });
    expect(EDIT_LINKS.body(c, { careersUrl: '', jobsUrl: '' }, {})).toEqual({ type: 'setLinks', company: 'Acme', careersUrl: '', jobsUrl: '' });
    expect(SWEEP_TOGGLE.body(c, {}, {})).toEqual({ type: 'setSweep', company: 'Acme', off: true });
    expect(SWEEP_TOGGLE.body({ ...c, sweepOff: true }, {}, {})).toEqual({ type: 'setSweep', company: 'Acme', off: false });
    expect(RULE_OUT.body(c, { note: '  ' }, {})).toEqual({ type: 'setStance', company: 'Acme', stance: 'Ruled out', ruleOutAsked: true });
    expect(RULE_OUT.body(c, { note: 'meh' }, {})).toEqual({ type: 'setStance', company: 'Acme', stance: 'Ruled out', ruleOutAsked: true, note: 'meh' });
    expect(RULE_OUT.title?.(c)).toBe('Rule out Acme');
});
