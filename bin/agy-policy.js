#!/usr/bin/env node
// usage: agy-policy.js <repo> <outDir> <file>. Writes the per-call agy settings ({ permissions }) to <file>; agy-run.sh passes it as --settings.
import { writeFileSync } from 'node:fs';
import { agyPermissions } from '../lib/agyPolicy.js';

const [repo, out, file] = process.argv.slice(2);
writeFileSync(file, JSON.stringify({ permissions: agyPermissions({ repo, out, home: process.env.HOME ?? '' }) }, null, 2));
