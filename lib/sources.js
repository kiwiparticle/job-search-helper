import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A culture run covers this many sources; the least recently checked go first.
export const SOURCES_PER_RUN = 5;
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

// Past culture reports say which sources were checked (model-reported). Never-checked sources come first.
export function pickSources(repoDir, n = SOURCES_PER_RUN) {
    const sources = readJson(join(repoDir, 'data/sources.json'), []).filter((s) => s?.name);
    const last = new Map();
    for (const { run, workflow, finishedAt } of readJson(join(repoDir, 'runs/index.json'), [])) {
        if (workflow !== 'culture') continue;
        for (const name of readJson(join(repoDir, 'runs', run, 'report.json'), {}).sourcesChecked ?? []) {
            if ((last.get(name) ?? '') < finishedAt) last.set(name, finishedAt);
        }
    }
    return sources
        .map((s) => ({ ...s, lastChecked: last.get(s.name)?.slice(0, 10) ?? '' }))
        .sort((a, b) => a.lastChecked.localeCompare(b.lastChecked) || a.name.localeCompare(b.name))
        .slice(0, n);
}

// Each model's coverage.json lists `{ source, status }`. Only assigned sources count, and only completed or partial ones.
export function checkedSources(outputs, assigned) {
    const names = new Set(assigned.map((s) => s.name));
    const done = outputs.flatMap((o) => (o.coverage ?? []).filter((r) => names.has(r?.source) && ['completed', 'partial'].includes(r.status)).map((r) => r.source));
    return [...new Set(done)];
}
