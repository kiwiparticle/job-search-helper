#!/usr/bin/env node
// triage.yml prepare: writes <dir>/context.json, marks dead postings gone, prints model=, count= and gone= for $GITHUB_OUTPUT.
// env FILTERED=true triages the roles the sweep filter dropped instead of the unjudged ones.
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { prepareTriage } from '../lib/triage.js';
import { fromEnv } from './d1rest.js';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: triage-prepare.js <dir>'); process.exit(2); }
try {
    const { model, count, gone } = await prepareTriage(fromEnv(), dir, fileURLToPath(new URL('..', import.meta.url)),
        { filtered: process.env.FILTERED === 'true', now: new Date().toISOString(), deps: { fetchImpl: fetch, lookup } });
    console.log(`model=${model}`);
    console.log(`count=${count}`);
    console.log(`gone=${gone}`);
} catch (e) { console.error(e.message); process.exit(1); }
