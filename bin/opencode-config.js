#!/usr/bin/env node
// usage: opencode-config.js <repo> <outDir> -> inline opencode config JSON for this call
import { opencodeConfig } from '../lib/opencodeConfig.js';

const [repo, out] = process.argv.slice(2);
console.log(JSON.stringify(opencodeConfig({ repo, out, home: process.env.HOME ?? '' })));
