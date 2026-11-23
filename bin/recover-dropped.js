#!/usr/bin/env node
// Adds the companies and finds runs dropped for the new-company limit. No args: every run whose report shows drops.
// usage: recover-dropped.js [runs/<run> ...]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { droppedForLimit, recoverDropped } from '../lib/run.js';
import { fromEnv } from './d1rest.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const report = (dir) => (existsSync(join(dir, 'report.json')) ? JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) : null);
const args = process.argv.slice(2);
const dirs = args.length ? args : readdirSync(join(repo, 'runs')).map((n) => join(repo, 'runs', n)).filter((d) => droppedForLimit(report(d)).length);
const db = fromEnv();
for (const dir of dirs) console.log(JSON.stringify(await recoverDropped(db, dir)));
