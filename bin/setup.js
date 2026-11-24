#!/usr/bin/env node
// One-time setup of a private copy: checks each step, does what is missing.
// `--check` only reports (writes nothing). No secrets are set or read here.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { d1IdByName, d1Name, hasPagesProject, hasPlaceholder, missingOwnerFiles, nodeOk, pagesName, repoFromUrl, runnerFolder, runnersWanted, setD1Id } from '../lib/setupSteps.js';
import { loadModels } from '../lib/models.js';

const root = new URL('..', import.meta.url).pathname;
const check = process.argv.includes('--check');
const sh = (cmd, args) => {
    try { return { ok: true, out: execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const say = (n, text) => console.log(`${n}. ${text}`);
const tomlPath = join(root, 'wrangler.toml');
let todo = 0;
const skip = (n, text) => { todo++; say(n, `skip: ${text}`); };

// Refuse unless `origin` is private. Read the repo from origin itself: gh prefers an `upstream`
// remote, which here is the public engine.
const repo = repoFromUrl(sh('git', ['remote', 'get-url', 'origin']).out);
const priv = repo ? sh('gh', ['repo', 'view', repo, '--json', 'isPrivate', '-q', '.isPrivate']) : { out: '' };
if (priv.out.trim() !== 'true') {
    console.error(`Refusing: origin (${repo || 'none'}) is not a private GitHub repo you can read. Private repos only; never register a runner on a public repo.`);
    process.exit(1);
}
// Pin gh to origin, so `gh secret set` and `gh workflow run` never target the engine.
if (!check && sh('git', ['config', '--get', 'remote.origin.gh-resolved']).out.trim() !== 'base') sh('git', ['config', 'remote.origin.gh-resolved', 'base']);
if (check) console.log('--check: reports only, writes nothing.');

// 1. prerequisites
{
    const miss = [];
    const apt = [];
    if (process.platform !== 'linux') miss.push('Linux or WSL is required');
    if (!nodeOk(process.version)) miss.push(`Node 26+ (have ${process.version})`);
    for (const [bin, args, hint] of [
        ['pnpm', ['--version'], 'npm i -g pnpm'],
        ['gh', ['auth', 'status'], 'gh auth login'],
        ['npx', ['wrangler', 'whoami'], 'npx wrangler login'],
    ]) if (!sh(bin, args).ok) miss.push(`${bin} ${args[0]} failed: ${hint}`);
    if (!sh('claude', ['--version']).ok && !sh('codex', ['--version']).ok) miss.push('install and log in to claude or codex');
    for (const [bin, pkg] of [['pandoc', 'pandoc'], ['soffice', 'libreoffice-writer'], ['pdfinfo', 'poppler-utils'], ['pdftotext', 'poppler-utils'], ['jq', 'jq'], ['flock', 'util-linux']])
        if (!sh('which', [bin]).ok) apt.push(pkg);
    if (apt.length) miss.push(`sudo apt install ${[...new Set(apt)].join(' ')}`);
    const pw = join(homedir(), '.cache/ms-playwright');
    if (!existsSync(pw) || !readdirSync(pw).some((d) => d.startsWith('chromium-'))) miss.push('npx playwright install chromium');
    if (miss.length) { todo++; say(1, 'skip: prerequisites missing'); miss.forEach((m) => console.log(`   - ${m}`)); }
    else say(1, 'ok prerequisites');
}

// 2. owner files
{
    const missing = missingOwnerFiles(root);
    if (!missing.length) say(2, 'ok owner files present');
    else if (check) { todo++; say(2, `would copy from examples/: ${missing.join(', ')}`); }
    else {
        for (const f of missing) { mkdirSync(dirname(join(root, f)), { recursive: true }); copyFileSync(join(root, 'examples', f), join(root, f)); }
        say(2, `done copied ${missing.join(', ')}`);
    }
}

// 3. D1
let d1Id = null;
let freshD1 = false; // created by this run: a Pages project with the same name then belongs to someone else
{
    const toml = existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : '';
    const db = d1Name(toml);
    if (!toml) skip(3, 'no wrangler.toml (step 2 first)');
    else if (!db) skip(3, 'no database_name in wrangler.toml');
    else if (check) {
        if (hasPlaceholder(toml)) {
            todo++;
            say(3, d1IdByName(sh('npx', ['wrangler', 'd1', 'list', '--json']).out, db)
                ? `name taken: a D1 database named ${db} already exists on this account. Pick another database_name and name in wrangler.toml`
                : `would create D1 database ${db}, write its id, apply db/schema.sql`);
        }
        else { d1Id = toml.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1] || null; say(3, 'ok D1 id in wrangler.toml (a real run re-applies the idempotent schema)'); }
    } else {
        let text = toml;
        let taken = false;
        if (hasPlaceholder(text)) {
            // An existing database with this name is another install's (this copy writes its id before anything else).
            if (d1IdByName(sh('npx', ['wrangler', 'd1', 'list', '--json']).out, db)) taken = true;
            else {
                sh('npx', ['wrangler', 'd1', 'create', db]);
                const id = d1IdByName(sh('npx', ['wrangler', 'd1', 'list', '--json']).out, db);
                if (id) { text = setD1Id(text, id); writeFileSync(tomlPath, text); freshD1 = true; }
            }
        }
        d1Id = hasPlaceholder(text) ? null : text.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
        if (taken) skip(3, `a D1 database named ${db} already exists on this Cloudflare account (another install?). Pick another name: database_name and name in wrangler.toml`);
        else if (!d1Id) skip(3, 'could not read the D1 id: run `npx wrangler d1 list`, put it in wrangler.toml');
        else {
            // wrangler reads the id from wrangler.toml, so it must be written first. The schema is idempotent
            // (IF NOT EXISTS / INSERT OR IGNORE), so every run applies it and a failed one is retried.
            const r = sh('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--file', 'db/schema.sql']);
            if (r.ok) say(3, `ok D1 ${d1Id}, schema applied`);
            else skip(3, `schema failed (re-run to retry): ${r.out.trim().split('\n').filter((l) => !/Logs were written/.test(l)).pop()}`);
        }
    }
}

// 4. Pages project (deploy only when just created)
{
    const name = pagesName(existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : '');
    const exists = name && hasPagesProject(sh('npx', ['wrangler', 'pages', 'project', 'list', '--json']).out, name);
    if (!name) skip(4, 'no name in wrangler.toml');
    else if (!check && !d1Id) skip(4, 'D1 first (step 3), then re-run');
    else if (exists && (freshD1 || (check && hasPlaceholder(readFileSync(tomlPath, 'utf8'))))) skip(4, `name taken: a Pages project named ${name} already exists on this account (another install?). Pick another name in wrangler.toml${check ? '' : `; the D1 database ${d1Name(readFileSync(tomlPath, 'utf8'))} this run created can stay (its id is in wrangler.toml) or be deleted with npx wrangler d1 delete`}`);
    else if (exists) say(4, `ok Pages project ${name}`);
    else if (check) { todo++; say(4, `would create Pages project ${name}${existsSync(join(root, 'node_modules')) ? '' : ', run pnpm install --frozen-lockfile'} and deploy once`); }
    else if (!sh('npx', ['wrangler', 'pages', 'project', 'create', name, '--production-branch', 'main']).ok) skip(4, `create it by hand: npx wrangler pages project create ${name} --production-branch main`);
    else {
        // the deploy builds the page, which needs node_modules
        const deps = existsSync(join(root, 'node_modules')) || sh('pnpm', ['install', '--frozen-lockfile']).ok;
        if (!deps) say(4, 'done created; `pnpm install --frozen-lockfile` failed, run it, then `pnpm run deploy`');
        else say(4, sh('pnpm', ['run', 'deploy']).ok ? `done created ${name}, deployed` : 'done created; deploy failed, run `pnpm run deploy`');
    }
}

// 5. repo variables via gh api (old gh has no `gh variable`). Only after D1: JOB_SEARCH_ENABLED turns the
// workflows on, and they need the database.
if (!d1Id) skip(5, 'D1 first (step 3), then re-run');
else {
    const api = `repos/${repo}/actions/variables`;
    let have = {};
    try { for (const v of JSON.parse(sh('gh', ['api', api]).out).variables || []) have[v.name] = v.value; } catch {}
    const acct = sh('npx', ['wrangler', 'whoami']).out.match(/\b[0-9a-f]{32}\b/)?.[0];
    const want = { JOB_SEARCH_ENABLED: 'true', CLOUDFLARE_ACCOUNT_ID: acct, D1_DATABASE_ID: d1Id };
    const notes = [];
    let attention = false;
    for (const [k, v] of Object.entries(want)) {
        if (!v) { attention = true; notes.push(`${k}: value unknown (set by hand: gh api -X POST ${api} -f name=${k} -f value=...)`); }
        else if (have[k] === v) continue;
        else if (check) { attention = true; notes.push(`would set ${k}`); }
        else {
            const args = k in have ? ['api', '-X', 'PATCH', `${api}/${k}`] : ['api', '-X', 'POST', api, '-f', `name=${k}`];
            const ok = sh('gh', [...args, '-f', `value=${v}`]).ok;
            if (!ok) attention = true;
            notes.push(ok ? `set ${k}` : `FAILED ${k}`);
        }
    }
    if (attention) todo++; // one count per step, not per variable
    say(5, notes.length ? `${check ? 'todo' : 'done'} ${notes.join('; ')}` : 'ok repo variables');
}

// 6. runners (never runs sudo): one per searcher, registered to this repo
{
    const want = runnersWanted(loadModels(root).defaults);
    let have = null;
    try { have = JSON.parse(sh('gh', ['api', `repos/${repo}/actions/runners`]).out).total_count; } catch {}
    if (have == null) skip(6, `could not list this repo's runners (gh api repos/${repo}/actions/runners); register ${want} by hand`);
    else if (have >= want) say(6, `ok ${have} runner(s) registered to ${repo}`);
    else {
        todo++;
        say(6, `skip: ${have} of ${want} runner(s) registered to ${repo} (one per searcher). In your terminal, for each missing one:`);
        for (let i = have + 1; i <= want; i++) {
            const dir = runnerFolder(repo, i);
            console.log(`   mkdir ~/${dir} && cd ~/${dir}
   # download the Linux x64 package from https://github.com/actions/runner/releases and extract it, then:
   ./config.sh --unattended --url https://github.com/${repo} --name ${dir} --token $(gh api -X POST repos/${repo}/actions/runners/registration-token -q .token)
   sudo ./svc.sh install && sudo ./svc.sh start`);
        }
    }
}

console.log(todo ? `\n${todo} step(s) need attention.` : '\nAll steps ok.');
