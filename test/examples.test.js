import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanProfile } from '../lib/profile.js';
import { loadFilter, DEFAULT_DROP } from '../lib/sweepFilter.js';
import { loadModels } from '../lib/models.js';
import { cleanSchedule } from '../lib/schedule.js';

const text = (p) => readFileSync(`examples/${p}`, 'utf8');
const json = (p) => JSON.parse(text(p));

test('example instructions carry the sections the prompts read', () => {
    for (const f of ['instructions.md', 'instructions-local.md']) {
        const heads = text(f).split('\n').filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+ /, ''));
        for (const h of ['Hard Skips', 'Hard requirements', 'Level and title', 'Technical fit', 'On-call', 'Output (per lead)', 'Reporting filter']) {
            assert.ok(heads.some((x) => x.startsWith(h)), `${f} lacks ${h}`);
        }
    }
});

test('example profile, filter, models, schedule and master load', () => {
    const p = cleanProfile(json('data/profile.json'));
    assert.ok(p.who);
    assert.equal(typeof p.payFloor, 'number');
    const f = loadFilter('examples');
    assert.ok(f);
    assert.deepEqual(f.titleDrop, DEFAULT_DROP);
    assert.deepEqual(f.locations, []);
    const ids = loadModels('examples').models.map((m) => m.id);
    assert.ok(ids.includes('claude') && ids.includes('codex'));
    const s = json('data/schedule.json');
    assert.deepEqual(cleanSchedule(s), s);
    const master = text('master-resume.md');
    for (const h of json('data/master-sections.json')) assert.ok(master.includes(`## ${h}`), h);
});

test('example instructions have a fingerprint section (rescore reads it by that word)', () => {
    assert.ok(text('instructions.md').split('\n').some((l) => /^#{2,3} .*fingerprint/i.test(l)));
});
