#!/usr/bin/env bash
# Owner's install only: pull engine updates, test, push, deploy. Run from the repo root.
set -euo pipefail

git remote get-url upstream >/dev/null 2>&1 || {
    echo "No 'upstream' remote. Add it: git remote add upstream https://github.com/kiwiparticle/job-search-helper.git" >&2
    exit 1
}
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Uncommitted changes to tracked files; commit them first." >&2
    exit 1
fi

before=$(git rev-parse HEAD)
git fetch upstream
git pull --no-rebase --no-edit upstream main
if ! git diff --quiet "$before" HEAD -- pnpm-lock.yaml; then
    pnpm install --frozen-lockfile
fi
pnpm test
git fetch origin
git pull --no-rebase --no-edit origin main # the runner and page commit here too
git push origin HEAD:main
pnpm run deploy
