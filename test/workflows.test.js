import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);

// Job-level `if` text: the line after `    if:` plus any more-indented continuation lines.
function jobIfs(text) {
    const lines = text.split('\n');
    const start = lines.findIndex(l => l === 'jobs:');
    const jobs = [];
    for (const l of lines.slice(start + 1)) {
        if (/^ {2}[\w-]+:\s*$/.test(l)) jobs.push({ name: l.trim(), ifText: '' });
        else if (jobs.length && /^ {4}if:/.test(l)) { jobs.at(-1).ifText = l; jobs.at(-1).done = false; }
        else if (jobs.length && jobs.at(-1).ifText && /^ {5,}\S/.test(l) && !jobs.at(-1).done) jobs.at(-1).ifText += ' ' + l.trim();
        else if (jobs.length && /^ {4}\S/.test(l)) jobs.at(-1).done = true;
    }
    return jobs;
}

for (const f of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
    test(`${f}: every job is gated, no pull_request`, () => {
        const text = readFileSync(new URL(f, dir), 'utf8');
        assert.ok(!text.includes('pull_request'));
        const jobs = jobIfs(text);
        assert.ok(jobs.length > 0);
        for (const j of jobs) assert.ok(j.ifText.includes("vars.JOB_SEARCH_ENABLED == 'true'"), `${f} ${j.name}`);
    });
}
