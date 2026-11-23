#!/usr/bin/env node
// tune.yml finish: saves the model's proposals (lib/tune.js finishTune). env TUNE_AT names the run.
import { fileURLToPath } from 'node:url';
import { finishTune } from '../lib/tune.js';
import { fromEnv } from './d1rest.js';

const [dir] = process.argv.slice(2);
const at = process.env.TUNE_AT;
if (!dir || !at) { console.error('usage: TUNE_AT=<iso> tune-finish.js <dir>'); process.exit(2); }
try {
    const { saved, dropped } = await finishTune(fromEnv(), dir, fileURLToPath(new URL('..', import.meta.url)), at);
    console.log(`saved ${saved} proposals${dropped.length ? `; dropped: ${dropped.join('; ')}` : ''}`);
} catch (e) { console.error(e.message); process.exit(1); }
