#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { prepareFill } from '../lib/fill.js';
import { fromEnv } from './d1rest.js';

const [dir, company] = process.argv.slice(2);
if (!dir || !company) { console.error('usage: fill-prepare.js <dir> <company>'); process.exit(2); }
try { await prepareFill(fromEnv(), dir, company); } catch (e) { console.error(e.message); process.exit(1); }
