// data/schedule.json: which runs start on their own. { id: { days: 0-6 (Sunday 0) or null for every day, hours: 0-23 } }, UTC.
const SEARCH_KINDS = ['tracked', 'daily', 'vertical', 'culture', 'reconcile'];
const FILES = { sweep: 'sweep.yml', resolve: 'resolve-links.yml', 'find-boards': 'find-boards.yml', tune: 'tune.yml', 'check-postings': 'check-postings.yml' };

export function dispatchOf(id) {
    if (SEARCH_KINDS.includes(id)) return { file: 'search.yml', inputs: { workflow: id } };
    return { file: FILES[id], inputs: {} };
}

const ints = (v, max) => Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= max);

export function cleanSchedule(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, e] of Object.entries(raw)) {
        if (!SEARCH_KINDS.includes(id) && !(id in FILES)) continue;
        if (!e || !ints(e.hours, 23) || !(e.days === null || ints(e.days, 6))) continue;
        out[id] = { days: e.days, hours: e.hours };
    }
    return out;
}

// The hour is the tick's own start, not the time the job got a runner.
export function dueAt(schedule, now) {
    const day = now.getUTCDay(), hour = now.getUTCHours();
    return Object.keys(schedule).filter((id) => (schedule[id].days === null || schedule[id].days.includes(day)) && schedule[id].hours.includes(hour));
}
