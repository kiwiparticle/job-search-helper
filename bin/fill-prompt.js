#!/usr/bin/env node
// usage: REPO=<dir> fill-prompt.js <promptFile>: prints the prompt with {{NAME}} filled from the environment, else the profile.
import { readFileSync } from 'node:fs';
import { loadProfile, profileSlots, fillSlots } from '../lib/profile.js';

let slots;
try {
    slots = profileSlots(loadProfile(process.env.REPO || '.'));
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
const text = readFileSync(process.argv[2], 'utf8');
process.stdout.write(fillSlots(text, slots));
