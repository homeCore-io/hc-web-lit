#!/usr/bin/env bash
# Capture real device schemas as a fixture, from a live core.
#
# `SCHEMA_CONTRACT_2026-09.md` names the gap this closes: layout has an oracle
# — core generates the fixtures, a snapshot test fails if the engine drifts —
# and device schemas have none. Every field in `api.ts` reached this repo by a
# person writing it down, and nothing catches the next change.
#
# This is the weaker half of that: a real payload, pinned, so a shape change
# announces itself as a failing test rather than as a widget quietly rendering
# [object Object]. The stronger half is core generating it, which is worth
# asking for once this proves its keep.
#
# Devices are anonymised: ids and names are replaced, because a fixture is
# checked in and a device inventory is not ours to publish. Shapes are kept
# exactly.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
core="${HC_CORE_URL:-http://10.0.10.150:8080}"
out="$here/test/fixtures/device-schemas.json"

token=$(curl -fsS -m 10 -X POST "$core/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${HC_USER:-admin}\",\"password\":\"${HC_PASS:-password}\"}" \
    | sed -e 's/.*"token":"//' -e 's/".*//')

[ -n "$token" ] || { echo "error: could not log in to $core" >&2; exit 1; }

curl -fsS -m 30 -H "Authorization: Bearer $token" \
    "$core/api/v1/devices?include_schema=true" \
    | python3 "$here/tool/anonymise-schemas.py" > "$out"

echo "wrote $(basename "$out") from $core"
