// usage: chain-next.js <runDir> <chain>   (trusted finish job; GH_TOKEN needs actions: write)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { nextBatch } from '../lib/chain.js';
import { readRoute } from '../lib/models.js';

const [dir, chain] = process.argv.slice(2);
const next = nextBatch(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')), readRoute(dir), chain);
if (!next) { console.log('chain ends here'); process.exit(0); }
execFileSync('gh', ['workflow', 'run', 'search.yml', ...Object.entries(next).flatMap(([k, v]) => ['-f', `${k}=${v}`])], { stdio: 'inherit' });
console.log('next batch started');
