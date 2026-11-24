// Hourly tick (schedule.yml): dispatches every run data/schedule.json says is due this UTC hour.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cleanSchedule, dispatchOf, dueSince } from '../lib/schedule.js';

// SCHEDULE_FILE overrides the path (tests use it). No file: nothing runs on its own. A broken file fails loudly.
const file = process.env.SCHEDULE_FILE || new URL('../data/schedule.json', import.meta.url).pathname;
let raw = null;
if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { console.error(`${file} does not parse: ${e.message}`); process.exit(1); }
}
// TICK_AT is the run's created_at (when the cron fired). A dropped tick is caught up by the next one that fires, within CATCHUP_HOURS.
const CATCHUP_HOURS = 6;
const at = process.env.TICK_AT ? new Date(process.env.TICK_AT) : new Date();
// A run of the workflow created since the slot started counts, however it was started. Search runs are titled `search <kind>`.
function ran(id, slot) {
    const { file, inputs } = dispatchOf(id);
    try {
        const runs = JSON.parse(execFileSync('gh', ['run', 'list', '--workflow', file, '--limit', '30', '--json', 'name,createdAt'], { encoding: 'utf8' }));
        return runs.some((r) => new Date(r.createdAt) >= slot && (!inputs.workflow || r.name.startsWith(`search ${inputs.workflow}`)));
    } catch { return true; } // can't tell: don't double-dispatch
}
const due = dueSince(cleanSchedule(raw), Number.isNaN(at.getTime()) ? new Date() : at, CATCHUP_HOURS, ran);
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
