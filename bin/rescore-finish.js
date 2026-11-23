#!/usr/bin/env node
// rescore.yml finish: saves the model's re-scores (lib/rescore.js finishRescore). env RESCORE_AT names the run, MODEL is who scored.
import { finishRescore } from '../lib/rescore.js';
import { fromEnv } from './d1rest.js';

const [dir, ctxDir] = process.argv.slice(2);
const { RESCORE_AT: at, MODEL: model } = process.env;
if (!dir || !ctxDir || !at || !model) { console.error('usage: RESCORE_AT=<iso> MODEL=<id> rescore-finish.js <out dir> <context dir>'); process.exit(2); }
try {
    const r = await finishRescore(fromEnv(), dir, ctxDir, { at, model });
    console.log(`${r.changed} changed, ${r.unchanged} unchanged, ${r.rewritten} fingerprints rewritten, ${r.skipped} skipped, ${r.dropped} dropped`);
} catch (e) { console.error(e.message); process.exit(1); }
