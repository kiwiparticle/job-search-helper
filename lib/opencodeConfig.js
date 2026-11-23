import { relative } from 'node:path';
import { RUNNER_SECRETS, runnerRoots } from './agyPolicy.js';

// Per-call opencode config, passed as OPENCODE_CONFIG_CONTENT. UNVERIFIED: key names and glob syntax come from
// memory of the opencode docs and were never run. If opencode silently ignores a key, that restriction is simply
// absent (it does not error), so the owner's check must try: read of auth.json, a `task` call, a write outside $out.
export function opencodeConfig({ repo, out, home, runners = runnerRoots(home) }) {
    const only = { '*': 'deny', [`${repo}/**`]: 'allow', [`${out}/**`]: 'allow' };
    return {
        agent: {
            'job-search': {
                description: 'Job-search model run. Web search and fetch; writes only to its output folder; no shell.',
                mode: 'primary',
                permission: {
                    bash: 'deny',
                    task: 'deny',
                    websearch: 'allow',
                    webfetch: 'allow',
                    external_directory: only,
                    // Last match wins: allow everything in scope, then deny secrets (second layer behind external_directory).
                    read: {
                        '*': 'allow',
                        [`${home}/.local/share/opencode/**`]: 'deny',
                        [`${home}/.config/opencode/**`]: 'deny',
                        // The subscription logins, ssh keys and runner credentials (the agy policy denies the same).
                        [`${home}/.claude/**`]: 'deny',
                        [`${home}/.codex/**`]: 'deny',
                        [`${home}/.ssh/**`]: 'deny',
                        // Runner secrets by file, never the whole folder: the checkout and $RUNNER_TEMP are under actions-runner/_work.
                        // Every runner folder, not just this one: six runners share the PC.
                        ...Object.fromEntries([...new Set([`${home}/actions-runner`, ...runners])].flatMap((root) => RUNNER_SECRETS.map((f) => [`${root}/${f}`, 'deny']))),
                        [`${home}/.git-credentials`]: 'deny',
                        [`${home}/.npmrc`]: 'deny',
                        '**/auth.json': 'deny',
                        '**/.env': 'deny',
                        '**/.env.*': 'deny',
                    },
                    // opencode matches the path as the model wrote it: models often write `runs/<run>/<id>/x.json`
                    // relative to the repo, which the absolute pattern alone denied (glm-flash lost every run's output to this).
                    edit: { '*': 'deny', [`${out}/**`]: 'allow', [`${relative(repo, out)}/**`]: 'allow' },
                },
            },
        },
    };
}
