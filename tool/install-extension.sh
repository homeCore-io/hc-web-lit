#!/usr/bin/env bash
#
# Install a built extension into the store.
#
# "Installing" is copying a directory, which is the whole design (§
# server/extensions.ts): the store is what is on the disk, so a broken install
# is visible with `ls` rather than only through the running program. This
# script exists because the *id* is inside the manifest and the source
# directory is named after the tag, and getting that wrong produces an
# extension that serves 404s under a name nobody typed.
#
#   tool/install-extension.sh extensions/hc-button
#
# Set HC_CONTENT_DIR to install somewhere other than ./var — the same variable
# the server reads, so the two always agree about where the store is.
set -euo pipefail

src="${1:?usage: install-extension.sh <built-extension-dir>}"
content="${HC_CONTENT_DIR:-./var}"

manifest="$src/hc-extension.json"
[ -f "$manifest" ] || { echo "no $manifest" >&2; exit 1; }

# node rather than jq: this repo already requires node and does not require jq,
# and an install step that fails on a machine that can build the thing it is
# installing is not much of an install step.
id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id ?? "")' "$manifest")"
[ -n "$id" ] || { echo "$manifest has no id" >&2; exit 1; }

entry="$(node -e 'process.stdout.write((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).entry ?? "").replace(/^\.?\//,""))' "$manifest")"
if [ -n "$entry" ] && [ ! -f "$src/$entry" ]; then
  # The failure this catches: installing the source directory before building
  # it. The host would report "did not load" against a 404 and the admin would
  # go looking at the server.
  echo "$manifest names entry '$entry', which is not in $src — build it first" >&2
  exit 1
fi

dest="$content/extensions/$id"
mkdir -p "$dest"
# Everything but the sources: an extension ships the module it built, not the
# TypeScript it built it from.
find "$src" -maxdepth 1 -type f ! -name '*.ts' -exec cp {} "$dest/" \;

echo "installed $id -> $dest"
