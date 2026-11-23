#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { finishRun } from '../lib/run.js';
import { fromEnv } from './d1rest.js';

const [runDir] = process.argv.slice(2);
if (!runDir) { console.error('usage: finish.js <runDir>'); process.exit(2); }
const r = await finishRun(fromEnv(), fileURLToPath(new URL('..', import.meta.url)), runDir, undefined);
console.log(JSON.stringify({ run: r.run, models: r.models, counts: r.counts }));
