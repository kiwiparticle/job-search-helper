#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { reviewInput } from '../lib/run.js';
import { readRoute, loadModels, getModel } from '../lib/models.js';
import { loadProfile, profileSlots, fillSlots } from '../lib/profile.js';
import { capItems, estimateTokens, limitTokens } from '../lib/budget.js';

const [runDir, reviewer, outFile] = process.argv.slice(2);
if (!runDir || !reviewer || !outFile) { console.error('usage: review-input.js <runDir> <reviewer> <outFile>'); process.exit(2); }
let items = reviewInput(runDir, reviewer, readRoute(runDir));
// A local reviewer gets only the items that fit its budget: 60% of ctx minus prompt and instructions.
// Gap: run-model.sh's check does not count .review/input.json (the input capped here), so this cap is its only guard.
const m = getModel(loadModels('.'), reviewer);
if (m?.ctx) {
    const slots = profileSlots(loadProfile('.'));
    const fixed = ['prompts/review.md', m.instructions || 'instructions.md'].map((f) => estimateTokens(fillSlots(readFileSync(f, 'utf8'), slots, {})));
    const room = limitTokens(m.ctx) - fixed[0] - fixed[1];
    const all = items.length;
    items = capItems(items, room);
    // Left-out finds show as unreviewed in the report; say why in the job log.
    if (items.length < all) console.error(`warning: ${all - items.length} of ${all} finds left out of review for ${reviewer}: ${room <= 0 ? `no room left after the prompt and instructions (${room} tokens)` : `they do not fit its context (${room} tokens free)`}`);
}
writeFileSync(outFile, JSON.stringify(items, null, 2) + '\n');
console.log(items.length);
