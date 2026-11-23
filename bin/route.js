#!/usr/bin/env node
// usage: route.js <runDir>   env: SEARCHERS (comma list), REVIEWER (optional), WORKFLOW
// Prints searchers=<JSON> and reviewers=<JSON> for $GITHUB_OUTPUT.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { estimateTokens, limitTokens, trimContext } from '../lib/budget.js';
import { loadProfile, profileSlots, fillSlots } from '../lib/profile.js';
import { loadModels, resolveRoute, reviewersOf, getModel } from '../lib/models.js';

const [runDir] = process.argv.slice(2);
if (!runDir) { console.error('usage: route.js <runDir>'); process.exit(2); }

let route;
try {
    const registry = loadModels('.');
    const searchers = (process.env.SEARCHERS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const reviewer = (process.env.REVIEWER || '').trim();
    const r = resolveRoute(registry, {
        workflow: process.env.WORKFLOW || undefined,
        searchers: searchers.length ? searchers : undefined,
        // 'none' = no review, 'each' = each other; resolveRoute handles both.
        reviewer: reviewer || undefined,
    });
    route = r;
    // Local searchers (registry ctx) must fit 60% of ctx: prompt + instructions + context. company-state.jsonl is not
    // counted: prompts say to grep it. A context that does not fit is trimmed into context-<id>.json.
    const ctxPath = join(runDir, 'context.json');
    const context = existsSync(ctxPath) ? JSON.parse(readFileSync(ctxPath, 'utf8')) : {};
    const trimmed = {};
    for (const id of r.searchers) {
        const m = getModel(registry, id);
        if (!m.ctx) continue;
        const slots = profileSlots(loadProfile('.'));
        // The prompt is sized as run-model.sh will send it: profile slots filled.
        const fixed = ['prompts/search.md', m.instructions || 'instructions.md'].map((f) => fillSlots(readFileSync(f, 'utf8'), slots, {}));
        const need = (c) => estimateTokens([...fixed, JSON.stringify(c, null, 2) + '\n'].join('\n'));
        const limit = limitTokens(m.ctx);
        if (need(context) <= limit) continue;
        const t = trimContext(context, (c) => need(c) <= limit);
        if (!t) throw new Error(`${id} cannot fit: about ${need({ ...context, sweep: [], manualTargets: [], rotation: [] })} tokens with nothing left to trim, limit ${limit} tokens`);
        const names = (a, b) => (a ?? []).slice(b.length).map((e) => e.company);
        writeFileSync(join(runDir, `context-${id}.json`), JSON.stringify(t.context, null, 2) + '\n');
        trimmed[id] = {
            dropped: t.dropped,
            sweep: names(context.sweep, t.context.sweep),
            manualTargets: names(context.manualTargets, t.context.manualTargets),
        };
    }
    if (Object.keys(trimmed).length) route.trimmed = trimmed;
} catch (e) {
    console.error(`route error: ${e.message}`);
    process.exit(1);
}
writeFileSync(join(runDir, 'route.json'), JSON.stringify(route, null, 2) + '\n');
console.log(`searchers=${JSON.stringify(route.searchers)}`);
console.log(`reviewers=${JSON.stringify(reviewersOf(route))}`);
