import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Every file under examples/ whose owner path (same relative path) is absent.
export function missingOwnerFiles(repoDir) {
    const out = [];
    const walk = (rel) => {
        for (const e of readdirSync(join(repoDir, 'examples', rel), { withFileTypes: true })) {
            const p = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(p);
            else if (!existsSync(join(repoDir, p))) out.push(p);
        }
    };
    walk('');
    return out.sort();
}

export const setD1Id = (toml, id) => toml.replace(/^database_id\s*=.*$/m, `database_id = "${id}"`);

// `wrangler d1 list --json` -> id of the named database, or null.
export function d1IdByName(listJson, name) {
    try {
        const row = JSON.parse(listJson).find((d) => d.name === name);
        return row?.uuid || row?.id || null;
    } catch { return null; }
}

export const hasPlaceholder = (toml) => /REPLACE_WITH_D1_ID/.test(toml);
export const d1Name = (toml) => toml.match(/^database_name\s*=\s*"([^"]+)"/m)?.[1] || null;
export const pagesName = (toml) => toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1] || null;
export const nodeOk = (v) => parseInt(String(v).replace(/^v/, ''), 10) >= 26;

// `wrangler pages project list --json` -> is there a project with exactly this name?
export function hasPagesProject(listJson, name) {
    try { return JSON.parse(listJson).some((p) => (p['Project Name'] ?? p.name) === name); }
    catch { return false; }
}

// owner/repo from a GitHub remote URL (https or ssh), else null.
export const repoFromUrl = (url) => String(url).trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] || null;

// Runner folders for a copy: one per searcher (two searchers run side by side), named after the repo so
// they never collide with another install's ~/actions-runner*.
export const runnersWanted = (defaults) => Math.max(1, defaults?.search?.searchers?.length || 1);
export const runnerFolder = (repo, i) => `actions-runner-${String(repo).split('/').pop()}${i > 1 ? `-${i}` : ''}`;

// Names from `wrangler pages secret list` ("  - NAME: Value Encrypted"). Values are never printed.
export const pagesSecretNames = (out) => [...String(out).matchAll(/^\s*-\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);

// Page settings setup.js takes as flags. Each cleans its value or returns null when it is not valid.
export const teamHost = (v) => {
    const h = String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(h) ? h : null;
};
export const audTag = (v) => (/^[0-9a-f]{64}$/.test(String(v ?? '').trim().toLowerCase()) ? String(v).trim().toLowerCase() : null);
export const emailAddr = (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim()) ? String(v).trim() : null);

// The Linux runner package for this machine from a GitHub release (`gh api .../releases/latest`), or null.
export function runnerAsset(release, nodeArch) {
    const arch = { x64: 'x64', arm64: 'arm64', arm: 'arm' }[nodeArch];
    return (release?.assets || []).find((a) => arch && new RegExp(`^actions-runner-linux-${arch}-[\\d.]+\\.tar\\.gz$`).test(a.name)) || null;
}

// The project's *.pages.dev host from `wrangler pages project list --json` (it can differ from the name), or null.
export function pagesDomain(listJson, name) {
    try {
        const p = JSON.parse(listJson).find((x) => (x['Project Name'] ?? x.name) === name);
        return String(p?.['Project Domains'] ?? '').split(/[,\s]+/).find((d) => d.endsWith('.pages.dev')) || null;
    } catch { return null; }
}

// Click-by-click dashboard steps, with links pre-filled where the dashboards allow it (both token pages take
// template URLs; repository choice and the Access app do not).
export function dashboardSteps({ account, repo, domain }) {
    const [owner, short] = String(repo).split('/');
    const d1 = encodeURIComponent(JSON.stringify([{ key: 'd1', type: 'edit' }]));
    const cf = `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${d1}&name=${encodeURIComponent(`${short} D1`)}`;
    const gh = `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent(`${short} page`.slice(0, 40))}`
        + `&description=${encodeURIComponent('Lets the job-search page start runs and read run files')}`
        + `&target_name=${encodeURIComponent(owner)}&expires_in=365&actions=write&contents=write`;
    return [
        'A. Lock the page so only you can open it:',
        `   1. Open https://dash.cloudflare.com/${account || ''}/one/access-controls/apps`,
        '      (No luck? Search the dashboard for "Applications" and pick Access controls > Applications.)',
        '   2. Click Add an application, then Self-hosted.',
        `   3. Name it ${short}. Under hostname, enter ${domain || '<project>.pages.dev'}. Got a custom domain too? Add it as a second hostname.`,
        '   4. Add a policy: Allow, Include, Emails, then your email. Save.',
        '   5. Open the app and copy the Application Audience (AUD) Tag. That\'s your --aud.',
        '   6. Find your team domain: Zero Trust, Overview, Discover tab, account details on the right.',
        '      It looks like <team>.cloudflareaccess.com. That\'s your --team-domain (leave off https://).',
        'B. Cloudflare token, so searches can save to your database. The permission is already filled in:',
        `   ${cf}`,
        '   Pick your account if it asks, click Continue to summary, then Create. Keep the token handy for the command below.',
        'C. GitHub token, so the page can start searches. Permissions are filled in, and it lasts 365 days:',
        `   ${gh}`,
        `   Under Repository access, pick Only select repositories, then ${repo}. Click Generate, and keep it handy too.`,
    ];
}
