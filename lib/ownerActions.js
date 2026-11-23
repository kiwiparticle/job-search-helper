import { CAPS, MODEL_FIELDS } from './caps.js';
import { notesOf } from './notes.js';
import { STANCES } from './companies.js';
import { leadKey as makeLeadKey } from './keys.js';
import { postingId as makePostingId } from './postingId.js';
import { activeApplication, jobEntry } from './tags.js';

const OUTCOMES = ['applied', 'rejected', 'passed', 'no response'];
export const STAGES = ['screening', 'interviewing', 'offer'];

export const fail = (status, message, needsConfirm) => Object.assign(new Error(message), { status, expected: true, ...(needsConfirm && { needsConfirm: true }) });
export const confirmNeeded = (message) => fail(409, message, true);

const event = (c, today, text) => { (c.events ??= []).push({ date: today, text }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addAll = (list, more) => [...new Set([...(list ?? []), ...more])];
const appliedFor = (a) => `You applied for ${a.role} on ${a.appliedOn}.`;

// A second application, or a kit for another job, at a company with an open application needs a confirm.
export function guardSecondApplication(c, confirmed) {
    const app = activeApplication(c);
    if (app && !confirmed) throw confirmNeeded(`${appliedFor(app)} Apply for this one too?`);
}

const needRole = (role) => {
    if (typeof role !== 'string' || !role.trim() || role.length > 200) throw fail(400, 'Role is required, up to 200 characters.');
    return role.trim();
};
// A missing url is fine; one that is given must be http(s) and at most 500 characters.
const cleanUrl = (url) => {
    if (url == null || url === '') return undefined;
    let ok = typeof url === 'string' && url.length <= 500;
    try { ok &&= ['http:', 'https:'].includes(new URL(url).protocol); } catch { ok = false; }
    if (!ok) throw fail(400, 'The link must be http(s) and at most 500 characters.');
    return url;
};
const findApp = (c, id) => {
    const a = (c.applications ?? []).find((x) => x.id === id);
    if (!a) throw fail(404, 'No such application.');
    return a;
};

const cleanId = (v, what, required) => {
    if (v == null && !required) return;
    if (typeof v !== 'string' || !v || v.length > 200) throw fail(400, `Bad ${what}.`);
};

// `reason`: the owner's optional one-tap reason (data/reasons.json, or their own words). Every reason given is kept in
// the entry's `reasons`, so a later state change keeps the history the tune run reads.
function putJob(c, state, { postingId, leadKey, role, url, reason, today }) {
    cleanId(postingId, 'posting id', true);
    cleanId(leadKey, 'lead key');
    const clean = needRole(role);
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length > 120) throw fail(400, 'A reason is at most 120 characters.');
    c.jobs ??= {};
    const reasons = [...(c.jobs[postingId]?.reasons ?? []), ...(why ? [{ state, reason: why, at: today }] : [])];
    const fromSaved = state === 'skipped' && ['saved', 'applying'].includes(c.jobs[postingId]?.state); // Passed offers to bring it back
    c.jobs[postingId] = { state, role: clean, leadKey, ...(cleanUrl(url) && { url }), at: today, ...(reasons.length && { reasons }), ...(fromSaved && { fromSaved: today }) };
    if (!c.stance) { c.stance = 'Watching'; delete c.stanceBy; }
}

// `ruleOutAsked`: the page's Rule out dialog already asked, so only an open application still needs a second yes.
export function setStance(c, { stance, confirmed, ruleOutAsked, note, today }) {
    if (!STANCES.includes(stance)) throw fail(400, 'Unknown stance.');
    const app = activeApplication(c);
    if (!confirmed && !ruleOutAsked && stance === 'Ruled out') throw confirmNeeded(`Rule out ${c.name}?`);
    if (!confirmed && app) throw confirmNeeded(`${appliedFor(app)} Change the stance anyway?`);
    const extra = typeof note === 'string' ? note.trim() : '';
    const list = extra ? addedNote(c, undefined, extra, today, false) : null; // before any change, so a refusal leaves c alone
    event(c, today, `Stance ${c.stance || 'none'} → ${stance}`);
    c.stance = stance;
    delete c.stanceBy; // the owner set it: runs leave it alone
    delete c.ruleOutSuggested; // the owner decided
    if (list) putNotes(c, undefined, list);
    if (stance === 'Ruled out') { delete c.flag; delete c.jobFlags; } // after every guard: a refused Rule out keeps its flags
}

const dropJobFlag = (c, id) => {
    if (!c.jobFlags) return;
    delete c.jobFlags[id];
    if (!Object.keys(c.jobFlags).length) delete c.jobFlags;
};

// Flags the company, or one job when `postingId` is given, to come back to. An optional note joins the dated notes.
// Skip, Mark applied and Rule out clear the flags they make moot.
export function setFlag(c, { postingId, leadKey, role, url, on, note, today }) {
    if (typeof on !== 'boolean') throw fail(400, 'Bad flag.');
    cleanId(postingId, 'posting id');
    cleanId(leadKey, 'lead key');
    const clean = postingId ? needRole(role) : undefined;
    const link = postingId ? cleanUrl(url) : undefined;
    const text = typeof note === 'string' ? note.trim() : '';
    const list = on && text ? addedNote(c, postingId, text, today) : null; // before any change
    const was = postingId ? c.jobFlags?.[postingId] : c.flag;
    const what = postingId ? ` ${clean}` : '';
    if (on) {
        if (!was) {
            if (postingId) (c.jobFlags ??= {})[postingId] = { at: today, role: clean, leadKey, ...(link && { url: link }) };
            else c.flag = { at: today };
            event(c, today, `Flagged${what}`);
        }
        if (list) putNotes(c, postingId, list);
    } else if (was) {
        if (postingId) dropJobFlag(c, postingId); else delete c.flag;
        event(c, today, `Unflagged${what}`);
    }
}

// Marks the company so the page can show "Looking up facts" until the fill run clears it.
export function requestFill(c, { at, today }) {
    c.fillRequested = at;
    event(c, today, 'Asked a model to fill in facts');
}

export function setLinks(c, { careersUrl, jobsUrl, today }) {
    const trim = (v) => (typeof v === 'string' ? v.trim() : v);
    const next = { careersUrl: cleanUrl(trim(careersUrl)) ?? '', jobsUrl: cleanUrl(trim(jobsUrl)) ?? '' };
    if (next.careersUrl === (c.careersUrl ?? '') && next.jobsUrl === (c.jobsUrl ?? '')) return;
    Object.assign(c, next);
    event(c, today, 'Edited careers links');
}

// Stops (or resumes) the board sweep for a company: its roles stop arriving in New.
export function setSweep(c, { off, today }) {
    if (Boolean(off) === Boolean(c.sweepOff)) return;
    if (off) c.sweepOff = true; else delete c.sweepOff;
    event(c, today, off ? 'Stopped sweeping this board' : 'Resumed sweeping this board');
}

// The owner's own culture note (e.g. a Glassdoor rating a model couldn't read). Empty clears it.
export function setCulture(c, { culture, today }) {
    const next = typeof culture === 'string' ? culture.trim() : '';
    if (next.length > CAPS.culture) throw fail(400, `Culture is at most ${CAPS.culture} characters.`);
    if (next === (c.culture ?? '')) return;
    c.culture = next;
    event(c, today, 'Edited culture');
}

const MAX_NOTES = 50;
const checkNote = (text) => { if (text.length > CAPS.notes) throw fail(400, `A note is at most ${CAPS.notes} characters.`); };

// The list with one more dated note; refuses an over-long note, and a 51st unless `capped` is false (Rule out's note).
function addedNote(c, postingId, text, today, capped = true) {
    checkNote(text);
    const list = notesOf(c, postingId).map((n) => ({ ...n }));
    if (capped && list.length >= MAX_NOTES) throw fail(400, `A list holds at most ${MAX_NOTES} notes.`);
    return [...list, { at: today, text }];
}

// Stores the list, or removes the key when it is empty. Always drops the old single-string `note`.
function putNotes(c, postingId, list) {
    if (postingId) {
        if (list.length) (c.jobNotes ??= {})[postingId] = list;
        else if (c.jobNotes) { delete c.jobNotes[postingId]; if (!Object.keys(c.jobNotes).length) delete c.jobNotes; }
    } else {
        delete c.note;
        if (list.length) c.notes = list; else delete c.notes;
    }
}

// The owner's dated notes on a company, or on one job when `postingId` is given.
// No `index` + text adds one; `index` + text edits it; `index` + empty deletes it.
// With `index`, `was` must be the text the owner saw there, so a list that moved can't hit another note.
export function setNote(c, { postingId, index, was, note, today }) {
    const text = typeof note === 'string' ? note.trim() : '';
    checkNote(text);
    cleanId(postingId, 'posting id');
    let list;
    let did = 'Edited';
    if (index === undefined) {
        did = 'Added';
        if (!text) return;
        list = addedNote(c, postingId, text, today);
    } else {
        if (!Number.isInteger(index) || index < 0 || typeof was !== 'string') throw fail(400, 'Bad note index.');
        list = notesOf(c, postingId).map((n) => ({ ...n }));
        if (!list[index]) throw fail(404, 'That note is gone. Reload to see the current notes.');
        if (list[index].text !== was) throw fail(409, 'That note changed. Reload to see the current notes.');
        if (!text) { list.splice(index, 1); did = 'Deleted'; }
        else if (list[index].text === text) return;
        else list[index].text = text;
    }
    putNotes(c, postingId, list);
    event(c, today, postingId ? `${did} a job note` : `${did} note`);
}

export function saveJob(c, args) {
    putJob(c, 'saved', args);
    event(c, args.today, `Saved ${args.role}`);
}

// Apply: the job moves to Applying while its kit is drafted. The flag is moot, like on Skip.
export function applyJob(c, args) {
    putJob(c, 'applying', args);
    dropJobFlag(c, args.postingId);
    // When the kit run was dispatched, so the page can show "drafting" before GitHub lists the run.
    if (args.kitStartedAt) c.jobs[args.postingId].kitStartedAt = args.kitStartedAt;
    event(c, args.today, `Applying for ${args.role}`);
}

export function skipJob(c, args) {
    putJob(c, 'skipped', args);
    dropJobFlag(c, args.postingId);
    event(c, args.today, `Skipped ${args.role}`);
}

// "Mark read" on the Passed page: roles the models passed on are hidden like a skipped role, and the company's
// current verdict is remembered, so a changed verdict shows up again.
export function markPassedRead(c, { jobs = [], verdict, today }) {
    if (!Array.isArray(jobs) || jobs.length > 500) throw fail(400, 'Bad jobs.');
    for (const job of jobs) { putJob(c, 'skipped', { ...job, today }); dropJobFlag(c, job.postingId); }
    if (verdict) c.passedSeen = c.verdict ?? '';
    event(c, today, 'Marked passed items read');
}

// Fixes a job's link in place and keeps its id. `p` is the posting row, if there is one; the check runs again on the new link.
export function setPostingUrl(c, p, { postingId, url, today }) {
    const next = cleanUrl(typeof url === 'string' ? url.trim() : url);
    if (!next) throw fail(400, 'Add a link to the job posting.');
    const entry = c.jobs?.[postingId] ?? (p && jobEntry(c, p));
    if (!entry && !p) throw fail(404, 'No such job.');
    if ((entry?.url ?? p?.url) === next) return;
    if (entry) entry.url = next;
    if (p) {
        p.url = next;
        delete p.posted; delete p.postedCheckedAt; delete p.goneAt;
    }
    event(c, today, `Edited link for ${entry?.role ?? p.role}`);
}

// Whether the search had seen a job before the owner added it by hand (set by the handler from the postings table, never by the page).
export const COVERAGE = ['unseen', 'unjudged', 'filtered', 'passed', 'lead'];

export function addJob(c, { role, url, coverage, today }) {
    const clean = needRole(role);
    if (!url) throw fail(400, 'Add a link to the job posting.');
    const postingId = makePostingId({ url, company: c.name, role: clean });
    putJob(c, 'saved', { postingId, leadKey: makeLeadKey(c.name, clean), role: clean, url, today });
    if (COVERAGE.includes(coverage)) c.jobs[postingId].coverage = coverage;
    event(c, today, `Added job ${clean}`);
}

export function markApplied(c, { applicationId, postingId, leadKey, role, url, confirmed, today }) {
    const clean = needRole(role);
    if (typeof applicationId !== 'string' || !applicationId || applicationId.length > 100) throw fail(400, 'Bad application id.');
    cleanId(postingId, 'posting id');
    cleanId(leadKey, 'lead key');
    const id = postingId ?? (url ? makePostingId({ url, company: c.name, role: clean }) : undefined);
    const lead = leadKey ?? makeLeadKey(c.name, clean);
    const apps = c.applications ??= [];
    if (apps.some((a) => a.id === applicationId)) throw fail(409, 'That application is already recorded.');
    if (apps.some((a) => a.outcome === 'applied' && ((id && a.postingId === id) || a.leadKey === lead))) throw fail(409, 'You already have an open application for this job.');
    guardSecondApplication(c, confirmed);
    apps.push({ id: applicationId, ...(id && { postingId: id }), leadKey: lead, role: clean, ...(cleanUrl(url) && { url }), appliedOn: today, outcome: 'applied' });
    if (id) dropJobFlag(c, id);
    event(c, today, `Applied for ${clean}`);
}

export function setOutcome(c, { applicationId, outcome, reason, confirmed, today }) {
    if (!OUTCOMES.includes(outcome)) throw fail(400, 'Unknown outcome.');
    const a = findApp(c, applicationId);
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (outcome === 'passed' && (!why || why.length > 500)) throw fail(400, 'Say why you passed, up to 500 characters.');
    if (outcome === 'applied' && a.outcome !== 'applied') {
        const open = (c.applications ?? []).filter((x) => x !== a && x.outcome === 'applied');
        if (open.some((x) => (a.postingId && x.postingId === a.postingId) || (a.leadKey && x.leadKey === a.leadKey))) throw fail(409, 'You already have an open application for this job.');
        if (open.length && !confirmed) throw confirmNeeded(`${appliedFor(open[0])} Apply for this one too?`);
    }
    a.outcome = outcome;
    delete a.reason;
    delete a.outcomeOn;
    if (outcome === 'passed') a.reason = why;
    if (outcome !== 'applied') a.outcomeOn = today;
    delete a.stage;
    delete a.stageOn;
    delete a.next;
    event(c, today, {
        applied: `Reopened application for ${a.role}`,
        rejected: `Rejected for ${a.role}`,
        passed: `Passed: ${why}`,
        'no response': `No response for ${a.role}`,
    }[outcome]);
}

const openApp = (c, id) => {
    const a = findApp(c, id);
    if (a.outcome !== 'applied') throw fail(409, 'That application is not open.');
    return a;
};

// stage '' clears it.
export function setStage(c, { applicationId, stage, today }) {
    if (stage !== '' && !STAGES.includes(stage)) throw fail(400, 'Unknown stage.');
    const a = openApp(c, applicationId);
    if (stage) a.stage = stage; else delete a.stage;
    a.stageOn = today;
    event(c, today, stage ? `Moved ${a.role} to ${stage[0].toUpperCase()}${stage.slice(1)}` : `Cleared stage for ${a.role}`);
}

// YYYY-MM-DD that names a real calendar day (2026-02-30 and 2026-13-01 don't).
const realDate = (on) => {
    if (typeof on !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(on)) return false;
    const t = Date.parse(`${on}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(on);
};

// Empty text clears the next step. `on` is an optional YYYY-MM-DD date.
export function setNextStep(c, { applicationId, text, on, today }) {
    const a = openApp(c, applicationId);
    const t = typeof text === 'string' ? text.trim() : '';
    if (t.length > 200) throw fail(400, 'Next step is at most 200 characters.');
    if (on != null && on !== '' && !realDate(on)) throw fail(400, 'The date must be a real date like 2026-11-24.');
    if (t) a.next = { text: t, ...(on && { on }) }; else delete a.next;
}

// Free text (a name, an email, or both) for the follow-up draft. Empty clears it.
export function setSendTo(c, { applicationId, sendTo, today }) {
    const a = openApp(c, applicationId);
    const t = typeof sendTo === 'string' ? sendTo.trim() : '';
    if (t.length > 200) throw fail(400, 'Send-to is at most 200 characters.');
    if (t === (a.sendTo ?? '')) return;
    if (t) a.sendTo = t; else delete a.sendTo;
    event(c, today, `Send-to set for ${a.role}`);
}

export function deleteApplication(c, { applicationId, confirmed, today }) {
    const a = findApp(c, applicationId);
    if (!confirmed) throw confirmNeeded(`Delete the application for ${a.role}?`);
    c.applications = c.applications.filter((x) => x !== a);
    event(c, today, `Deleted application for ${a.role}`);
}

export function addPostingLink(c, { applicationId, url, today }) {
    const a = findApp(c, applicationId);
    if (!cleanUrl(url)) throw fail(400, 'A link is required.');
    a.url = url;
    a.postingId = makePostingId({ url, company: c.name, role: a.role });
    a.leadKey = makeLeadKey(c.name, a.role);
    event(c, today, `Added posting link for ${a.role}`);
}

export function markSeen(c, { postingIds, goneAtById, today }) {
    const ids = new Set(postingIds);
    const targets = [...Object.entries(c.jobs ?? {}).filter(([id]) => ids.has(id)).map(([id, j]) => [id, j]),
        ...(c.applications ?? []).filter((a) => ids.has(a.postingId)).map((a) => [a.postingId, a])];
    for (const [id, t] of targets) t.seenGone = goneAtById?.[id] ?? today;
    event(c, today, `Marked ${targets.length} taken-down posting${targets.length === 1 ? '' : 's'} seen`);
}

// Passed page: the owner declines a model's suggestion to rule the company out. The stance becomes the owner's
// (Watching when it was empty), so runs no longer change it or suggest ruling it out.
export function keepCompany(c, { today }) {
    if (!c.ruleOutSuggested) throw fail(404, 'Nothing to keep.');
    delete c.ruleOutSuggested;
    delete c.stanceBy;
    if (!c.stance) c.stance = 'Watching';
    event(c, today, `Kept: not ruling out (stance ${c.stance})`);
}

// A field applies only if it still equals its `base` value (rolesSkipped is a set-add with no check).
// Moved fields are skipped and named in the event; if every field moved, nothing applies (409).
// Only MODEL_FIELDS can change; anything else a model wrote (applications, jobs, events, override) is ignored.
function applyFields(c, { base, changes: raw }, confirmed, who, today) {
    const changes = Object.fromEntries(Object.entries(raw ?? {}).filter(([f]) => MODEL_FIELDS.includes(f)));
    const all = Object.keys(changes);
    if (!all.length) throw fail(400, 'This proposal has nothing that can be applied.');
    const moved = all.filter((f) => f !== 'rolesSkipped' && !same(c[f], base?.[f]));
    const fields = all.filter((f) => !moved.includes(f));
    if (!fields.length) throw fail(409, `These changed since the run: ${moved.join(', ')}. Keep as is, or wait for the next run.`);
    const app = activeApplication(c);
    if (!confirmed && 'stance' in changes && changes.stance !== c.stance) {
        if (changes.stance === 'Ruled out') throw confirmNeeded(`Rule out ${c.name}?`);
        if (app) throw confirmNeeded(`${appliedFor(app)} Change the stance anyway?`);
    }
    for (const f of fields) c[f] = f === 'rolesSkipped' ? addAll(c.rolesSkipped, changes[f]) : changes[f];
    if (fields.includes('stance')) delete c.stanceBy;
    event(c, today, `Accepted ${who}: ${fields.join(', ')}${moved.length ? ` (skipped, changed since the run: ${moved.join(', ')})` : ''}`);
}

const findProposal = (c, id) => {
    const p = (c.proposals ?? []).find((x) => x.id === id);
    if (!p) throw fail(404, 'No such proposal.');
    return p;
};

export function applyProposal(c, { id, confirmed, today }) {
    const p = findProposal(c, id);
    applyFields(c, p, confirmed, `${p.by}'s proposal`, today);
    c.proposals = c.proposals.filter((x) => x !== p);
}

export function dismissProposal(c, { id, today }) {
    const p = findProposal(c, id);
    c.proposals = c.proposals.filter((x) => x !== p);
    event(c, today, `Dismissed ${p.by}'s proposal`);
}

export function undoChange(c, { fields, today }) {
    const names = Object.keys(fields ?? {});
    if (!names.length) throw fail(400, 'Nothing to undo.');
    const moved = names.filter((f) => !same(c[f], fields[f].to));
    if (moved.length) throw fail(409, `These changed since the run: ${moved.join(', ')}. Nothing was undone.`);
    for (const f of names) c[f] = fields[f].from;
    event(c, today, `Undid run changes: ${names.join(', ')}`);
}

export function mergeInto(target, source, { today } = {}) {
    if (target.key === source.key) throw fail(400, 'Those are the same company.');
    if (!target.stance) { target.stance = source.stance; if (source.stanceBy) target.stanceBy = source.stanceBy; }
    target.jobs = { ...source.jobs, ...target.jobs };
    if (source.flag) target.flag ??= source.flag;
    const jobFlags = { ...source.jobFlags, ...target.jobFlags };
    if (Object.keys(jobFlags).length) target.jobFlags = jobFlags;
    const both = (id) => [...notesOf(target, id), ...notesOf(source, id)].slice(-MAX_NOTES);
    if (notesOf(source).length) putNotes(target, undefined, both());
    for (const id of Object.keys(source.jobNotes ?? {})) putNotes(target, id, both(id));
    const haveApps = new Set((target.applications ?? []).map((a) => a.id));
    target.applications = [...(target.applications ?? []), ...(source.applications ?? []).filter((a) => !haveApps.has(a.id))];
    const haveProps = new Set((target.proposals ?? []).map((p) => p.id));
    target.proposals = [...(target.proposals ?? []), ...(source.proposals ?? []).filter((p) => !haveProps.has(p.id))];
    target.aliases = addAll(target.aliases, [source.name, ...(source.aliases ?? [])]);
    target.rolesSkipped = addAll(target.rolesSkipped, source.rolesSkipped ?? []);
    target.events = [...(target.events ?? []), ...(source.events ?? [])];
    if (target.possibleDuplicateOf === source.key) delete target.possibleDuplicateOf;
    event(target, today, `Merged ${source.name} into this company`);
}

export function keepSeparate(c, { otherKey, today }) {
    if (typeof otherKey !== 'string' || !otherKey) throw fail(400, 'Which company?');
    delete c.possibleDuplicateOf;
    c.distinctFrom = addAll(c.distinctFrom, [otherKey]);
    event(c, today, `Kept separate from ${otherKey}`);
}
