#!/usr/bin/env bash
# Capture core's dashboard vocabulary as a fixture, from a live core.
#
# The same gap `sync-device-schema-fixtures.sh` names, for the other contract
# this client reads: core validates every document against
# `hc_types::dashboard_vocabulary`, and the property panel generates its
# controls from that same table. If the table gains a field, a widget option
# quietly stops being editable; if a field changes shape, the panel offers the
# wrong control. Neither announces itself.
#
# Unlike device schemas this needs no anonymising: the vocabulary is derived
# from core's types and contains nothing about the house — no ids, no names, no
# plugins. That is checked below rather than assumed, because a fixture is
# checked in and a device inventory is not ours to publish.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
core="${HC_CORE_URL:-http://10.0.10.150:8080}"
out="$here/test/fixtures/vocabulary.json"

token=$(curl -fsS -m 10 -X POST "$core/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${HC_USER:-admin}\",\"password\":\"${HC_PASS:-password}\"}" \
    | sed -e 's/.*"token":"//' -e 's/".*//')

[ -n "$token" ] || { echo "error: could not log in to $core" >&2; exit 1; }

body=$(curl -fsS -m 30 -H "Authorization: Bearer $token" "$core/api/v1/dashboards/vocabulary")

# The vocabulary is a catalogue of types. Anything that looks like an id or a
# host is the house leaking into a file that goes into git.
if printf '%s' "$body" | grep -Eqi '[0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-f]{12,}'; then
    echo "error: response looks like it contains house data; not written" >&2
    exit 1
fi

# Written the way the repo formats everything else, so refreshing the fixture
# does not fail the format gate on the next commit.
printf '%s' "$body" > "$out"
npx prettier --write "$out" > /dev/null

echo "wrote $(basename "$out") from $core"
