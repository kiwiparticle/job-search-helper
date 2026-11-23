#!/usr/bin/env node
// Adds one owner-supplied fact to master-resume.md under a heading the owner allowed (data/master-sections.json).
//   merge-master.js edit <id>   writes the line into master-resume.md (nothing else in the file changes)
//   merge-master.js mark <id>   marks the fact merged in D1, after the commit is pushed
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './d1rest.js';
import { loadSome, writeRows } from '../lib/store.js';
import { addBullet, bulletFor } from '../lib/masterMerge.js';

const read = async (db, id) => {
    const row = (await loadSome(db, 'supplement', [id])).get(id);
    if (!row) throw new Error(`No fact ${id}`);
    return row;
};

// A fact that can't be merged goes back to open with the reason, so the page can say why.
const reject = async (db, id, row, error) => {
    await writeRows(db, { supplement: [{ id, version: row.version, record: { ...row.record, status: 'open', error } }] });
    throw new Error(error);
};

export async function edit(db, { id, repoDir, today }) {
    const row = await read(db, id);
    const { text, section, status } = row.record;
    if (status === 'merged') return 'already merged';
    if (status !== 'merging' || !section) throw new Error('That fact is not waiting to be merged.');
    const sections = JSON.parse(readFileSync(`${repoDir}/data/master-sections.json`, 'utf8'));
    if (!sections.includes(section)) return reject(db, id, row, `"${section}" is not in data/master-sections.json.`);
    const path = `${repoDir}/master-resume.md`;
    const next = addBullet(readFileSync(path, 'utf8'), section, bulletFor(text, today));
    if (next === null) return reject(db, id, row, `No heading "${section}" in master-resume.md.`);
    writeFileSync(path, next);
    return 'added';
}

export async function mark(db, { id }) {
    const row = await read(db, id);
    if (row.record.status === 'merged') return;
    const { error, ...rest } = row.record;
    await writeRows(db, { supplement: [{ id, version: row.version, record: { ...rest, status: 'merged' } }] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [cmd, id] = process.argv.slice(2);
    const repoDir = fileURLToPath(new URL('..', import.meta.url));
    if (cmd === 'edit') console.log(await edit(fromEnv(), { id, repoDir, today: new Date().toISOString().slice(0, 10) }));
    else if (cmd === 'mark') await mark(fromEnv(), { id });
    else { console.error('usage: merge-master.js edit|mark <id>'); process.exit(2); }
}
