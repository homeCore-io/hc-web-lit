# Device schema — what core added in September 2026, and what this client owes it

**Status:** core side shipped and released; this client has done none of it.
**Written:** 2026-09-08, from the session that made the core changes.

Everything here is _optional on the wire_, so nothing in this repo is broken
today. The work is about reading what core now says instead of guessing, and —
for one item — about not breaking when a plugin starts saying more.

---

## Background: the gap this closes

184 devices in the reference house; 77 published no schema at all, and of the
107 that did, **not one attribute said whether it was the point of the device**.
So `facet.ts` had to keep `UNDECLARED_HOUSEKEEPING`, a hardcoded list of
attribute names to demote — a client hardcoding plugin semantics, which is
exactly what `DeviceAction` and `BoolStates` exist to stop. Its own comment
says so and files the gap.

Core now fills that in. Four changes, in the order this client should take
them.

---

## 1. `AttributeSchema.options` may be objects — do this one first

**This is the only item that can break the client**, and it should land before
any plugin declares a label (none do yet, deliberately).

`options` is now `(string | {value, label?, icon?})[]` on the wire. Today
`api.ts:82` types it `string[]` and `controls.ts:168` passes it straight into a
select control, so an object entry would render as `[object Object]` at best.

- `icon` is a **semantic name**, not a font codepoint — the same convention
  `DeviceAction.icon` already uses. Unknown names must fall back visibly.
- An option carrying neither extra is serialised by core **as a plain string**,
  so existing payloads are byte-identical. That guarantee is pinned by a test
  in `hc-types`; this client can rely on it.

Suggested shape: normalise at the API boundary so the rest of the app sees one
type.

```ts
export interface AttributeOption {
  value: string;
  label?: string;
  icon?: string;
}

const asOption = (o: string | AttributeOption): AttributeOption =>
  typeof o === 'string' ? { value: o } : o;
```

Display rule: `label ?? humanise(value)` — `medium-high` → "Medium high". Only
the plugin can turn `cool` into "Cooling", which is the point of the field.

**Rust reference:** `hc_types::schema::AttributeOption`, and the round-trip
test `a_bare_option_is_unchanged_by_the_round_trip`.

---

## 2. `DeviceSchema.primary` — which reading the device is _for_

New field: an **ordered** list of attribute names, most important first.

```ts
export interface DeviceSchema {
  attributes?: Record<string, AttributeSchema> | null;
  actions?: DeviceAction[];
  primary?: string[]; // ← new
}
```

`category` says which attributes are _not_ the point of the device; `primary`
ranks what is left. A temperature/humidity sensor leads with `temperature`; a
multi-sensor that reports motion leads with `motion`.

**Where it lands here:** `facet.ts:159`, `readingOf()`. That function currently
derives the headline from a `device_type` stem heuristic (strip `_sensor`,
match an attribute against the stem) and otherwise takes `candidates[0]`. Both
can be replaced by the declaration:

1. First entry of `primary` that the device actually reports → that is the
   reading.
2. Fall back to the existing heuristic when `primary` is absent (an older
   core, and any device whose schema predates this).

The function's own comment names the gap this closes: _"nothing says which
reading is the point of the device, only which ones are not."_ It does now.

**Why the order is trustworthy:** core derives it from the device's own
`device_type` (`readings_for_type`), falls back to a significance rank when the
type says nothing — which is every Z-Wave node, since they are all
`device_type = "zwave"` — and **sorts whatever neither table names**. That last
part matters to this client specifically: `attributes` is a `HashMap` in Rust,
so `candidates[0]` was never stable between reads. A plugin that declares its
own `primary` keeps it; core never overwrites.

**Rust reference:** `DeviceSchema::fill_primary`, applied by hc-api when
serving `GET /devices/{id}/schema` and `?include_schema=true`.

---

## 3. `UNDECLARED_HOUSEKEEPING` can shrink — but not disappear

`AttributeCategory` is now actually set by plugins. The lexicon lives in
`hc_types::AttributeCategory::for_name` — one list in the crate that defines
the field — and covers battery (all five spellings), rssi, lqi,
signal_strength, firmware, sw_version, uptime, ip, mac, model, manufacturer,
serial, name, area, location, kind, bridge_id, resource_id, node_id, and any
`*_unit` sibling. hc-zwave, hc-ecowitt, hc-yolink and hc-isy call it.

`isHousekeeping()` already lets the declaration win, so this is a **cleanup,
not a fix**. Keep a fallback list for two reasons that will not go away soon:

- a plugin that has not restarted since the upgrade is still silent;
- a Hue facet compacted onto a **light** (`compact_motion_facets`, on by
  default) still leaves that light's extra attributes undeclared. Only aux
  devices published in their own right got schemas.

Consider trimming it to those cases and citing this file, rather than deleting
it.

---

## 4. Devices that had no schema now have one

Nothing to implement — `controls.ts:180` already renders `s.actions`
generically — but expect these to appear where the client previously saw
nothing, and check they look right:

| Devices                                                     | What they now declare                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lutron fan / shade / pulsed CCO                             | speed ladder; `position` + `raise`/`lower`/`stop` actions; `activate`                                                                                              |
| Lutron phantom scenes                                       | `activate`, plus `on` **only when the scene's LED reports** — and `phantom_button` / `led_component` as diagnostics, so the UI can say _why_ a scene has no status |
| Lutron timeclock events                                     | `enabled` (writable) + `execute` action                                                                                                                            |
| Lutron occupancy groups                                     | `occupied` and `occupancy` — the same reading under both names it has always published                                                                             |
| Caséta dimmer/switch/fan/shade/occupancy/scene              | everything except the Pico, which had the only schema before                                                                                                       |
| Hue scenes                                                  | `activate`, plus `active` when the bridge reports `status.active`                                                                                                  |
| Hue aux devices (motion, temperature, light level, buttons) | derived from what they publish                                                                                                                                     |
| Ecowitt gateway                                             | its ip/mac/model/firmware, all diagnostic                                                                                                                          |
| Core glue devices (timers, counters, groups…)               | had schemas in core all along; a wiring bug meant they were rarely written                                                                                         |

Two are worth a UI thought:

- **A scene may declare no readable state.** A Caséta scene never reports (no
  LEDs anywhere in Caséta); a Lutron phantom scene reports only if its button
  has an LED — the ones that do not are scenes tied to a Pico. The absence of
  `on` in the schema is the signal, and `led_component` is the explanation.
- **An empty attribute set is a statement**, not a missing schema: a pulsed CCO
  declares `{attributes: {}, actions: [activate]}` because the Integration
  Guide forbids querying a momentary output. Do not treat it as "no schema".

---

## 5. `states` is documented now

No code change — this client already reads `BoolStates`. It simply was not in
`docs/openapi.yaml` before, along with `category`. Both are now, plus a
`StateLabel` component and the `options` union, so the spec is worth trusting
again as the contract reference.

---

## Verifying against a live core

The dev server proxies `/api/v1` to `HC_CORE_URL` (default
`http://10.0.10.150:8080`). Check what you are actually talking to:

```sh
curl -s $HC_CORE_URL/api/v1/health
```

`primary` appears as soon as **core** is new enough — hc-api derives it at
serve time, even for schemas stored from older plugins. `category` and the new
schemas need the **plugins** restarted, since those are retained MQTT topics
published at registration. A Lutron scene's `on` settles about a second after
the LIP connect, once the LED queries answer.

Sanity check across the house:

```sh
curl -s "$HC_CORE_URL/api/v1/devices?include_schema=true" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); \
    print(sum(1 for r in d if r.get("schema")), "of", len(d), "have schemas")'
```

Before this work: 107 of 184.

---

## A gap worth closing while you are here

Layout has an oracle: core generates `dashboard-layout-fixtures.json`, a
snapshot test fails if the engine drifts, and `tool/sync-layout-fixtures.sh`
copies it here so CI has it without cloning core.

**Device schemas have no equivalent.** The types in `api.ts` are hand-written
against `docs/openapi.yaml`, and nothing catches drift — every field above
reached this repo by a person writing it down, including this file. A
`device-schema-fixtures.json` on the same pattern would make the next change
announce itself.
