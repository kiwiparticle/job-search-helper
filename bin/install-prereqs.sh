#!/usr/bin/env bash
# Install what bin/setup.js checks for, on Ubuntu/Debian (WSL included). Skips anything already there.
#   bin/install-prereqs.sh            Node 26, pnpm, gh, jq, Claude Code
#   bin/install-prereqs.sh --kits     also pandoc, LibreOffice Writer, poppler (application kits, ~300 MB)
#   bin/install-prereqs.sh --browser  also Chromium for the browser board finder
# Logins stay yours: gh auth login, npx wrangler login, claude (or codex login).
set -euo pipefail
cd "$(dirname "$0")/.."

kits=0 browser=0
for a in "$@"; do
    case "$a" in
        --kits) kits=1 ;;
        --browser) browser=1 ;;
        *) echo "usage: bin/install-prereqs.sh [--kits] [--browser]" >&2; exit 2 ;;
    esac
done
command -v apt-get >/dev/null || { echo "apt-get not found: this script is for Ubuntu/Debian. Install by hand (see README)." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive # no tzdata prompt mid-install
has() { command -v "$1" >/dev/null 2>&1; }

pkgs=(curl ca-certificates jq gh)
[ "$kits" = 1 ] && pkgs+=(pandoc libreoffice-writer poppler-utils)
need=()
for p in "${pkgs[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
if [ ${#need[@]} -gt 0 ]; then
    echo "== apt: ${need[*]}"
    sudo apt-get update -qq
    sudo -E apt-get install -y "${need[@]}"
fi

if ! has node || [ "$(node -p 'parseInt(process.versions.node)')" -lt 26 ]; then
    echo "== Node 26 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
    sudo -E apt-get install -y nodejs
fi

has pnpm || { echo "== pnpm"; sudo npm i -g pnpm; }

if ! has claude && ! has codex; then
    echo "== Claude Code"
    curl -fsSL https://claude.ai/install.sh | bash
    export PATH="$HOME/.local/bin:$PATH" # where the installer puts it; a new shell has it on PATH
fi

if [ "$browser" = 1 ]; then
    echo "== Chromium"
    pnpm install --frozen-lockfile
    pnpm exec playwright install --with-deps chromium
fi

echo
echo "Installed. Log in to each if you have not (they open a browser):"
gh auth status >/dev/null 2>&1 || echo "  gh auth login"
echo "  npx wrangler login"
has claude && echo "  claude   (then /login)"
echo "Then: node bin/setup.js --check"
