#!/usr/bin/env node
// rescore.yml prepare: writes <dir>/context.json and prints model= and count= for $GITHUB_OUTPUT (count 0 skips the model).
import { fileURLToPath } from 'node:url';
import { prepareRescore } from '../lib/rescore.js';
import { fromEnv } from './d1rest.js';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: rescore-prepare.js <dir>'); process.exit(2); }
try {
    const { model, count } = await prepareRescore(fromEnv(), dir, fileURLToPath(new URL('..', import.meta.url)));
    console.log(`model=${model}`);
    console.log(`count=${count}`);
} catch (e) { console.error(e.message); process.exit(1); }
