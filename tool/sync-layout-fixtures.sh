#!/usr/bin/env bash
# Copy core's layout fixtures into this repo.
#
# `core/docs/dashboard-layout-fixtures.json` is generated from
# `hc_types::dashboard_layout` and a snapshot test in core fails the build if
# the two drift. So the fixtures are the oracle, and this script is how a copy
# of them gets here — committed, so CI has them without cloning core.
#
# Re-run after any change to the layout engine in core, and commit the result.
# If the tests then fail, the engine's behaviour changed and this client has to
# follow; that is the whole point of the arrangement.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${1:-$here/../../core/docs/dashboard-layout-fixtures.json}"
dst="$here/test/fixtures/dashboard-layout-fixtures.json"

if [ ! -f "$src" ]; then
    echo "error: fixtures not found at $src" >&2
    echo "pass the path explicitly: $0 /path/to/dashboard-layout-fixtures.json" >&2
    exit 1
fi

cp "$src" "$dst"
echo "synced $(basename "$dst") <- $src"
