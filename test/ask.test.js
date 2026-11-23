import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadPath, appendAskMany, contextMessages } from '../lib/ask.js';
import { prepareAsk, finishAskMany, findLead } from '../lib/askRun.js';
import { blankCompany } from '../lib/companies.js';
import { writeRows, loadAll } from '../lib/store.js';
import { sqliteD1, applySchema } from './sqliteD1.js';

const NAME = 'Lantern Foundation (nonprofit)';
const empty = (company) => ({ company, messages: [] });
const reply = (model, answer, status = 'ok') => ({ model, answer, status });

test('threadPath keys by company, ignoring notes and case', () => {
    assert.equal(threadPath(NAME), 'asks/lanternfoundation.json');
    assert.equal(threadPath('lantern foundation'), 'asks/lanternfoundation.json');
});

test('appendAskMany adds the question and each reply, text only', () => {
    const t = appendAskMany(empty('Lantern'), { question: 'Dig deeper', replies: [reply('claude', 'Found X.')], at: 'T' });
    assert.deepEqual(t.messages, [{ by: 'owner', text: 'Dig deeper', at: 'T' }, { by: 'claude', text: 'Found X.', at: 'T' }]);
});

test('a missing answer is recorded as a failure, not dropped', () => {
    const t = appendAskMany(empty('Lantern'), { question: 'q', replies: [reply('claude', '', 'limit')], at: 'T' });
    assert.match(t.messages[1].text, /usage limit/);
    assert.equal(t.messages[1].failed, true);
});

test('appending the same at twice adds nothing the second time', () => {
    const args = { question: 'q', replies: [reply('claude', 'a')], at: 'T' };
    assert.equal(appendAskMany(appendAskMany(empty('G'), args), args).messages.length, 2);
});

test('context keeps only the last 20 messages', () => {
    const t = { company: 'G', messages: Array.from({ length: 30 }, (_, i) => ({ by: 'owner', text: String(i) })) };
    const ctx = contextMessages(t);
    assert.equal(ctx.length, 20);
    assert.equal(ctx[0].text, '10');
});

async function setup(record = {}) {
    const db = sqliteD1();
    await applySchema(db);
    const co = { ...blankCompany(NAME), stance: 'Watching', domain: 'Publishing', events: [{ run: 'x' }], ...record };
    const posting = { id: 'b', companyKey: co.key, role: 'Newest posting', url: 'https://x.test/b', firstSeen: '2026-11-02', lastRun: 'b-new' };
    await writeRows(db, { companies: [{ id: co.key, version: null, record: co }], postings: [{ id: 'b', version: null, record: posting }] });
    const r = mkdtempSync(join(tmpdir(), 'jsask-'));
    mkdirSync(join(r, 'runs', 'b-new'), { recursive: true });
    writeFileSync(join(r, 'runs', 'index.json'), JSON.stringify([{ run: 'b-new' }]));
    writeFileSync(join(r, 'runs', 'b-new', 'report.json'), JSON.stringify({ leads: [], nearMisses: [{ company: 'Lantern Foundation', role: 'Staff Product Engineer' }] }));
    return { db, r, key: co.key };
}
const record = async (db) => (await loadAll(db, 'companies'))[0].record;
const answer = (dir, text, patch) => {
    writeFileSync(join(dir, 'status.txt'), 'ok');
    writeFileSync(join(dir, 'answer.md'), text);
    if (patch) writeFileSync(join(dir, 'ledger-patch.json'), JSON.stringify(patch));
};

test('findLead takes the newest run that mentions the company', async () => {
    const { r } = await setup();
    assert.equal(findLead(r, NAME).role, 'Staff Product Engineer');
});

test('prepare gives the record without events, slim postings and the newest write-up', async () => {
    const { db, r } = await setup();
    const dir = join(r, '.ask');
    await prepareAsk(db, r, dir, { company: NAME, question: 'Live?' });
    const ctx = JSON.parse(readFileSync(join(dir, 'context.json'), 'utf8'));
    assert.equal(ctx.row.stance, 'Watching');
    assert.equal(ctx.row.events, undefined);
    assert.deepEqual(ctx.postings.map((p) => p.role), ['Newest posting']);
    assert.equal(ctx.lead.role, 'Staff Product Engineer');
});

test('a reply with a proposal lands on the company with base; the thread has no status', async () => {
    const { db, r } = await setup();
    const dir = join(r, '.ask');
    await prepareAsk(db, r, dir, { company: NAME, question: 'Live?' });
    answer(dir, 'Yes, live.\nMore.', { company: 'Lantern Foundation', stance: 'Dormant', reason: 'Closed.', override: 'yes' });
    const t = await finishAskMany(db, r, [{ askDir: dir, model: 'claude' }], { at: 'T1' });
    const { proposals } = await record(db);
    assert.equal(proposals.length, 1);
    assert.deepEqual(proposals[0].base, { stance: 'Watching', reason: '' });
    assert.deepEqual(proposals[0].changes, { stance: 'Dormant', reason: 'Closed.' });
    assert.deepEqual([proposals[0].by, proposals[0].at, proposals[0].text], ['claude', 'T1', 'Yes, live.']);
    assert.match(proposals[0].id, /^[0-9a-f]{8}$/);
    assert.equal(JSON.stringify(t).includes('status'), false);
    assert.equal(t.messages[1].proposal, undefined);
});

test('applications, jobs and events in a proposal are dropped; a patch for another company is ignored', async () => {
    const { db, r } = await setup();
    const dir = join(r, '.ask');
    await prepareAsk(db, r, dir, { company: NAME, question: 'q' });
    answer(dir, 'a', [{ company: NAME, size: '50', applications: [{ x: 1 }], jobs: { a: {} }, events: [] }, { company: 'Lanternby', stance: 'Dormant' }]);
    await finishAskMany(db, r, [{ askDir: dir, model: 'codex' }], { at: 'T' });
    const { proposals, applications, jobs } = await record(db);
    assert.deepEqual(proposals[0].changes, { size: '50' });
    assert.deepEqual([applications, jobs], [[], {}]);
});

test('a patch that cleans to nothing (owner status) makes no proposal', async () => {
    const { db, r } = await setup();
    const dir = join(r, '.ask');
    await prepareAsk(db, r, dir, { company: NAME, question: 'q' });
    answer(dir, 'a', { company: NAME, status: 'Applied' });
    await finishAskMany(db, r, [{ askDir: dir, model: 'claude' }], { at: 'T' });
    assert.deepEqual((await record(db)).proposals, []);
});

test('finishing twice with the same at: one proposal per reply, thread from a fresh copy gets each reply once', async () => {
    const { db, r } = await setup();
    const dirs = { claude: join(r, '.ask-claude'), codex: join(r, '.ask-codex') };
    for (const m of ['claude', 'codex']) await prepareAsk(db, r, dirs[m], { company: NAME, question: 'Pay?' });
    answer(dirs.claude, '$140k.', { company: NAME, size: '50' });
    answer(dirs.codex, '$150k.', { company: NAME, size: '60' });
    const targets = [{ askDir: dirs.claude, model: 'claude' }, { askDir: dirs.codex, model: 'codex' }];
    await finishAskMany(db, r, targets, { at: 'T' });
    // The push failed: the redo starts from a checkout without the thread file.
    const fresh = mkdtempSync(join(tmpdir(), 'jsask-'));
    cpSync(dirs.claude, join(fresh, '.ask-claude'), { recursive: true });
    cpSync(dirs.codex, join(fresh, '.ask-codex'), { recursive: true });
    const t = await finishAskMany(db, fresh, [{ askDir: join(fresh, '.ask-claude'), model: 'claude' }, { askDir: join(fresh, '.ask-codex'), model: 'codex' }], { at: 'T' });
    assert.equal((await record(db)).proposals.length, 2);
    assert.deepEqual(t.messages.map((m) => m.by), ['owner', 'claude', 'codex']);
});

test('a stale write redoes on the reloaded company', async () => {
    const { db, r, key } = await setup();
    const dir = join(r, '.ask');
    await prepareAsk(db, r, dir, { company: NAME, question: 'q' });
    answer(dir, 'a', { company: NAME, size: '50' });
    const real = db.batch.bind(db);
    let first = true;
    db.batch = async (stmts) => {
        if (first) {
            first = false;
            const [row] = await loadAll(db, 'companies');
            await writeRows(db, { companies: [{ id: key, version: row.version, record: { ...row.record, domain: 'Moved' } }] });
        }
        return real(stmts);
    };
    await finishAskMany(db, r, [{ askDir: dir, model: 'claude' }], { at: 'T' });
    const rec = await record(db);
    assert.equal(rec.domain, 'Moved');
    assert.equal(rec.proposals.length, 1);
});

test('finishAskMany without at throws', async () => {
    const { db, r } = await setup();
    await assert.rejects(finishAskMany(db, r, [{ askDir: r, model: 'claude' }], {}), /at/);
});
