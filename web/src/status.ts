import type { ActiveRun, ActivityRun } from './data';
import type { ModelRun, RunSummary } from './model';

// localStorage key: when the owner last opened the Status page (ISO time).
export const STATUS_SEEN_KEY = 'status-seen';

const DAY = 24 * 3600_000;

// What the bar's Status link shows: runs going, else failures from the last day not yet seen, else nothing.
// A finished run's searchers that did not finish ok: [id, outcome]. The run itself still counts as done on GitHub.
export const failedSearchers = (models: Record<string, ModelRun> | undefined) =>
    Object.entries(models ?? {}).filter(([, m]) => m.status && m.status !== 'ok');

// localStorage key: run names whose failed searchers the owner marked seen on Status (newest 50 kept).
const DISMISSED_KEY = 'status-dismissed';
export const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); } catch { return []; } };
export const dismissRun = (run: string) => {
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([run, ...readDismissed()].slice(0, 50))); } catch { /* private window */ }
};

// Search runs finished after `since` whose searchers did not all finish ok and not marked seen, newest first.
export const runsWithFailedSearchers = (runs: RunSummary[] | undefined, since: number, dismissed = readDismissed()) =>
    (runs ?? []).filter((r) => failedSearchers(r.models).length && r.finishedAt && Date.parse(r.finishedAt) > since && !dismissed.includes(r.run))
        .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));

// What the bar's Status link shows: runs going, else failures from the last day not yet seen (a GitHub run that
// failed, or a search run where a searcher failed), else nothing.
export function statusState(active: ActiveRun[], activity: ActivityRun[] | undefined, seenAt: string | null, runs?: RunSummary[]): { kind: 'idle' | 'running' | 'failed'; count: number } {
    if (active.length) return { kind: 'running', count: active.length };
    const since = Math.max(Date.now() - DAY, seenAt ? Date.parse(seenAt) : 0);
    const count = (activity ?? []).filter((r) => r.conclusion === 'failure' && Date.parse(r.updatedAt) > since).length
        + runsWithFailedSearchers(runs, since).length;
    return count ? { kind: 'failed', count } : { kind: 'idle', count: 0 };
}
