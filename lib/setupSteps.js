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
