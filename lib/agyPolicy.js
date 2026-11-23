import { resolve, join } from 'node:path';
import { readdirSync } from 'node:fs';

// Per-call agy permissions, passed to `agy -p --settings <file>` (bin/agy-run.sh). Source: antigravity.google/docs/permissions?tab=cli
// (rules are action(target); Deny > Ask > Allow; directory grants are recursive; write_file implies read_file).
// Tested 2026-11-19: deny rules apply; write_file(out) does NOT stop writes elsewhere, and a model can run shell commands.
// No glob targets: agy's sandboxed shell rejects them ("deny **/.env: globs not supported") and the model then retries
// with BypassSandbox. No `ask` list: an ask rule would shadow the allows. Web is read_url(*).
// Files in the runner root that hold registration or job credentials. The runner root is the repo's ../../.. (<root>/_work/<name>/<name>).
export const RUNNER_SECRETS = ['.credentials', '.credentials_rsaparams', '.runner', '.env'];

// Every runner folder in home (actions-runner, actions-runner-2, ...): a model on one runner must not read another's secrets.
export function runnerRoots(home) {
    try {
        return readdirSync(home, { withFileTypes: true }).filter((d) => d.isDirectory() && /^actions-runner(-\d+)?$/.test(d.name)).map((d) => join(home, d.name));
    } catch {
        return [];
    }
}

export function agyPermissions({ repo, out, home, runners = runnerRoots(home) }) {
    const roots = [...new Set([resolve(repo, '../../..'), ...runners])];
    return {
        allow: ['read_url(*)', `read_file(${repo})`, `write_file(${out})`],
        // Deny beats Allow, so these hold even if $out or the repo sits under them.
        deny: [`read_file(${home}/.gemini)`, `read_file(${home}/.ssh)`, `read_file(${home}/.config)`, `read_file(${home}/.local/share)`,
            // Subscription logins and the runner's registration secrets.
            `read_file(${home}/.claude)`, `read_file(${home}/.codex)`, `read_file(${repo}/.env)`, `read_file(${home}/.env)`,
            // The runner's own secret files only. Never the whole folder: the checkout and $RUNNER_TEMP live under actions-runner/_work,
            // and write_file($out) implies read_file, so a folder-wide deny blocks the model's own output (seen in the first agy spike).
            ...roots.flatMap((root) => RUNNER_SECRETS.map((f) => `read_file(${root}/${f})`))],
    };
}
