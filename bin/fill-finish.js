#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { finishFill } from '../lib/fill.js';
import { fromEnv } from './d1rest.js';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: FILL_AT=<iso> fill-finish.js <dir>'); process.exit(2); }
const at = process.env.FILL_AT;
if (!at) { console.error('FILL_AT is not set: the workflow must pass the dispatch timestamp'); process.exit(1); }
try { await finishFill(fromEnv(), dir, { today: at.slice(0, 10), at }); } catch (e) { console.error(e.message); process.exit(1); }
