"""Reduce a live device list to a schema fixture.

One representative device per (device_type, schema shape), with ids and names
replaced. The shapes are the point — a fixture that carried the house's device
inventory would be publishing something that is not ours to publish, and would
churn every time a bulb was renamed.
"""

import json
import sys


def shape(schema):
    """What makes two schemas the same for our purposes."""
    if not schema:
        return "none"
    attrs = schema.get("attributes") or {}
    return json.dumps(
        {
            "keys": sorted(attrs),
            "kinds": sorted({a.get("kind") for a in attrs.values()}),
            "writable": sorted(k for k, a in attrs.items() if a.get("writable")),
            "categories": sorted({a.get("category") for a in attrs.values() if a.get("category")}),
            "actions": sorted(a["id"] for a in schema.get("actions") or []),
            "primary": schema.get("primary"),
        },
        sort_keys=True,
    )


def main():
    devices = json.load(sys.stdin)
    seen = {}
    for d in devices:
        key = (str(d.get("device_type")), shape(d.get("schema")))
        if key in seen:
            continue
        seen[key] = {
            "device_type": d.get("device_type"),
            "plugin_id": d["plugin_id"],
            # Kept: what a client reads. Dropped: which device it was.
            "attributes": d.get("attributes", {}),
            "schema": d.get("schema"),
        }

    out = {
        "source": "GET /api/v1/devices?include_schema=true",
        "contract": "SCHEMA_CONTRACT_2026-09.md",
        "note": (
            "One device per (device_type, schema shape), anonymised. Refresh "
            "with tool/sync-device-schema-fixtures.sh."
        ),
        "shapes": sorted(seen.values(), key=lambda r: (str(r["device_type"]), r["plugin_id"])),
    }
    json.dump(out, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
