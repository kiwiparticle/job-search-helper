#!/usr/bin/env node
// Sync the owner's local llama configs into data/models.json (the page's Models dialog also flips `enabled`).
import { readFileSync, writeFileSync } from 'node:fs';
import { registryText } from '../lib/modelsText.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { syncRegistry } from '../lib/syncModels.js';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// Strict: an unknown flag or a --source with no value stops here, so a real run never syncs from a file the owner did not name.
let args;
try {
    args = parseArgs({ options: { 'dry-run': { type: 'boolean' }, source: { type: 'string' } } }).values;
    if (args.source === '') throw new Error('--source needs a file');
} catch (e) {
    console.error(`sync-models: ${e.message}\nusage: sync-models.js [--dry-run] [--source <model-configs.json>]`);
    process.exit(2);
}
const dryRun = Boolean(args['dry-run']);
const source = args.source || process.env.MODEL_CONFIGS;

const fail = (msg) => { console.error(`sync-models: ${msg}`); process.exit(1); };
if (!source) fail('name the model config file with --source or MODEL_CONFIGS');

let configs;
try {
    configs = JSON.parse(readFileSync(source, 'utf8'));
} catch (e) {
    fail(`cannot read ${source} as JSON: ${e.message}`);
}
if (!configs || typeof configs !== 'object' || Array.isArray(configs)) fail(`${source} must be a JSON object keyed by alias`);

const file = join(repoDir, 'data/models.json');
let registry;
try {
    registry = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
    fail(`cannot read ${file}: ${e.message}`);
}

const { registry: next, changes } = syncRegistry(registry, configs);
for (const c of changes) console.log(c);

const text = registryText(next);

if (changes.length && !dryRun) writeFileSync(file, text);
