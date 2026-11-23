import type { ModelPick } from './components/ModelPicker';

export type ItemType = 'job' | 'company' | 'kit';
export type Ctx = {
    company: string; role?: string; url?: string; pieces?: string; workflow?: string; workflowLabel?: string;
    postingId?: string; leadKey?: string; topic?: string; careersUrl?: string; jobsUrl?: string; sweepOff?: boolean; applied?: boolean;
};
export type Option = { value: string; label: string };
type ParamBase =
    | { kind: 'text'; name: string; label: string; required?: boolean; type?: 'url'; initial?: (ctx: Ctx) => string }
    | { kind: 'textarea'; name: string; label: string; required?: boolean; max?: number; initial?: (ctx: Ctx) => string }
    // One-tap reasons from data/reasons.json: a chip submits at once, its text put before what was typed in `into`.
    | { kind: 'reasons'; name: string; list: 'skip' | 'save' | 'ruleOut'; into: string }
    | { kind: 'choice'; name: string; label: string; options: Option[]; default: string }
    | { kind: 'checks'; name: string; label: string; options: (ctx: Ctx) => Option[]; required?: boolean }
    | { kind: 'model'; name: string; label: string; workflow: 'fill' | 'ask'; extra?: Option[] }
    | { kind: 'verticals'; name: string; label: string }
    | { kind: 'searchModels' };
export type Param = ParamBase & { show?: (ctx: Ctx) => boolean };
export type ActionDef = {
    id: string;
    label: string | ((ctx: Ctx) => string);
    danger?: boolean;
    last?: boolean; // the menu shows it after the page's own items
    tip: string;
    items: ItemType[];
    params: Param[];
    submit: string;
    workflow?: string; // default workflow for the model fields
    disabled?: (working: string[]) => boolean;
    title?: (ctx: Ctx) => string;
    available?: (ctx: Ctx) => boolean;
    body: (ctx: Ctx, values: Record<string, string>, pick: ModelPick) => Record<string, unknown>;
    done: (ctx: Ctx, values: Record<string, string>, label: (id: string) => string) => string;
};

export const labelOf = (def: ActionDef, ctx: Ctx): string => (typeof def.label === 'function' ? def.label(ctx) : def.label);

// No visible field for this ctx: choosing it posts straight away.
export const isDirect = (def: ActionDef, ctx: Ctx): boolean => def.params.every((p) => !(p.show?.(ctx) ?? true));

export const REVIEW_JOB: ActionDef = {
    workflow: 'job',
    id: 'reviewJob',
    label: 'Review…',
    tip: 'Choose the models, then they read this posting and write it up, like a search find. Takes a few minutes.',
    items: ['job'],
    params: [{ kind: 'searchModels' }],
    submit: 'Start',
    disabled: (w) => w.length > 0,
    available: (c) => Boolean(c.url && c.role),
    body: (c, _v, pick) => ({ type: 'reviewJob', company: c.company, role: c.role, url: c.url, ...pick }),
    done: (c) => `Reviewing ${c.role}. The write-up shows here in a few minutes.`,
};

export const SEARCH_JOB: ActionDef = {
    workflow: 'job',
    id: 'searchJob',
    label: 'Search a job…',
    tip: 'Save a job by its link and have the models you pick screen it. The write-up lands in New in a few minutes.',
    items: ['company'],
    params: [
        { kind: 'text', name: 'role', label: 'Role', required: true },
        { kind: 'text', name: 'url', label: 'Link to the posting', required: true, type: 'url' },
        { kind: 'searchModels' },
    ],
    submit: 'Start',
    body: (c, v, pick) => ({ type: 'searchJob', company: c.company, role: v.role, url: v.url, ...pick }),
    done: (_c, v) => `Searching ${v.role}. The write-up shows in New in a few minutes.`,
};

export const FILL_FACTS: ActionDef = {
    id: 'fillFacts',
    label: 'Look up company facts…',
    tip: 'Ask a model to look up size, domain, founding year, culture score and other missing facts. Fills only empty fields. Uses a model, takes about 2 minutes.',
    items: ['company'],
    params: [{ kind: 'model', name: 'model', label: 'Who looks up facts', workflow: 'fill' }],
    submit: 'Start',
    disabled: (w) => w.some((l) => l.startsWith('Looking up facts')),
    // fill.yml runs claude when no model is sent.
    body: (c, v) => ({ type: 'fillFacts', company: c.company, ...(v.model !== 'claude' && { model: v.model }) }),
    done: () => 'Looking it up. This takes about 2 minutes.',
};

export const ASK: ActionDef = {
    id: 'ask',
    label: 'Ask a question…',
    tip: 'Ask the models a question about this company. Answers take a few minutes.',
    items: ['company'],
    params: [
        { kind: 'textarea', name: 'question', label: 'Question', required: true, max: 4000 },
        { kind: 'model', name: 'model', label: 'Who answers', workflow: 'ask', extra: [{ value: 'both', label: 'Both (each answers on its own)' }] },
    ],
    submit: 'Ask',
    body: (c, v) => ({ type: 'ask', company: c.company, model: v.model, question: v.question }),
    done: (_c, v, label) => `Asked ${v.model === 'both' ? 'both models' : label(v.model)}. The answer shows here in a few minutes.`,
};

const KIT_MODELS: Option[] = [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }];
const kitAction = (id: string, label: string): Pick<ActionDef, 'id' | 'label' | 'items' | 'submit' | 'disabled' | 'title'> => ({
    id, label, items: ['kit'], submit: 'Start', disabled: (w) => w.length > 0, title: () => label.replace(/…$/, ''),
});

export const KIT_REVIEW: ActionDef = {
    ...kitAction('kitReview', 'Review again…'),
    tip: "A fresh look at the current draft. It doesn't change the resume.",
    params: [
        { kind: 'choice', name: 'reviewers', label: 'Who reviews', options: [...KIT_MODELS, { value: 'both', label: 'Both (each reviews on its own)' }], default: 'both' },
        { kind: 'textarea', name: 'note', label: 'Note for the reviewers', max: 2000 },
    ],
    body: (c, v) => ({ type: 'kitReview', company: c.company, role: c.role, reviewers: v.reviewers, note: v.note }),
    done: () => 'Review started. It takes a few minutes.',
};

export const KIT_REVISE: ActionDef = {
    ...kitAction('kitRevise', 'Apply to the resume…'),
    tip: 'One model rewrites the draft from the reviews and critique and your note, then rebuilds resume.docx.',
    params: [
        { kind: 'choice', name: 'reviser', label: 'Who rewrites', options: KIT_MODELS, default: 'claude' },
        { kind: 'textarea', name: 'note', label: 'Note for the model', max: 2000 },
    ],
    body: (c, v) => ({ type: 'kitRevise', company: c.company, role: c.role, reviser: v.reviser, note: v.note }),
    done: () => 'Revising. A new draft and resume.docx land in a few minutes.',
};

export const KIT_ADD: ActionDef = {
    ...kitAction('kitAdd', 'Add a piece…'),
    tip: 'Write a cover letter or form answers for this job. Pick one you already have to write a new version.',
    params: [
        {
            kind: 'checks', name: 'pieces', label: 'Pieces', required: true,
            options: (c) => ([['cover-letter', 'Cover letter'], ['answers', 'Form answers']] as const).map(([value, label]) => ({
                value, label: (c.pieces ?? 'resume').split(',').includes(value) ? `${label} (new version)` : label,
            })),
        },
        { kind: 'choice', name: 'drafter', label: 'Who writes', options: KIT_MODELS, default: 'claude' },
        { kind: 'textarea', name: 'note', label: 'Note for the new piece', max: 2000 },
    ],
    body: (c, v) => ({ type: 'kitAdd', company: c.company, role: c.role, pieces: v.pieces, drafter: v.drafter, note: v.note }),
    done: () => 'Writing it. The new file lands in a few minutes.',
};

export const RUN_SEARCH: ActionDef = {
    id: 'runSearch',
    label: 'Run with other models…',
    tip: 'Pick the models for this run. Progress shows in the bar.',
    items: [],
    title: (c) => `Run ${c.workflowLabel}`,
    submit: 'Start',
    params: [{ kind: 'verticals', name: 'topic', label: 'Verticals', show: (c) => c.workflow === 'vertical' }, { kind: 'searchModels' }],
    body: (c, v, pick) => ({ type: 'run', workflow: c.workflow, ...(v.topic && { topic: v.topic }), ...pick }),
    done: () => 'Run started. Progress shows in the bar.',
};

// Re-check from Searches: the same confirm as Saved's button, with the count (`workflowLabel`).
export const RECHECK: ActionDef = {
    id: 'recheck',
    label: 'Re-check saved jobs',
    tip: 'Re-score saved, applying and flagged jobs against today\'s rules.',
    items: [],
    title: (c) => `Re-score ${c.workflowLabel} saved, applying and flagged jobs against today's rules? One Claude run, no web searches.`,
    submit: 'Re-check',
    params: [],
    body: () => ({ type: 'run', workflow: 'rescore' }),
    done: () => 'Re-check started. Scores update when it finishes.',
};

// A search that follows what the owner typed (the Directed page). The page's own box starts it with the default models.
export const DIRECTED_SEARCH: ActionDef = {
    workflow: 'directed',
    id: 'directedSearch',
    label: 'Start with other models…',
    tip: 'Pick the models for this search.',
    items: [],
    title: () => 'Directed search',
    submit: 'Start search',
    params: [{ kind: 'textarea', name: 'topic', label: 'What to search for', required: true, max: 2000, initial: (c) => c.topic ?? '' }, { kind: 'searchModels' }],
    body: (_c, v, pick) => ({ type: 'run', workflow: 'directed', topic: v.topic.trim(), ...pick }),
    done: () => 'Search started. Its leads show on Directed when it finishes.',
};

export const JUDGE_ROLES: ActionDef = {
    workflow: 'tracked',
    id: 'judgeRoles',
    label: 'Judge roles…',
    tip: 'Pick how many board roles to judge and which models judge them. Progress shows in the bar.',
    items: [],
    title: () => 'Judge board roles',
    submit: 'Start',
    params: [
        { kind: 'choice', name: 'count', label: 'How many', default: '30', options: [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '30', label: '30' }, { value: 'all', label: 'All, in batches of 30 until none are left' }] },
        { kind: 'searchModels' },
    ],
    body: (_c, v, pick) => ({ type: 'run', workflow: 'tracked', sweepRoles: v.count === 'all' ? 30 : Number(v.count), ...(v.count === 'all' && { chain: true }), ...pick }),
    done: (_c, v) => (v.count === 'all' ? 'Judging all of them, 30 at a time. Progress shows in the bar.' : 'Run started. Progress shows in the bar.'),
};

export const ADD_JOB: ActionDef = {
    id: 'addJob',
    label: 'Add job by link…',
    tip: 'Add a job you found yourself, using its posting link.',
    items: ['company'],
    params: [
        { kind: 'text', name: 'role', label: 'Role', required: true },
        { kind: 'text', name: 'url', label: 'Link to the posting', required: true, type: 'url' },
    ],
    submit: 'Save',
    body: (c, v) => ({ type: 'addJob', company: c.company, role: v.role, url: v.url }),
    done: (_c, v) => `Added ${v.role}.`,
};

export const MARK_APPLIED: ActionDef = {
    id: 'markApplied',
    label: (c) => (c.role ? 'Mark applied' : 'Mark applied…'),
    tip: 'Record that you applied to this job.',
    items: ['company', 'job', 'kit'],
    available: (c) => !c.applied,
    params: [
        { kind: 'text', name: 'role', label: 'Role', required: true, show: (c) => !c.role },
        { kind: 'text', name: 'url', label: 'Link to the posting (optional)', type: 'url', show: (c) => !c.role },
    ],
    submit: 'Save',
    body: (c, v) => ({
        type: 'markApplied', applicationId: crypto.randomUUID(), company: c.company,
        ...(c.role ? { postingId: c.postingId, leadKey: c.leadKey, role: c.role, url: c.url } : { role: v.role, ...(v.url && { url: v.url }) }),
    }),
    done: (c) => `${c.company}: Applied.`,
};

export const EDIT_POSTING_LINK: ActionDef = {
    id: 'editPostingLink',
    label: 'Edit posting link…',
    tip: 'Fix a wrong posting link. The job keeps its id and its state.',
    items: ['job'],
    available: (c) => Boolean(c.postingId),
    params: [{ kind: 'text', name: 'url', label: 'Link to the posting', required: true, type: 'url', initial: (c) => c.url ?? '' }],
    submit: 'Save',
    body: (c, v) => ({ type: 'setPostingUrl', company: c.company, postingId: c.postingId, url: v.url }),
    done: () => 'Link saved.',
};

export const EDIT_LINKS: ActionDef = {
    id: 'editLinks',
    label: 'Edit careers links…',
    tip: 'Set the careers page and job board links the weekly check uses.',
    items: ['company'],
    params: [
        { kind: 'text', name: 'careersUrl', label: 'Careers page', type: 'url', initial: (c) => c.careersUrl ?? '' },
        { kind: 'text', name: 'jobsUrl', label: 'Jobs board', type: 'url', initial: (c) => c.jobsUrl ?? '' },
    ],
    submit: 'Save',
    body: (c, v) => ({ type: 'setLinks', company: c.company, careersUrl: v.careersUrl, jobsUrl: v.jobsUrl }),
    done: () => 'Careers links saved.',
};

export const SWEEP_TOGGLE: ActionDef = {
    id: 'sweepToggle',
    label: (c) => (c.sweepOff ? 'Resume board sweep' : 'Stop board sweep'),
    tip: "Stop the board sweep from adding this company's roles to New.",
    items: ['company'],
    params: [],
    submit: 'Save',
    body: (c) => ({ type: 'setSweep', company: c.company, off: !c.sweepOff }),
    done: (c) => (c.sweepOff ? 'Sweeping resumed.' : 'Sweep stopped for this company.'),
};

export const RULE_OUT: ActionDef = {
    id: 'ruleOut',
    label: 'Rule out company…',
    danger: true,
    last: true,
    title: (c) => `Rule out ${c.company}`,
    tip: "Stop tracking this company. Searches won't change it again.",
    items: ['company', 'job'],
    // The dialog is the confirm: the note is optional and Rule out is the yes.
    params: [{ kind: 'reasons', name: 'reason', list: 'ruleOut', into: 'note' }, { kind: 'textarea', name: 'note', label: `Why? (optional, saved to My notes)` }],
    submit: 'Rule out company',
    body: (c, v) => ({ type: 'setStance', company: c.company, stance: 'Ruled out', ruleOutAsked: true, ...(v.note?.trim() && { note: v.note }) }),
    done: (c) => `${c.company} is ruled out.`,
};

export const ACTIONS: ActionDef[] = [REVIEW_JOB, ADD_JOB, MARK_APPLIED, EDIT_POSTING_LINK, SEARCH_JOB, FILL_FACTS, ASK, EDIT_LINKS, SWEEP_TOGGLE, RULE_OUT, KIT_REVIEW, KIT_REVISE, KIT_ADD];

export const actionsFor = (item: ItemType, ctx: Ctx): ActionDef[] =>
    ACTIONS.filter((a) => a.items.includes(item) && (a.available?.(ctx) ?? true));
