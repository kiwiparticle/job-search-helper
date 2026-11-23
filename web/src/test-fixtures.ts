import type { Company, Posting } from './model';

// Records as the API sends them. Tests override only what they care about.
export const posting = (o: Partial<Posting> = {}): Posting => ({
    id: 'p1', companyKey: 'x', leadKey: 'k', role: 'Staff Engineer', url: 'https://x.example/1', pay: '', modelSays: 'lead', wasLead: true, verdicts: {},
    disputed: false, firstRun: 'r1', lastRun: 'r1', posted: 'yes', postedCheckedAt: '', source: 'run', ...o,
});
export const company = (o: Partial<Company> = {}): Company => ({
    key: 'x', name: 'X Corp', aliases: [], distinctFrom: [], stance: 'Watching', verdict: '', fingerprint: '', domain: '', awards: '', reason: '',
    recheckTrigger: '', website: '', size: '', funding: '', facts: '', lastChecked: '', rolesSkipped: [], jobs: {}, applications: [], proposals: [], events: [], ...o,
});

// A list as the JSON Lines the read endpoints send.
export const lines = (list: unknown[]) => list.map((r) => `${JSON.stringify(r)}\n`).join('');
