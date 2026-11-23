#!/bin/bash
PATH=/usr/bin:/bin
# usage: collect-output.sh <model-dir> <dest-dir> <name>...
# Copies only the named plain files out of a folder a model could write to. Run as a copy outside the checkout,
# under `env -i`. Refuses symlinks, hard links, files over 2 MB, and names with "/" or "..". A missing file is not an error.
set -u
main() {
src=$1; dest=$2; shift 2
# A fresh destination: a pre-planted symlink or file there must not be written through.
rm -rf "$dest"; mkdir -p "$dest"
rc=0
for name in "$@"; do
    case "$name" in */*|*..*|"") echo "refused name: $name" >&2; rc=1; continue ;; esac
    f="$src/$name"
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -L "$f" ] || [ ! -f "$f" ]; then echo "refused (not a plain file): $name" >&2; rc=1; continue; fi
    if [ "$(stat -c %s "$f")" -gt 2097152 ]; then echo "refused (over 2 MB): $name" >&2; rc=1; continue; fi
    if [ "$(stat -c %h "$f")" -gt 1 ]; then echo "refused (hard link): $name" >&2; rc=1; continue; fi
    cp --no-dereference -- "$f" "$dest/$name"
done
exit $rc
}
main "$@"; exit
