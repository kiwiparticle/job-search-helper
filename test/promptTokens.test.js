import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// run-model.sh replaces {{NAME}} from env (unset -> empty). Every token in a prompt must be one a caller sets.
const KNOWN = new Set(['MODEL', 'OUT', 'REPO', 'RUN_DIR', 'WORKFLOW', 'RUN_DATE', 'COMPANY_STATE', 'INPUT', 'NOTE_BLOCK',
    'CONTEXT_FILE', 'INSTRUCTIONS_FILE', 'KIT', 'ROUND', 'PIECES', 'OTHER', 'SUPPLEMENT_BLOCK',
    'APPLICATION_BLOCK', 'SEND_TO_BLOCK', 'NEXT_BLOCK']);
// Filled from data/profile.json by bin/fill-prompt.js (lib/profile.js).
import { profileSlots, cleanProfile } from '../lib/profile.js';
const PROFILE = new Set(Object.keys(profileSlots(cleanProfile({}))));
const unknownTokens = (text, known) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((n) => !known.has(n));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every {{TOKEN}} in prompts/*.md is one the runner or workflows set', () => {
    for (const f of readdirSync(new URL('../prompts', import.meta.url)).filter((f) => f.endsWith('.md'))) {
        assert.deepEqual(unknownTokens(read(`prompts/${f}`), new Set([...KNOWN, ...PROFILE])), [], f);
    }
});
test('an unknown token is reported', () => {
    assert.deepEqual(unknownTokens('a {{OUT}} b {{NOT_A_REAL_TOKEN}}', KNOWN), ['NOT_A_REAL_TOKEN']);
});
test('every allowlisted name is actually set by run-model.sh or a workflow', () => {
    const sources = [read('bin/run-model.sh'), ...readdirSync(new URL('../.github/workflows', import.meta.url)).map((f) => read(`.github/workflows/${f}`))].join('\n');
    for (const name of KNOWN) {
        // `NAME=`, `NAME:` (workflow env), `export NAME`, or `NAME="$MODEL"`-style assignment
        assert.match(sources, new RegExp(`(^|[\\s'"(])(export\\s+)?${name}\\s*[=:]|export\\s+${name}\\b`, 'm'), `${name} is never set`);
    }
});
