#!/usr/bin/env node
// One-time setup of a private copy: checks each step, does what is missing.
// `--check` only reports (writes nothing). Secret values are never read; secret names are listed.
// `--email`, `--team-domain`, `--aud` set the page's Access settings (not secrets, so a flag is fine).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { audTag, dashboardSteps, d1IdByName, d1Name, emailAddr, hasPagesProject, hasPlaceholder, missingOwnerFiles, nodeOk, pagesDomain, pagesName, pagesSecretNames, repoFromUrl, runnerAsset, runnerFolder, runnersWanted, setD1Id, teamHost } from '../lib/setupSteps.js';
import { loadModels } from '../lib/models.js';

const root = new URL('..', import.meta.url).pathname;
const { values: flags } = parseArgs({ options: { check: { type: 'boolean' }, email: { type: 'string' }, 'team-domain': { type: 'string' }, aud: { type: 'string' } } });
const check = !!flags.check;
const sh = (cmd, args, { input, cwd = root } = {}) => {
    try { return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', input, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }) }; }
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

// 1. prerequisites. Kit tools and Chromium are optional: searches run without them.
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
    for (const [bin, pkg] of [['jq', 'jq'], ['flock', 'util-linux']]) if (!sh('which', [bin]).ok) apt.push(pkg);
    if (apt.length) miss.push(`sudo apt install ${apt.join(' ')}`);
    const kit = [...new Set([['pandoc', 'pandoc'], ['soffice', 'libreoffice-writer'], ['pdfinfo', 'poppler-utils'], ['pdftotext', 'poppler-utils']]
        .filter(([bin]) => !sh('which', [bin]).ok).map(([, pkg]) => pkg))];
    const pw = join(homedir(), '.cache/ms-playwright');
    const browser = existsSync(pw) && readdirSync(pw).some((d) => d.startsWith('chromium-'));
    if (miss.length) { todo++; say(1, 'skip: prerequisites missing (bin/install-prereqs.sh installs them)'); miss.forEach((m) => console.log(`   - ${m}`)); }
    else say(1, 'ok prerequisites');
    if (kit.length) console.log(`   optional, for application kits: bin/install-prereqs.sh --kits (${kit.join(', ')})`);
    if (!browser) console.log('   optional, for the browser board finder: bin/install-prereqs.sh --browser (Chromium)');
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

// 6. runners: one per searcher, registered to this repo. Missing ones are downloaded and registered here;
// starting the service needs sudo, so that line is printed for the person (this script never runs sudo).
{
    const want = runnersWanted(loadModels(root).defaults);
    let runners = null;
    try { runners = JSON.parse(sh('gh', ['api', `repos/${repo}/actions/runners`]).out).runners; } catch {}
    const online = runners?.filter((r) => r.status === 'online').length ?? 0;
    if (!runners) skip(6, `could not list this repo's runners (gh api repos/${repo}/actions/runners)`);
    else if (online >= want) say(6, `ok ${online} runner(s) online for ${repo}`);
    else {
        todo++;
        const notes = [];
        const start = [];
        let short = want - online;
        for (let i = 1; short > 0 && i <= want + online; i++) {
            const name = runnerFolder(repo, i);
            const dir = join(homedir(), name);
            if (runners.some((r) => r.name === name && r.status === 'online')) continue;
            short--;
            if (!existsSync(join(dir, '.runner'))) {
                if (check) { notes.push(`would download and register ~/${name}`); continue; }
                const err = await installRunner(dir, name);
                notes.push(err ? `~/${name}: ${err}` : `registered ~/${name}`);
                if (err) continue;
            }
            start.push(`cd ~/${name} && ${existsSync(join(dir, '.service')) ? '' : 'sudo ./svc.sh install && '}sudo ./svc.sh start`);
        }
        say(6, `skip: ${online} of ${want} runner(s) online (one per searcher)${notes.length ? `. ${notes.join('; ')}` : ''}`);
        if (start.length) { console.log('   Start each in your terminal, then re-run:'); start.forEach((l) => console.log(`   ${l}`)); }
    }
}

// Download the latest runner package (checked against the release's sha256), extract it into `dir`, register it.
async function installRunner(dir, name) {
    let rel = null;
    try { rel = JSON.parse(sh('gh', ['api', 'repos/actions/runner/releases/latest']).out); } catch {}
    const asset = runnerAsset(rel, process.arch);
    if (!asset) return `no Linux ${process.arch} package in the latest runner release`;
    if (!asset.digest) return 'the release lists no checksum; install by hand from https://github.com/actions/runner/releases';
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) return `download failed (${res.status})`;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (`sha256:${createHash('sha256').update(buf).digest('hex')}` !== asset.digest) return 'download checksum did not match';
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, asset.name), buf);
    const tar = sh('tar', ['xzf', asset.name], { cwd: dir });
    rmSync(join(dir, asset.name));
    if (!tar.ok) return 'extract failed';
    const token = sh('gh', ['api', '-X', 'POST', `repos/${repo}/actions/runners/registration-token`, '-q', '.token']).out.trim();
    if (!token) return 'could not get a registration token';
    const r = sh('./config.sh', ['--unattended', '--replace', '--url', `https://github.com/${repo}`, '--name', name, '--token', token], { cwd: dir });
    return r.ok ? null : `config.sh failed (missing libraries? run sudo ~/${name}/bin/installdependencies.sh, then re-run): ${r.out.trim().split('\n').pop()}`;
}

// 7. page settings and secrets. Only names are listed, never values. Settings that are not secret come from
// this repo or the flags and are set here; the two tokens are typed by the person.
{
    const project = pagesName(existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : '');
    const listed = project ? sh('npx', ['wrangler', 'pages', 'secret', 'list', '--project-name', project]) : { ok: false };
    let ghHave = null;
    try { ghHave = JSON.parse(sh('gh', ['api', `repos/${repo}/actions/secrets`]).out).secrets.map((x) => x.name); } catch {}
    if (!listed.ok) skip(7, 'could not list the Pages project settings (step 4 first)');
    else {
        const have = new Set(pagesSecretNames(listed.out));
        const notes = [];
        const type = [];
        let attention = false;
        let set = 0;
        for (const [k, flag, clean] of [['GITHUB_REPO'], ['OWNER_EMAIL', 'email', emailAddr], ['ACCESS_TEAM_DOMAIN', 'team-domain', teamHost], ['ACCESS_AUD', 'aud', audTag]]) {
            const raw = flag ? flags[flag] : (have.has(k) ? undefined : repo);
            if (raw == null) { if (!have.has(k)) { attention = true; notes.push(`${k} missing (pass --${flag})`); } continue; }
            const v = clean ? clean(raw) : raw;
            if (!v) { attention = true; notes.push(`--${flag} is not valid`); continue; }
            if (check) { attention = true; notes.push(`would set ${k}`); continue; }
            const ok = sh('npx', ['wrangler', 'pages', 'secret', 'put', k, '--project-name', project], { input: v }).ok;
            if (ok) set++; else attention = true;
            notes.push(ok ? `set ${k}` : `FAILED ${k}`);
        }
        if (!have.has('GITHUB_TOKEN')) type.push(`npx wrangler pages secret put GITHUB_TOKEN --project-name ${project}`);
        if (!ghHave) { attention = true; notes.push(`could not list repo secrets (gh api repos/${repo}/actions/secrets)`); }
        else if (!ghHave.includes('CLOUDFLARE_API_TOKEN')) type.push(`gh secret set CLOUDFLARE_API_TOKEN -R ${repo}`);
        // the page reads its settings at deploy time
        if (set) notes.push(sh('pnpm', ['run', 'deploy']).ok ? 'deployed' : 'deploy failed, run `pnpm run deploy`');
        if (attention || type.length) todo++;
        say(7, `${attention || type.length ? 'skip:' : 'ok'} page settings and secrets${notes.length ? `: ${notes.join('; ')}` : ''}`);
        if (type.length || notes.some((n) => n.includes('missing'))) {
            const account = sh('npx', ['wrangler', 'whoami']).out.match(/\b[0-9a-f]{32}\b/)?.[0];
            const domain = pagesDomain(sh('npx', ['wrangler', 'pages', 'project', 'list', '--json']).out, project);
            console.log('   Dashboard steps:');
            dashboardSteps({ account, repo, domain }).forEach((l) => console.log(`   ${l}`));
            console.log('   Then: node bin/setup.js --email <your Access email> --team-domain <team>.cloudflareaccess.com --aud <AUD tag>');
        }
        if (type.length) { console.log('   Type each token yourself (it prompts), then re-run:'); type.forEach((l) => console.log(`   ${l}`)); }
    }
}

console.log(todo ? `\n${todo} step(s) need attention.` : '\nAll steps ok.');
