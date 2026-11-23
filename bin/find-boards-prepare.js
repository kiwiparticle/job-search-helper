#!/usr/bin/env node
// find-boards.yml prepare: writes <dir>/targets.json (tracked companies with a page and no known board) and prints count=.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromEnv } from './d1rest.js';
import { loadAll } from '../lib/store.js';
import { browserTargets } from '../lib/boardResolve.js';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: find-boards-prepare.js <dir>'); process.exit(2); }
const db = fromEnv();
const targets = browserTargets((await loadAll(db, 'companies')).map((r) => r.record), (await loadAll(db, 'postings')).map((r) => r.record));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'targets.json'), JSON.stringify(targets) + '\n');
console.log(`count=${targets.length}`);
