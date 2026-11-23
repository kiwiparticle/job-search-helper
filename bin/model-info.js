#!/usr/bin/env node
// usage: model-info.js <id>                          -> <runner>\t<model>\t<ctx>\t<instructions>; exit 1 unknown/disabled
//        model-info.js <id> --check <file> [files..] -> exit 3 when the files would not fit 60% of the model's ctx
import { readFileSync } from 'node:fs';
import { loadModels, getModel } from '../lib/models.js';
import { estimateTokens, limitTokens } from '../lib/budget.js';

const root = new URL('..', import.meta.url).pathname;
const [id, flag, ...files] = process.argv.slice(2);
const m = getModel(loadModels(root), id);
if (!m || m.enabled === false) process.exit(1);
if (flag === '--check') {
    if (!m.ctx) process.exit(0);
    const need = estimateTokens(files.map((f) => readFileSync(f, 'utf8')).join('\n'));
    if (need > limitTokens(m.ctx)) {
        console.error(`input is about ${need} tokens; ${id} allows ${limitTokens(m.ctx)} (60% of ctx ${m.ctx}); the input exceeds that`);
        process.exit(3);
    }
    process.exit(0);
}
console.log([m.runner, m.model || '-', m.ctx || '-', m.instructions || '-'].join('\t'));
