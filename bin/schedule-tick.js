// Hourly tick (schedule.yml): dispatches every run data/schedule.json says is due this UTC hour.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cleanSchedule, dispatchOf, dueAt } from '../lib/schedule.js';

// SCHEDULE_FILE overrides the path (tests use it). No file: nothing runs on its own. A broken file fails loudly.
const file = process.env.SCHEDULE_FILE || new URL('../data/schedule.json', import.meta.url).pathname;
let raw = null;
if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { console.error(`${file} does not parse: ${e.message}`); process.exit(1); }
}
// TICK_AT is the run's created_at (when the cron fired), so a tick that waits for a runner past the hour still dispatches that hour's runs.
// ponytail: GitHub's own cron delay is the remaining limit (a tick dropped or fired in the next hour still misses).
const at = process.env.TICK_AT ? new Date(process.env.TICK_AT) : new Date();
const due = dueAt(cleanSchedule(raw), Number.isNaN(at.getTime()) ? new Date() : at);
if (!due.length) console.log('nothing due');
let failed = 0;
for (const id of due) {
    const { file, inputs } = dispatchOf(id);
    const args = ['workflow', 'run', file, ...Object.entries(inputs).flatMap(([k, v]) => ['-f', `${k}=${v}`])];
    try {
        execFileSync('gh', args, { stdio: 'inherit' });
        console.log(`dispatched ${id} (${file})`);
    } catch { failed++; console.error(`failed to dispatch ${id}`); }
}
process.exit(failed ? 1 : 0);
