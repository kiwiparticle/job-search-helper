import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync, chmodSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const src = new URL('..', import.meta.url).pathname;
const models = {
    models: [
        { id: 'claude', label: 'Claude', runner: 'claude' },
        { id: 'qwen', label: 'Qwen', runner: 'opencode', model: 'llama-local/qwen-3.6-35b', ctx: 1000 },
        { id: 'glm', label: 'GLM', runner: 'opencode', model: 'zai-coding-plan/glm-5.3-flash' },
        { id: 'hostedi', label: 'HI', runner: 'opencode', model: 'zai-coding-plan/x', instructions: 'inst-local.md' },
        { id: 'gem', label: 'Gem', runner: 'agy' },
        { id: 'off', label: 'Off', runner: 'claude', enabled: false },
        { id: 'sonnet', label: 'Sonnet', runner: 'claude', model: 'sonnet' },
    ],
};
const stub = (dir, name, body) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
};

function setup(t, { opencode = 'echo ok', swap = 'exit 0', agy = 'echo ok' } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'runmodel-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'stubs'));
    cpSync(join(src, 'lib'), join(root, 'lib'), { recursive: true });
    for (const f of ['run-model.sh', 'model-info.js', 'opencode-config.js', 'agy-policy.js', 'agy-run.sh', 'fill-prompt.js']) cpSync(join(src, 'bin', f), join(root, 'bin', f));
    writeFileSync(join(root, 'data/models.json'), JSON.stringify(models));
    writeFileSync(join(root, 'data/profile.json'), JSON.stringify({ who: 'a tester' }));
    writeFileSync(join(root, 'prompt.md'), 'hello {{OUT}}');
    writeFileSync(join(root, 'instructions.md'), 'x'.repeat(100));
    const calls = join(root, 'calls.txt');
    const st = join(root, 'stubs');
    stub(st, 'opencode', `echo "opencode $*" >>"${calls}"\necho "$OPENCODE_CONFIG_CONTENT" >"${join(root, 'config.json')}"\n${opencode}`);
    stub(st, 'agy', `echo "agy $*" >>"${calls}"; cat >"${join(root, 'agy-stdin.txt')}"; p=; for a; do [ "$p" = --settings ] && cp "$a" "${join(root, 'agy-settings-seen.json')}"; p=$a; done\n${agy}`);
    stub(st, 'claude', `echo "claude $*" >>"${calls}"; echo ok`);
    stub(st, 'flock', `echo "flock $*" >>"${calls}"; shift 3; exec "$@"`);
    stub(st, 'swap', `echo "swap $*" >>"${calls}"\n${swap}`);
    const out = join(root, 'out');
    const go = (id, { outDir = out, env = {} } = {}) => {
        const r = spawnSync(join(root, 'bin/run-model.sh'), [id, join(root, 'prompt.md'), outDir], {
            cwd: root, encoding: 'utf8',
            env: { PATH: `${st}:${process.env.PATH}`, SWAP_MODEL_BIN: join(st, 'swap'), AGY_POLL: '0.2', ...env },
        });
        const status = existsSync(join(outDir, 'status.txt')) ? readFileSync(join(outDir, 'status.txt'), 'utf8').trim() : null;
        const log = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
        return { r, status, log, out: outDir };
    };
    return { go, root };
}

test('unknown and disabled id -> failed', (t) => {
    const { go } = setup(t);
    for (const id of ['nope', 'off']) {
        const x = go(id);
        assert.equal(x.status, 'failed');
        assert.match(x.r.stderr, /unknown or disabled model/);
        assert.equal(x.log, '');
    }
});

test('opencode runs with -m and --agent job-search, no --pure', (t) => {
    const x = setup(t).go('glm');
    assert.equal(x.status, 'ok');
    assert.match(x.log, /opencode run -m zai-coding-plan\/glm-5\.3-flash --agent job-search --dir \S+/);
    assert.doesNotMatch(x.log, /--pure/);
});

test('rc 0 -> ok; rate limit with rc 1 -> limit', (t) => {
    assert.equal(setup(t).go('glm').status, 'ok');
    const x = setup(t, { opencode: 'echo "rate limit exceeded"; exit 1' }).go('glm');
    assert.equal(x.status, 'limit');
});

test('flock + swap for llama-local only, swap before opencode', (t) => {
    const x = setup(t).go('qwen');
    assert.equal(x.status, 'ok');
    assert.match(x.log, /^flock -w 3300 \/tmp\/job-search-gpu\.lock /);
    assert.match(x.log, /swap qwen-3\.6-35b\nopencode run -m llama-local\/qwen-3\.6-35b/);
    const h = setup(t).go('glm');
    assert.doesNotMatch(h.log, /flock|swap/);
    const c = setup(t).go('claude');
    assert.equal(c.status, 'ok');
    assert.doesNotMatch(c.log, /flock|swap|--model/);
    assert.match(setup(t).go('sonnet').log, /^claude -p --model sonnet /);
});

test('failed swap -> failed, opencode not run', (t) => {
    const x = setup(t, { swap: 'exit 1' }).go('qwen');
    assert.equal(x.status, 'failed');
    assert.doesNotMatch(x.log, /^opencode /m);
});

test('a hung swap ends at its own timeout -> failed, opencode not run', (t) => {
    const started = Date.now();
    const x = setup(t, { swap: 'sleep 30' }).go('qwen', { env: { SWAP_TIMEOUT: '1' } });
    assert.ok(Date.now() - started < 15000, 'swap was cut off');
    assert.equal(x.status, 'failed');
    assert.doesNotMatch(x.log, /^opencode /m);
    assert.match(readFileSync(join(x.out, 'log-qwen.txt'), 'utf8'), /swap failed for qwen-3\.6-35b \(rc 124\)/);
});

test('over budget -> failed, refused.txt, stub not run', (t) => {
    const s = setup(t);
    writeFileSync(join(s.root, 'prompt.md'), 'y'.repeat(4000)); // 1000 tokens > 600
    const x = s.go('qwen');
    assert.equal(x.status, 'failed');
    assert.match(readFileSync(join(x.out, 'refused.txt'), 'utf8'), /exceeds/);
    assert.equal(x.log, '');
});

test('a profile that pushes the filled prompt over budget is refused', (t) => {
    const s = setup(t);
    writeFileSync(join(s.root, 'prompt.md'), '{{PROFILE_WHO}}');
    writeFileSync(join(s.root, 'data/profile.json'), JSON.stringify({ who: 'y'.repeat(4000) }));
    const x = s.go('qwen');
    assert.equal(x.status, 'failed');
    assert.match(readFileSync(join(x.out, 'refused.txt'), 'utf8'), /exceeds/);
    assert.equal(x.log, '');
});

test('a missing profile refuses before starting', (t) => {
    const s = setup(t);
    rmSync(join(s.root, 'data/profile.json'));
    const x = s.go('glm');
    assert.equal(x.status, 'failed');
    assert.match(readFileSync(join(x.out, 'reason.txt'), 'utf8'), /refused before starting: data\/profile\.json/);
    assert.equal(x.log, '');
});

const config = (root) => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));

test('per-call config names an out dir outside the repo', (t) => {
    const s = setup(t);
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    const x = s.go('glm', { outDir: outside });
    assert.equal(x.status, 'ok');
    const p = config(s.root).agent['job-search'].permission;
    assert.equal(p.bash, 'deny');
    assert.equal(p.task, 'deny');
    assert.equal(p.external_directory[`${outside}/**`], 'allow');
    assert.equal(p.external_directory[`${s.root}/**`], 'allow');
    assert.equal(p.edit[`${outside}/**`], 'allow');
    assert.equal(p.read['**/auth.json'], 'deny');
});

test('out dir inside the repo works', (t) => {
    const s = setup(t);
    const inside = join(s.root, 'runs/r1/glm');
    const x = s.go('glm', { outDir: inside });
    assert.equal(x.status, 'ok');
    assert.equal(config(s.root).agent['job-search'].permission.edit[`${inside}/**`], 'allow');
});

test('model-info marks empty fields with - so tabs cannot collapse', (t) => {
    const s = setup(t);
    const r = spawnSync('node', [join(s.root, 'bin/model-info.js'), 'hostedi'], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), 'opencode\tzai-coding-plan/x\t-\tinst-local.md');
    assert.equal(s.go('hostedi').status, 'ok');
});

test('missing instructions file on a ctx model -> failed, model not launched', (t) => {
    const s = setup(t);
    const x = s.go('qwen', { env: { INSTRUCTIONS_FILE: 'nope.md' } });
    assert.equal(x.status, 'failed');
    assert.equal(x.log, '');
});

test('absolute INSTRUCTIONS_FILE works', (t) => {
    const s = setup(t);
    const abs = join(s.root, 'abs-inst.md');
    writeFileSync(abs, 'tiny');
    const x = s.go('qwen', { env: { INSTRUCTIONS_FILE: abs } });
    assert.equal(x.status, 'ok');
});

test('agy runs -p with the prompt, stdin closed, never skips permissions or uses a key', (t) => {
    const x = setup(t).go('gem');
    assert.equal(x.status, 'ok');
    assert.match(x.log, /^agy -p hello \S+\/out --settings \S+$/m);
    assert.doesNotMatch(x.log, /dangerously|api.key/i);
    assert.equal(readFileSync(join(x.out, '..', 'agy-stdin.txt'), 'utf8'), '');
});

test('agy policy is written per call with the real out dir, before agy starts', (t) => {
    const { go, root } = setup(t);
    const x = go('gem');
    const p = JSON.parse(readFileSync(join(root, 'agy-settings-seen.json'), 'utf8')).permissions;
    assert.ok(p.allow.includes(`write_file(${x.out})`));
    assert.ok(p.allow.includes('read_url(*)'));
    assert.ok(p.allow.includes(`read_file(${root})`));
    assert.ok(!p.allow.some((r) => r.startsWith('command(')));
    assert.ok(p.deny.some((r) => r.includes('.gemini')));
    assert.equal(p.ask, undefined);
});

test('agy status mapping: limit, auth, failed', (t) => {
    assert.equal(setup(t, { agy: 'echo "quota exceeded"; exit 1' }).go('gem').status, 'limit');
    assert.equal(setup(t, { agy: 'echo "authentication required" >&2; exit 1' }).go('gem').status, 'auth');
    assert.equal(setup(t, { agy: 'echo boom; exit 2' }).go('gem').status, 'failed');
});

test('agy hang ends as failed at the timeout', (t) => {
    const x = setup(t, { agy: 'sleep 30' }).go('gem', { env: { AGY_TIMEOUT: '1' } });
    assert.equal(x.status, 'failed');
});

test('agy that wrote output then hangs is stopped after the idle gap and counts as ok', (t) => {
    const x = setup(t, { agy: 'echo done >"$ROOT/out/report.md"; sleep 30' }).go('gem', { env: { AGY_IDLE: '1', AGY_POLL: '1', AGY_TIMEOUT: '20' } });
    assert.equal(x.status, 'ok');
});

test('policy denies the real credential stores', (t) => {
    const { go, root } = setup(t);
    go('gem', { env: { HOME: '/home/u' } });
    const { deny } = JSON.parse(readFileSync(join(root, 'agy-settings-seen.json'), 'utf8')).permissions;
    for (const d of ['.claude', '.codex', '.ssh', '.gemini', '.env']) assert.ok(deny.includes(`read_file(/home/u/${d})`), d);
});

test('"authentication required" is auth for agy only; claude keeps failed', (t) => {
    assert.equal(setup(t, { agy: 'echo "authentication required"; exit 1' }).go('gem').status, 'auth');
    const s = setup(t);
    stub(join(s.root, 'stubs'), 'claude', 'echo "authentication required"; exit 1');
    assert.equal(s.go('claude').status, 'failed');
});

test('opencode read list denies the subscription logins, ssh keys and runner credentials', async () => {
    const { opencodeConfig } = await import('../lib/opencodeConfig.js');
    const { read } = opencodeConfig({ repo: '/r', out: '/o', home: '/h' }).agent['job-search'].permission;
    for (const p of ['/h/.claude/**', '/h/.codex/**', '/h/.ssh/**', '/h/actions-runner/.credentials', '/h/actions-runner/.runner', '/h/.git-credentials', '/h/.npmrc']) assert.equal(read[p], 'deny', p);
    // Last match wins, so the allow-all must come first.
    assert.equal(Object.keys(read)[0], '*');
});

test('no deny rule covers the repo or output folder when they sit under the runner folder', async () => {
    const { agyPermissions } = await import('../lib/agyPolicy.js');
    const { opencodeConfig } = await import('../lib/opencodeConfig.js');
    const home = '/home/u';
    const repo = `${home}/actions-runner/_work/job-search/job-search`;
    const out = `${home}/actions-runner/_work/_temp/agy-out`;
    const covers = (target, path) => { const t = target.replace(/\/\*\*$/, ''); return path === t || path.startsWith(`${t}/`); };
    const agyDeny = agyPermissions({ repo, out, home }).deny.map((d) => d.replace(/^read_file\((.*)\)$/, '$1'));
    const ocRead = opencodeConfig({ repo, out, home }).agent['job-search'].permission.read;
    const ocDeny = Object.keys(ocRead).filter((k) => ocRead[k] === 'deny');
    for (const [name, list] of [['agy', agyDeny], ['opencode', ocDeny]]) {
        for (const target of list) for (const path of [repo, out]) assert.equal(covers(target, path), false, `${name}: ${target} covers ${path}`);
    }
});

test('agy policy denies the runner secrets of whichever runner folder the repo sits in, with no glob targets', async () => {
    const { agyPermissions } = await import('../lib/agyPolicy.js');
    const home = '/home/u';
    const repo = `${home}/actions-runner-2/_work/job-search/job-search`;
    const { deny } = agyPermissions({ repo, out: '/o', home });
    for (const f of ['.credentials', '.credentials_rsaparams', '.runner', '.env']) assert.ok(deny.includes(`read_file(${home}/actions-runner-2/${f})`), f);
    assert.ok(deny.includes(`read_file(${repo}/.env)`));
    for (const r of deny) assert.doesNotMatch(r, /\*/, `glob in ${r}`);
});

test('agy needs no lock and never touches the owner settings file', (t) => {
    const x = setup(t).go('gem');
    assert.doesNotMatch(x.log, /^flock /m);
    assert.doesNotMatch(readFileSync(join(src, 'bin/agy-run.sh'), 'utf8').replace(/^\s*#.*$/gm, ''), /settings\.json|flock|job-backup/);
});

test('SIGTERM to the agy wrapper stops agy and removes its temp policy file', async (t) => {
    const { root } = setup(t, { agy: `echo $$ >"$ROOT/pid"; : >"$ROOT/ready"; sleep 30` });
    const outDir = join(root, 'out'); mkdirSync(outDir);
    const child = spawn(join(root, 'bin/agy-run.sh'), [root, outDir, 'hi', '60'], {
        env: { ROOT: root, TMPDIR: root, AGY_POLL: '0.2', PATH: `${join(root, 'stubs')}:${process.env.PATH}` }, stdio: 'ignore',
    });
    const closed = new Promise((res) => child.on('close', res));
    for (let i = 0; i < 100 && !existsSync(join(root, 'ready')); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(join(root, 'ready')), 'agy stub started');
    child.kill('SIGTERM');
    await closed;
    const left = readdirSync(root).filter((f) => f.startsWith('tmp.'));
    assert.deepEqual(left, []);
});

test('opencode edit allows the output folder by absolute and repo-relative path, nothing else', async () => {
    const { opencodeConfig } = await import('../lib/opencodeConfig.js');
    const { edit } = opencodeConfig({ repo: '/r', out: '/r/runs/x/glm', home: '/h' }).agent['job-search'].permission;
    assert.deepEqual(edit, { '*': 'deny', '/r/runs/x/glm/**': 'allow', 'runs/x/glm/**': 'allow' });
});

test('a failed run writes why beside status.txt', (t) => {
    const reason = (x) => readFileSync(join(x.out, 'reason.txt'), 'utf8').trim();
    const timedOut = setup(t, { opencode: 'exit 124' }).go('glm');
    assert.equal(timedOut.status, 'failed');
    assert.equal(reason(timedOut), 'timed out (50 min limit)');
    assert.equal(reason(setup(t, { opencode: 'exit 3' }).go('glm')), 'the CLI exited with code 3');
    assert.equal(reason(setup(t, { opencode: 'echo "rate limit exceeded"; exit 1' }).go('glm')), 'hit its usage limit');
    // opencode exits 0 when its permissions stop every write: still ok, but the reason names it.
    const blocked = setup(t, { opencode: 'echo "Error: The user has specified a rule which prevents you from using this specific tool call."' }).go('glm');
    assert.equal(blocked.status, 'ok');
    assert.equal(reason(blocked), 'file writes were blocked by its permissions, so it saved nothing');
    assert.equal(existsSync(join(setup(t).go('glm').out, 'reason.txt')), false);
});

test('agy and opencode deny every runner folder\'s secrets, not just the one the run is on', async () => {
    const { agyPermissions } = await import('../lib/agyPolicy.js');
    const { opencodeConfig } = await import('../lib/opencodeConfig.js');
    const home = '/home/u';
    const repo = `${home}/actions-runner-3/_work/job-search/job-search`;
    const runners = [`${home}/actions-runner`, `${home}/actions-runner-2`, `${home}/actions-runner-6`];
    const { deny } = agyPermissions({ repo, out: '/o', home, runners });
    const { read } = opencodeConfig({ repo, out: '/o', home, runners }).agent['job-search'].permission;
    for (const root of [...runners, `${home}/actions-runner-3`]) assert.ok(deny.includes(`read_file(${root}/.credentials)`), root);
    for (const root of runners) assert.equal(read[`${root}/.credentials`], 'deny', root);
});
