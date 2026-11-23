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
export const pagesName = (toml) => toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1] || null;
export const nodeOk = (v) => parseInt(String(v).replace(/^v/, ''), 10) >= 26;

// `wrangler pages project list --json` -> is there a project with exactly this name?
export function hasPagesProject(listJson, name) {
    try { return JSON.parse(listJson).some((p) => (p['Project Name'] ?? p.name) === name); }
    catch { return false; }
}
