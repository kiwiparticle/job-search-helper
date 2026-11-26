#!/usr/bin/env node
// triage.yml finish: saves the model's keep/drop verdicts (lib/triage.js finishTriage). env TRIAGE_AT names the run, MODEL is who judged.
import { finishTriage } from '../lib/triage.js';
import { fromEnv } from './d1rest.js';

const [dir, ctxDir] = process.argv.slice(2);
const { TRIAGE_AT: at, MODEL: model } = process.env;
if (!dir || !ctxDir || !at || !model) { console.error('usage: TRIAGE_AT=<iso> MODEL=<id> triage-finish.js <out dir> <context dir>'); process.exit(2); }
try {
    const { kept, dropped, missing } = await finishTriage(fromEnv(), dir, ctxDir, { at, model, ghRun: process.env.GITHUB_RUN_ID });
    console.log(`kept ${kept}, dropped ${dropped}${missing ? `, ${missing} not answered (tried again next run)` : ''}`);
} catch (e) { console.error(e.message); process.exit(1); }
