import type { ActiveRun } from './data';
import type { Application, KitMeta } from './model';

// Whole days from one YYYY-MM-DD date to another.
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// The browser's local date as YYYY-MM-DD.
export function localToday(now = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// A YYYY-MM-DD date n days later.
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// An open application is due a follow-up when its next-step date has come, or, with no date, when the stage is a week old.
export function needsFollowUp(app: Application, today: string): boolean {
    if (app.outcome !== 'applied') return false;
    if (app.next?.on) return app.next.on <= today;
    return daysBetween(app.stageOn ?? app.appliedOn, today) >= 7;
}

// Where a job's application kit stands. A kit run still going wins over an older kit for the same posting.
export function kitStatus(company: string, role: string, postingId: string, kits: { name: string; meta: KitMeta }[], runs: ActiveRun[], kitStartedAt?: string, now = Date.now()): { state: 'drafting' | 'ready' | 'missing'; kit?: string } {
    if (runs.some((r) => r.title === `kit ${company} | ${role}`)) return { state: 'drafting' };
    const kit = kits.findLast((k) => k.meta.postingId === postingId);
    if (kit) return { state: 'ready', kit: kit.name };
    // GitHub takes a few seconds to list a new run: a kit started under 3 minutes ago still reads as drafting.
    return { state: kitStartedAt && now - Date.parse(kitStartedAt) < 180_000 ? 'drafting' : 'missing' };
}
