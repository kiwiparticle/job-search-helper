#!/usr/bin/env node
// tune.yml prepare: writes <dir>/context.json and prints model=<id> and count=<reasons> for $GITHUB_OUTPUT.
import { fileURLToPath } from 'node:url';
import { prepareTune } from '../lib/tune.js';
import { fromEnv } from './d1rest.js';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: tune-prepare.js <dir>'); process.exit(2); }
try {
    const { model, count } = await prepareTune(fromEnv(), dir, fileURLToPath(new URL('..', import.meta.url)));
    console.log(`model=${model}`);
    console.log(`count=${count}`);
} catch (e) { console.error(e.message); process.exit(1); }
