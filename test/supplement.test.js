import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addBullet, bulletFor } from '../lib/masterMerge.js';
import { factsBlock, inUse } from '../lib/supplement.js';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll } from '../lib/store.js';
import { handleAction } from '../functions/lib/handlers.js';
import { edit, mark } from '../bin/merge-master.js';
import { readReview, mergeReviews } from '../lib/kitReview.js';

const MASTER = ['# Name', '', '## Experience', '', '### Job A', '', '- one', '- two', '', '### Job B', '', '- three', '', '## Skills', '', '- **Languages:** JS', ''].join('\n');

test('addBullet adds at the end of the named section only', () => {
    const out = addBullet(MASTER, 'Job A', '- new').split('\n');
    assert.deepEqual(out.slice(4, 10), ['### Job A', '', '- one', '- two', '- new', '']);
    assert.equal(out.filter((l) => l === '- new').length, 1);
    assert.ok(addBullet(MASTER, 'Skills', '- x').endsWith('- **Languages:** JS\n- x\n'), 'last section: added at the end, final newline kept');
});

test('addBullet: a ## section runs through its ### children; a missing heading returns null; a repeat changes nothing', () => {
    assert.ok(addBullet(MASTER, 'Experience', '- e').includes('- three\n- e\n'));
    assert.equal(addBullet(MASTER, 'Nope', '- x'), null);
    const once = addBullet(MASTER, 'Job B', '- again');
    assert.equal(addBullet(once, 'Job B', '- again'), once);
});

test('factsBlock uses open and merging facts, oldest first, within the budget', () => {
    const e = (id, text, status, at, question) => ({ id, text, status, at, ...(question && { question }) });
    const list = [e('2', 'second', 'open', '2026-11-02'), e('1', 'first', 'merging', '2026-11-01', 'Did you use Redis?'), e('3', 'gone', 'dismissed', '2026-11-03'), e('4', 'in master', 'merged', '2026-11-04')];
    assert.equal(inUse(list).length, 2);
    assert.equal(factsBlock(list), '- Asked: "Did you use Redis?" The owner answered: first\n- second');
    assert.equal(factsBlock(list, 30), '');
});

test('readReview keeps up to five clean questions; mergeReviews dedupes them', () => {
    const r = readReview(JSON.stringify({ keywords: [], truth: [], questions: [{ question: ' Redis? ', why: 'w' }, { question: '' }, 7, ...Array.from({ length: 9 }, (_, i) => ({ question: `q${i}` }))] }));
    assert.equal(r.questions.length, 5);
    assert.equal(r.questions[0].question, 'Redis?');
    const merged = mergeReviews({}, [{ model: 'claude', ...r }, { model: 'codex', keywords: [], truth: [], questions: [{ question: 'redis?' }] }], 'T');
    assert.equal(merged.questions.filter((q) => q.question.toLowerCase() === 'redis?').length, 1);
});

const fakeGh = () => { const dispatches = []; return { dispatches, dispatch: async (workflow, inputs) => dispatches.push({ workflow, inputs }) }; };
const call = async (db, gh, body) => { const res = await handleAction(body, { db, gh, now: () => '2026-11-18T10:00:00Z', today: () => '2026-11-18' }); return [res.status, await res.json()]; };
const fresh = async () => { const db = sqliteD1(); await applySchema(db); return db; };

test('answers are saved, shown to the next kit review, and merged under an allowed heading', async () => {
    const db = await fresh(); const gh = fakeGh();
    assert.equal((await call(db, gh, { type: 'addSupplement', text: 'Used Redis for sessions at Initech.', question: 'Redis?', kit: 'acme-staff' }))[0], 200);
    const [{ id, record }] = await loadAll(db, 'supplement');
    assert.equal(record.status, 'open');
    await call(db, gh, { type: 'kitReview', company: 'Acme', role: 'Staff', reviewers: 'both' });
    assert.match(gh.dispatches[0].inputs.supplement, /Used Redis for sessions at Initech\./);

    assert.equal((await call(db, gh, { type: 'mergeSupplement', id, section: 'Job A', text: 'Used Redis for session storage at Initech.' }))[0], 202);
    assert.deepEqual(gh.dispatches.at(-1), { workflow: 'merge-master.yml', inputs: { id } });
    assert.equal((await loadAll(db, 'supplement'))[0].record.status, 'merging');

    const dir = mkdtempSync(join(tmpdir(), 'master-'));
    writeFileSync(join(dir, 'master-resume.md'), MASTER);
    mkdirSync_(dir); writeFileSync(join(dir, 'data', 'master-sections.json'), JSON.stringify(['Job A']));
    assert.equal(await edit(db, { id, repoDir: dir, today: '2026-11-18' }), 'added');
    assert.ok(readFileSync(join(dir, 'master-resume.md'), 'utf8').includes(`- two\n${bulletFor('Used Redis for session storage at Initech.', '2026-11-18')}\n`));
    await mark(db, { id });
    assert.equal((await loadAll(db, 'supplement'))[0].record.status, 'merged');
    await call(db, gh, { type: 'kitReview', company: 'Acme', role: 'Staff', reviewers: 'both' });
    assert.equal(gh.dispatches.at(-1).inputs.supplement, undefined, 'a merged fact is in the master, not sent again');
});

test('merging under a heading the owner did not list is refused and the fact goes back to open', async () => {
    const db = await fresh(); const gh = fakeGh();
    await call(db, gh, { type: 'addSupplement', text: 'A fact.' });
    const [{ id }] = await loadAll(db, 'supplement');
    await call(db, gh, { type: 'mergeSupplement', id, section: 'Skills' });
    const dir = mkdtempSync(join(tmpdir(), 'master-'));
    writeFileSync(join(dir, 'master-resume.md'), MASTER);
    mkdirSync_(dir); writeFileSync(join(dir, 'data', 'master-sections.json'), JSON.stringify(['Job A']));
    await assert.rejects(edit(db, { id, repoDir: dir, today: '2026-11-18' }), /not in data\/master-sections\.json/);
    const { record } = (await loadAll(db, 'supplement'))[0];
    assert.equal(record.status, 'open');
    assert.match(record.error, /Skills/);
    assert.equal(readFileSync(join(dir, 'master-resume.md'), 'utf8'), MASTER);
});

test('dismiss and edit rules', async () => {
    const db = await fresh(); const gh = fakeGh();
    await call(db, gh, { type: 'addSupplement', text: 'A fact.' });
    const [{ id }] = await loadAll(db, 'supplement');
    assert.equal((await call(db, gh, { type: 'editSupplement', id, text: 'Better wording.' }))[0], 200);
    assert.equal((await call(db, gh, { type: 'dismissSupplement', id }))[0], 200);
    assert.equal((await call(db, gh, { type: 'editSupplement', id, text: 'x' }))[0], 409);
    assert.equal((await call(db, gh, { type: 'dismissSupplement', id: 'nope' }))[0], 404);
    assert.equal((await call(db, gh, { type: 'addSupplement', text: '' }))[0], 400);
});

import { mkdirSync } from 'node:fs';
function mkdirSync_(dir) { mkdirSync(join(dir, 'data'), { recursive: true }); }

test('kitAdd dispatches kit-add.yml with the open facts, and refuses a bad piece', async () => {
    const db = await fresh(); const gh = fakeGh();
    await call(db, gh, { type: 'addSupplement', text: 'Led the Redis move.' });
    assert.equal((await call(db, gh, { type: 'kitAdd', company: 'Acme', role: 'Staff', pieces: 'cover-letter,answers', drafter: 'codex', note: 'Warm tone' }))[0], 202);
    const sent = gh.dispatches.at(-1);
    assert.equal(sent.workflow, 'kit-add.yml');
    assert.deepEqual({ ...sent.inputs, supplement: undefined }, { company: 'Acme', role: 'Staff', pieces: 'cover-letter,answers', drafter: 'codex', note: 'Warm tone', supplement: undefined });
    assert.match(sent.inputs.supplement, /Led the Redis move/);
    for (const pieces of ['resume', 'answers,answers,answers', '']) assert.equal((await call(db, gh, { type: 'kitAdd', company: 'Acme', role: 'Staff', pieces, drafter: 'claude' }))[0], 400);
    assert.equal((await call(db, gh, { type: 'kitAdd', company: 'Acme', role: 'Staff', pieces: 'answers', drafter: 'gpt' }))[0], 400);
});
