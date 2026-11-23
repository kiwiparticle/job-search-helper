#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { prepareAsk } from '../lib/askRun.js';
import { fromEnv } from './d1rest.js';

const askDirs = process.argv.slice(2);
const { COMPANY: company, QUESTION: question } = process.env;
if (!askDirs.length || !company || !question) { console.error('usage: COMPANY=… QUESTION=… ask-prepare.js <askDir>…'); process.exit(2); }
const repo = fileURLToPath(new URL('..', import.meta.url));
const db = fromEnv();
for (const dir of askDirs) await prepareAsk(db, repo, dir, { company, question });
