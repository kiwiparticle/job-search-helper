#!/usr/bin/env node
// tune-apply.yml: `edit <id>` makes the one edit in the working tree; `mark <id>` marks it applied after the push.
import { fileURLToPath } from 'node:url';
import { applyEdit, markApplied } from '../lib/tune.js';
import { fromEnv } from './d1rest.js';

const [cmd, id] = process.argv.slice(2);
const repoDir = fileURLToPath(new URL('..', import.meta.url));
try {
    if (cmd === 'edit') console.log(await applyEdit(fromEnv(), id, repoDir));
    else if (cmd === 'mark') await markApplied(fromEnv(), id);
    else { console.error('usage: tune-apply.js edit|mark <id>'); process.exit(2); }
} catch (e) { console.error(e.message); process.exit(1); }
