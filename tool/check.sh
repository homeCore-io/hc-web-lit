#!/usr/bin/env bash
# Every CI gate, in CI's order, failing loudly.
#
# This exists because reading `npm run lint | tail -1` is not a check: eslint's
# last line is blank when it fails, so truncated output reads as success and
# three red pushes went out believing otherwise. `set -e` and a visible verdict
# are the fix — the point of a gate is that it can say no.
#
# Mirrors hc-scripts/.github/workflows/node-ci.yml. If the two drift, that
# workflow is right and this is wrong.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

step() {
    printf '\n\033[1m== %s\033[0m\n' "$1"
    shift
    "$@"
}

step "typecheck" npm run typecheck
step "lint" npm run lint
step "format" npm run format:check
step "test" npm test
step "build" npm run build

printf '\n\033[32mall gates passed\033[0m\n'
