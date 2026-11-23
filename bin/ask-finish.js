#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { loadModels, getModel } from '../lib/models.js';
import { finishAskMany } from '../lib/askRun.js';
import { fromEnv } from './d1rest.js';

// usage: ASK_AT=<iso> ask-finish.js <model>=<askDir>…   e.g. claude=/path/.ask-claude codex=/path/.ask-codex
const registry = loadModels(fileURLToPath(new URL('..', import.meta.url)));
const targets = process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return { model: a.slice(0, i), askDir: a.slice(i + 1) };
});
if (!targets.length || targets.some((t) => !getModel(registry, t.model) || !t.askDir)) { console.error('usage: ASK_AT=<iso> ask-finish.js <model-id>=<askDir>…'); process.exit(2); }
if (!process.env.ASK_AT) { console.error('ASK_AT is not set: the workflow must pass the dispatch timestamp'); process.exit(1); }
const t = await finishAskMany(fromEnv(), fileURLToPath(new URL('..', import.meta.url)), targets, { at: process.env.ASK_AT });
console.log(`${t.company}: ${t.messages.length} messages`);
