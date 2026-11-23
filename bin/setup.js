#!/usr/bin/env node
// One-time setup of a private copy: checks each step, does what is missing.
// `--check` only reports (writes nothing). No secrets are set or read here.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { d1IdByName, hasPagesProject, hasPlaceholder, missingOwnerFiles, nodeOk, pagesName, setD1Id } from '../lib/setupSteps.js';

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

// Refuse unless the repo is private.
const priv = sh('gh', ['repo', 'view', '--json', 'isPrivate', '-q', '.isPrivate']);
if (priv.out.trim() !== 'true') {
    console.error('Refusing: this repo is not private (or gh cannot read it). Private repos only; never register a runner on a public repo.');
    process.exit(1);
}
const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).out.trim();
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
{
    const toml = existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : '';
    if (!toml) skip(3, 'no wrangler.toml (step 2 first)');
    else if (!hasPlaceholder(toml)) { d1Id = toml.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1]; say(3, 'ok D1 id in wrangler.toml'); }
    else if (check) { todo++; say(3, 'would create D1 database job-search, write its id, apply db/schema.sql'); }
    else {
        sh('npx', ['wrangler', 'd1', 'create', 'job-search']); // fails harmlessly when it already exists
        d1Id = d1IdByName(sh('npx', ['wrangler', 'd1', 'list', '--json']).out, 'job-search');
        if (!d1Id) skip(3, 'could not read the D1 id: run `npx wrangler d1 list`, put it in wrangler.toml');
        else {
            // schema first: the toml changes only on success, so a re-run finds the DB by name and retries (schema is idempotent)
            const r = sh('npx', ['wrangler', 'd1', 'execute', 'job-search', '--remote', '--file', 'db/schema.sql']);
            if (r.ok) { writeFileSync(tomlPath, setD1Id(toml, d1Id)); say(3, `done D1 ${d1Id}, schema applied`); }
            else skip(3, `schema failed (re-run to retry): ${r.out.trim().split('\n').pop()}`);
        }
    }
}

// 4. Pages project (deploy only when just created)
{
    const name = pagesName(existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : '');
    if (!name) skip(4, 'no name in wrangler.toml');
    else if (hasPagesProject(sh('npx', ['wrangler', 'pages', 'project', 'list', '--json']).out, name)) say(4, `ok Pages project ${name}`);
    else if (check) { todo++; say(4, `would create Pages project ${name} and deploy once`); }
    else if (!sh('npx', ['wrangler', 'pages', 'project', 'create', name, '--production-branch', 'main']).ok) skip(4, `create it by hand: npx wrangler pages project create ${name} --production-branch main`);
    else say(4, sh('pnpm', ['run', 'deploy']).ok ? `done created ${name}, deployed` : 'done created; deploy failed, run `pnpm run deploy`');
}

// 5. repo variables via gh api (old gh has no `gh variable`)
{
    const api = `repos/${repo}/actions/variables`;
    let have = {};
    try { for (const v of JSON.parse(sh('gh', ['api', api]).out).variables || []) have[v.name] = v.value; } catch {}
    const acct = sh('npx', ['wrangler', 'whoami']).out.match(/\b[0-9a-f]{32}\b/)?.[0];
    const want = { JOB_SEARCH_ENABLED: 'true', CLOUDFLARE_ACCOUNT_ID: acct, D1_DATABASE_ID: d1Id };
    const notes = [];
    for (const [k, v] of Object.entries(want)) {
        if (!v) { todo++; notes.push(`${k}: value unknown (set by hand: gh api -X POST ${api} -f name=${k} -f value=...)`); }
        else if (have[k] === v) continue;
        else if (check) { todo++; notes.push(`would set ${k}`); }
        else {
            const args = k in have ? ['api', '-X', 'PATCH', `${api}/${k}`] : ['api', '-X', 'POST', api, '-f', `name=${k}`];
            notes.push(sh('gh', [...args, '-f', `value=${v}`]).ok ? `set ${k}` : `FAILED ${k}`);
        }
    }
    say(5, notes.length ? `${check ? 'todo' : 'done'} ${notes.join('; ')}` : 'ok repo variables');
}

// 6. runner (never runs sudo)
{
    if (existsSync(join(homedir(), 'actions-runner'))) say(6, 'ok ~/actions-runner exists');
    else {
        todo++;
        say(6, 'skip: register a runner (private repo only), in your terminal:');
        console.log(`   mkdir ~/actions-runner && cd ~/actions-runner
   # download the Linux x64 package from https://github.com/actions/runner/releases and extract it, then:
   ./config.sh --url https://github.com/${repo} --token $(gh api -X POST repos/${repo}/actions/runners/registration-token -q .token)
   sudo ./svc.sh install && sudo ./svc.sh start`);
    }
}

console.log(todo ? `\n${todo} step(s) need attention.` : '\nAll steps ok.');
