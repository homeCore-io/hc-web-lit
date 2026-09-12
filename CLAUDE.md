# hc-web — UI Architecture

> Design record and implementation context for the homeCore web UI.
> Drop into the repo root as `CLAUDE.md` (or import into `docs/`) so Claude Code
> picks it up per session.

**Status:** Phases 0–3 done, Phase 4 all but the last of §7.3's family.
Phase 10 is in progress: both authoring modes, containers (§14.2b), and
host-enforced edit mode are in, and a widget — or a whole container — can be
dragged between containers.
The boxes in §18.3 are kept ticked as work lands; an item naming something
that was deliberately not built says so on the line rather than staying blank.
**Supersedes:** the Flutter/wasm implementation of hc-web
**Targets:** browser — desktop and tablet. **No desktop-native target.**

**A phone is not served by the current design, and saying so is the honest
line.** The household's pages are composed layouts on a 1240px canvas with
`frame.fit: "scroll"`, which §5.7 chose deliberately: scaling a composition to
390px renders 3px type, so a phone scrolls a desktop page sideways instead.
That is the right call for a *borrowed* layout and it is not a phone design.
This was listed as a shipping target and measured as one — the household's
verdict is that it will definitely not work on a phone — so the line now says
what the product does.

**A phone layout is a page somebody authors for a phone**, not a smaller
rendering of a composed one — and this client can draw one today. The
household's `Getting Started` page proved it before it was deleted: four
layouts (mobile, tablet, desktop, tv) in the *packed* flow, whose mobile layout
was a single column that reflowed with no sideways scroll. So the phone gap is
a question of authoring rather than of capability: a composed 1240px canvas
cannot become a phone page, and a grid page already is one. Whoever takes the
phone on starts from a packed layout with a `mobile` breakpoint, not from the
room page's shape.

---

## 1. Purpose

hc-web is the primary user interface for homeCore. It is an API consumer only —
it holds no automation logic and no privileged state. Everything it does is
available over the hc-api REST/WebSocket surface.

It has two modes:

- **Viewer** — renders dashboards. Runs on phones, tablets, wall-mounted
  kiosks, and desktop browsers.
- **Designer** — authors dashboards on a canvas, binds widgets to devices,
  manages assets and extensions.

The flagship surface is an **interactive floorplan** driven by imported Sweet
Home 3D geometry (§11, §12). The **rule editor** (§21) is the other major
authoring surface.

Stream processing of MQTT and webhook payloads is a **separate system** with its
own runtime, document model, and editor — see `HC_PIPELINE_ARCHITECTURE.md`. The
boundary between the two is specified in §22 and is deliberately enforced, not
merely conventional.


### 1.1 Vocabulary — homeCore's nouns, not Home Assistant's

This document was drafted in Home Assistant's vocabulary. homeCore does not use
it, and the ABI must not either. §19.7 makes these names permanent, so they are
fixed here rather than after Phase 1.

| Home Assistant | homeCore | Where it is defined |
|---|---|---|
| entity | **device** | `hc_types::device::DeviceState` |
| `entity_id` | **`device_id`** | plugin-assigned, stable from registration |
| domain (`light.*`) | **`device_type`** | an open string, not an enum — see below |
| — | **`ui_hint`** | user override of `device_type` for presentation (`"door"`, `"window"`, `"garage"`) |
| `friendly_name` | **`name`** / `name_override` | `effective_name()` = override ?? plugin name |
| area | **`area`** / `area_override` | slug (`living_room`); `effective_area()` = override ?? plugin area |
| `state` (scalar) | **`attributes`** (map) | there is no scalar state — see below |
| more-info | **details** | homeCore has no "more info" dialog |

**`device_type` is an open set, and wider than a domain list.** Observed across
184 devices in the reference house, with the plugins that produce them:

| | | |
|---|---|---|
| `scene` 58 | `switch` 28 | `light` 16 |
| `temperature_sensor` 14 | `zwave` 9 | `pico_remote` 8 |
| `contact_sensor` 8 | `media_player` 7 | `water_sensor` 7 |
| `occupancy_sensor` 5 | `fan` 4 | `timer` 4 |
| `keypad` 3 | `lock` 2 | `motion_sensor` 1 |
| `bridge` 1 | `gateway` 1 | `vcrx` 1 |
| `lightning_sensor` 1 | `rain_sensor` 1 | `weather_station` 1 |
| `vibration_sensor` 1 | **absent** 3 | |

Three things to take from that list rather than from a guess:

- **`device_type` is absent on real devices.** Three of 184 have none at all
  (`core.mode`, `wled`). Every consumer treats it as `string | undefined`, and
  the facet primitive has to answer for a device that declines to say what it
  is.
- **Half the vocabulary is vendor-shaped**, not domain-shaped: `pico_remote`,
  `vcrx`, `keypad`, `bridge`, `gateway`, `zwave`. These are what a bridge calls
  its own hardware, and they arrive because a plugin published them. A widget
  family organised around Home Assistant's domain list has nothing to say about
  a third of this house.
- **`cover` and `thermostat` do not appear here at all**, though core knows
  both. So the observed set is a snapshot of one deployment, not the schema —
  which is exactly why `device_type` is a plain string that core accepts
  unknown values for, and why a client must never close the set.

`ui_hint` carries `"light"` in this house — switches wired to lights, corrected
by hand. That is the field doing its job, and it is why the facet primitive
refines `device_type` rather than trusting it.

**The one that is not a rename.** A homeCore device has no scalar state string.
It has `available: bool` and `attributes: HashMap<String, Value>`, and
"on-ness" is *derived* from whichever attribute the device actually publishes —
`on`, `locked` (inverted), `open`, `motion`, `occupancy`/`occupied`, `active`
for an applied scene, a `state` string for transports (`"running"`,
`"playing"`), or, last, a non-zero level. `entity.state == "on"` has no
translation.

**Ask what kind of device it is before asking whether it is on.** A temperature
sensor is not off — it reports a value and cannot be turned off, so "is it on?"
is the wrong question rather than an unanswered one, and a card that renders
"Off" beside a thermometer has invented a fact.

**That is derived, not listed.** A device with a writable attribute or a
declared action is one you *command*; one with a schema and neither is one you
*read* (§5.11). Across 184 real devices that is right every time, including the
case a `device_type` table gets wrong: a `pico_remote` declares no writable
attribute and no action — it transmits, and cannot be pressed remotely — while a
`keypad` declares `press_button`. Same hardware shape, opposite answers, and the
plugins already said so.

A client-side table mapping type names to behaviours would be closed against the
next plugin, different in every client, and would produce a plausible wrong
answer instead of a visible gap. Where the schema cannot answer, the answer is
**unknown** and the card shows nothing — which is how homeCore#28's 77
schema-less devices stayed visible instead of being papered over until the
plugins declared them. All 184 do now, and the rule is what kept the count
honest while they did not.

**And on-ness has three answers, not two.** A lamp is on or off; a temperature
sensor is neither, and neither is a Pico remote, a keypad, a bridge, or a scene
that fires and forgets. About forty devices in the reference house publish
nothing the derivation can read, so `isOn` returns `undefined` for them — and a
card shows nothing rather than "Off", because "Off" beside a thermometer is an
invented fact, not a cautious one.

**And the level is not one number either.** A Hue bulb publishes `brightness`
(0–255) *and* `brightness_pct` (0–100) for the same lamp; half the lights in the
reference house publish only the percentage. A fan publishes `speed_pct`. Any
code that reads "whichever level attribute appears first" is right on some
fixtures and 2.55× wrong on others — which is why this is a host primitive and
not something each widget works out.

That derivation is a **host primitive in its own right**: `is_on(device)` and
the device→facet classification (`device_type` refined by `ui_hint` and by which
attributes are present) must live in the host, be reachable from `HcContext`,
and be the only implementation. hc-web-flutter's
`lib/core/devices/presentation.dart` is the working reference — every widget
that got this wrong got it wrong the same way.

**The naming ratchet is mechanical.** `hc_types::dashboard_vocabulary` requires
reference fields in a widget config be named `device_id` / `device_ids` /
`scene_id` / `scene_ids` / `add` / `remove` / `order`. A config field named
`entity_id` is rejected by core's validator, not by review.


### 1.2 Where authority lives

homeCore is an API with several clients — hc-tui, hc-mcp, hc-web-flutter,
hc-web-lit, and whatever comes next. This document is one client's design. It is
bound by core's contracts and by nothing else.

| | Binding | Why |
|---|---|---|
| **hc-api, and the documents it stores** | **yes** | `DashboardDefinition`, `WidgetDescriptor`, `dashboard_vocabulary`, `dashboard_layout` + its fixtures. Every client answers to these; disagreeing does not produce a different-looking page, it corrupts a shared document (§5.7). |
| **hc-web-flutter** | **no** | One client's interpretation. Worth reading; never the reason for a decision. |

The line between them is not a judgement call — it has already been drawn, in
code. `hc_types::dashboard_layout` says of itself: *"Ported from the Dart,
faithfully."* The semantics that had to be shared were lifted **into core**, so
citing them is citing core. **What remains only in the Dart is, by
construction, what core declined to standardise** — that client's own product
choices, informative and not binding.

**And this document exists because that client hit a wall** (§2): AOT
compilation, no runtime code loading, no extension ABI. A design shaped around
that limit is the wrong starting point for the design that exists to escape it.
So the failure mode to guard against is not ignoring prior art — it is
*inheriting* it. Where the Dart solved a problem this architecture no longer
has, or solved it in a way an extension author could never reproduce, the answer
is to design, not to port.

**Presentation belongs to the client.** §1.2 says what binds; this says what
core should have been asked for in the first place. The line:

| | Core | Client |
|---|---|---|
| What a plugin declares — capabilities, device schema (§5.11) | ✅ | |
| What a document *is* — structure, references, validity | ✅ | |
| What is true about the house — devices, areas, rules, history | ✅ | |
| **How any of it looks** — skins, token derivation, control choice, chrome | | ✅ |
| **What a stored layout means** — gravity, packing | ⚠️ both | ⚠️ |

The last row is the boundary case and it is worth naming rather than pretending
away. `hc_types::dashboard_layout` is a full layout engine living in a crate
whose own comment says *"core does not lay anything out"*. The defensible half
is `is_legal` — core rejects illegal placements, so a client that disagrees
loses the user's edit, and the fixtures are how the two stay in step. The rest
of it is presentation that ended up in core because one client needed another
client to agree with it.

**So the default is: ask core to store it, not to compute it.** Skins are the
worked example. Core holds ~26 seeds and refuses to judge them; the derivation
to 74 tokens is a pure function in the client, where a better rule can ship
without a core release and a terminal client can ignore the whole question.
That is the right shape, and §15 originally proposed the opposite — a
`/api/tokens.json` serving resolved tokens — which is removed.

**The driver is extensibility.** Every structural question in this document
resolves toward the answer that lets somebody outside this repo add a widget, a
layer, a template or a pipeline node without a rebuild and without a pull
request. When a decision looks balanced on its other merits, that is the
tie-break — and a decision that is convenient for the first-party client but
closes a door for extensions is not balanced, it is wrong (§3, Rule 1).

---

## 2. Decision record: why not Flutter

The Flutter implementation is being replaced. The reason is structural, not
stylistic.

Flutter compiles the full widget graph ahead of time (dart2js or dart2wasm).
There is no supported runtime code-loading path — `dart:mirrors` is unavailable
on web, deferred loading only splits code known at build time, and assets are
resolved through a build-time `AssetManifest` declared in `pubspec.yaml`. The
practical consequences:

- A third-party widget requires recompiling and redeploying the entire app.
- A user-supplied icon or image requires a rebuild to become a first-class asset.
- There is no stable ABI to expose to extension authors.

Workarounds exist (`dart_eval` / `flutter_eval` bytecode interpretation of a
Dart subset) but they trade compile-time errors for opaque runtime ones and
require the host team to maintain the interop surface indefinitely.

**Critical corollary:** this is a property of AOT-compiled UI frameworks, not of
Flutter. Leptos, Dioxus-web, Yew, and Slint's normal compiled mode all share it.
Switching to "a Rust Flutter" rebuilds the same wall. The framework choice must
be driven by the *extension ABI*, not by language preference.

The web platform is selected because dynamic module loading and runtime asset
resolution are native to it, and because it is the only option that reaches
desktop browser, phone, and wall tablet with one codebase.

**Accepted cost:** we give up pixel-identical cross-platform rendering and the
native mobile app target. We take on browser-compatibility testing as ongoing
maintenance. This is a deliberate trade for extensibility.

---

## 3. Architecture overview

```
hc-api (Rust, axum)
  ├── REST                    devices, dashboards, scenes, services, config
  ├── WebSocket               device state stream, scoped subscriptions
  ├── /api/query              device queries (server-evaluated)          [NEW]
  ├── /api/history            history + statistics for charts            [NEW]
  ├── /api/templates          parameterized widget templates             [NEW]
  ├── /api/extensions/**      extension manifests + ESM bundles          [NEW]
  ├── /api/assets/**          user + extension asset store               [NEW]
  ├── /api/spatial/**         hc-spatial documents, SH3D import          [NEW]
  └── /api/skins              skin *seeds*; the client derives the tokens

hc-spatial (Rust crate)
  ├── model                   normalized home geometry, versioned schema
  ├── import/sh3d             Sweet Home 3D → hc-spatial     [NEW — see §12.2]
  ├── import/…                future: DXF, IFC, raster+trace
  └── merge                   non-destructive re-import diff/merge

hc-web (TypeScript, Lit 3, Vite)
  ├── shell                   routing, auth, connection, theming
  ├── core                    device store, subscription fan-out, service calls
  ├── primitives/             THE HOST PRIMITIVES (§5)
  │   ├── present             is_on, facet, effective name/area (§1.1)
  │   ├── capability          device + plugin schemas, control generation (§5.11)
  │   ├── expr                JS expression compile + cache (§6)
  │   ├── query               device queries
  │   ├── templates           parameterized widget templates
  │   ├── compose             chrome-free widget nesting
  │   ├── overlay             dialogs, sheets, popovers
  │   ├── layout              responsive grid engine
  │   ├── style               CSS custom properties + ::part() contract
  │   ├── history             history/statistics query client
  │   └── actions             tap/hold/double-tap + confirmation model
  ├── runtime                 dashboard viewer
  ├── designer                authoring surface (DOM, transformed scene)
  ├── ext-host                manifest load, frame host, HcContext transport
  ├── floorplan               floorplan surface + layer host
  └── widgets/                first-party widget family — built AS extensions
```

**Rule 1:** first-party widgets use the same extension interface as third-party
ones. No privileged built-ins. If a first-party widget needs a capability the
extension ABI lacks, the ABI is wrong and gets extended. Home Assistant skipped
this discipline and their built-in cards have reach that community cards cannot
match; that gap is the thing we are avoiding.

The same rule applies one level down: first-party **floorplan layers** use the
same layer API third-party layers use (§11.4).

**Rule 2 — primitives precede the published ABI.** See §5 and §18.1. A
sequencing constraint on the build, not just an architectural preference — and
deliberately *not* "primitives precede any widget", which is a different and
much more expensive claim.

**Rule 3 — keep the surface serializable in principle.** Widgets run in the main
realm (§8.1), so `HcContext` is a plain object and calls are direct. But keep
every capability *expressible* as a message — narrow, data-in-data-out, no
handing over host internals — so the sandbox path stays available for the kinds
that want it without an ecosystem-breaking rewrite. A discipline on the design,
not a tax on the caller.

---

## 4. The extension contract

This is the ABI. It is the most expensive thing to change later. Lock it before
writing UI.

### 4.1 Widget interface

```ts
export interface HcWidget extends HTMLElement {
  /** Called once at setup, with expressions already resolved by the host.
   *  Throw to signal invalid config; the host renders an error state. */
  setConfig(config: unknown): void;

  /** Host injects the scoped capability object. Called after setConfig. */
  connect(ctx: HcContext): void;

  /** Preferred size. Grid cells in grid mode, frame units in free mode
   *  (§14.1) — the host says which it is asking for. */
  getSize(mode: "grid" | "free"): { w: number; h: number };
}
```

A widget is a custom element and the host calls it directly. Keep the surface
narrow enough that it *could* be messages (Rule 3) — that is what leaves the
sandbox available later for the cases that want it (§8.1), without making every
author write `await` today for a call that does not cross anything.

### 4.2 HcContext — the capability boundary

Widgets never touch the WebSocket, the auth token, `window`, or `fetch`
directly. Everything flows through this object. **Every host primitive (§5) is
reachable here** — that is what stops extensions from reimplementing them.

```ts
export interface HcContext {
  /** Scoped subscription. Host pushes only the requested devices. */
  subscribe(deviceIds: string[], cb: (states: DeviceState[]) => void): Unsubscribe;

  /** Invoke a homeCore service. Host applies auth, rate limiting, confirmation. */
  call(service: string, payload: unknown): Promise<void>;

  /** P1 — evaluate a pure expression against the current binding scope. */
  expr: ExprEvaluator;

  /** P2 — resolve a device query to a live, auto-updating device set. */
  query(q: DeviceQuery): QueryResult;

  /** P5 — open a dialog, bottom sheet, or popover owned by the host.
   *  Prefer a widget *spec* over a DOM node: a spec is storable as config,
   *  which is what makes "tap opens a room sheet" a setting rather than code. */
  overlay: OverlayApi;

  /** P8 — history and statistics, downsampled server-side. */
  history(req: HistoryRequest): Promise<HistorySeries[]>;

  /** P9 — run a configured action with the shared safety/confirm policy. */
  action(cfg: ActionConfig, source: ActionSource): Promise<void>;

  /** Resolve an asset reference to a URL, namespaced to this extension. */
  asset(ref: string): string;

  /** Shared Rive runtime — never bundle your own. */
  rive: RiveRuntime;

  /** Read-only spatial model, when one is loaded. */
  spatial?: SpatialModel;

  /** Resolved design tokens, derived from the active skin's seeds (§15). */
  tokens: DesignTokens;

  /** Derived presentation: is_on, facet, effective name/area, level.
   *  The only implementation — see §1.1. */
  present: PresentationApi;

  /** Editing vs viewing. Advisory to the widget; enforced by the host —
   *  `action` refuses to dispatch in edit mode (§14.2). */
  mode: "view" | "edit";

  locale: string;
  units: { temperature: "C" | "F"; length: "cm" | "in"; ... };
}
```

**Why scoped subscriptions.** Home Assistant sets a whole `hass` object on every
card on every state change, which causes all cards to re-render on unrelated
updates. Declaring bindings up front and fanning out per-device avoids this and
matters most on the low-powered tablets.

**Why the narrow surface.** If widgets only ever talk through `HcContext`,
isolating one later — the code element's frame (§8.1), or a per-extension
sandbox for something that misbehaves — is a transport swap rather than an
ecosystem-breaking rewrite. Design as if sandboxed even while running in-realm:
data in, data out, no host internals handed across. That is Rule 3, and it costs
nothing while everything is in one realm.

### 4.3 Extension manifest

Every extension ships `hc-extension.json`:

```json
{
  "id": "com.example.thermostat-dial",
  "name": "Thermostat Dial",
  "version": "1.2.0",
  "hcApiVersion": "1",
  "entry": "./dial.js",
  "author": "example",
  "homepage": "https://github.com/example/hc-thermostat-dial",
  "provides": {
    "widgets": [
      {
        "tag": "hc-thermostat-dial",
        "name": "Thermostat Dial",
        "description": "Circular dial with setpoint drag",
        "icon": "icons/dial.svg",
        "configSchema": "./schema.json",
        "categories": ["climate"]
      }
    ],
    "floorplanLayers": [],
    "templates": []
  },
  "assets": ["icons/", "anim/dial.riv"]
}
```

`provides` is the extension point map. New extension *kinds* are added here
rather than by inventing a parallel manifest format.

**The widget entries above are illustrative and predate §4.6.** A
`provides.widgets[]` entry *is* a `hc_types::widget_descriptor::WidgetDescriptor`
— `configSchema` and `tag` are the two fields that change. Read §4.6 before
implementing this block.

`hcApiVersion` is the compatibility gate. The host refuses to load an extension
declaring an API version it does not implement, and says so in the UI rather
than failing silently.

### 4.4 Config schema → generated property panel

Each widget declares its config, and the designer renders the property panel
from that declaration — extension authors get an editor for free.

**The schema-versus-descriptor question is already settled server-side** (§5.11)
and this should follow it rather than re-open it. Core publishes both for plugin
config: `config_schema` (JSON Schema, for validation) *and* `config_descriptor`
(semantic kinds, `help` prose, `visible_when` conditionals, for rendering) —
because a JSON Schema cannot express units, conditionals, live data sources or
prose. A widget's config wants the same pair, and `WidgetField` (§4.6) is
already the descriptor half.

Custom vocabulary for binding-aware fields:

```json
{
  "type": "object",
  "required": ["device_id"],
  "properties": {
    "device_id":  { "type": "string", "x-hc-picker": "device",
                    "x-hc-device-type": ["thermostat"] },
    "device_ids": { "type": "array",  "x-hc-picker": "device-or-query" },
    "icon":    { "type": "string", "x-hc-picker": "asset",
                 "x-hc-asset-kind": "icon" },
    "room":    { "type": "string", "x-hc-picker": "room" },
    "label":   { "type": "string", "x-hc-expr": true },
    "tap":     { "$ref": "hc://schema/action" },
    "min":     { "type": "number", "default": 10 },
    "showHumidity": { "type": "boolean", "default": true }
  }
}
```

- `x-hc-expr: true` marks a field that accepts an expression (§6).
- `x-hc-picker: "device-or-query"` marks a field that accepts a literal list or
  a query (§5, P2).
- `hc://schema/action` is the shared action schema (§5, P9) — every widget with
  a tap target reuses it rather than inventing its own.

**Every widget option must be editable in the GUI.** No widget ships that
requires hand-editing JSON. This is Mushroom's rule and it is the difference
between a usable ecosystem and a YAML ecosystem.

### 4.5 Registration

```ts
import { HcWidgetBase, registerWidget } from "@homecore/widget-sdk";

class ThermostatDial extends HcWidgetBase { /* ... */ }

customElements.define("hc-thermostat-dial", ThermostatDial);
registerWidget({ tag: "hc-thermostat-dial", extensionId: "com.example.thermostat-dial" });
```

`@homecore/widget-sdk` is published from this repo and versioned in lockstep with
`hcApiVersion`. It provides `HcWidgetBase` (a Lit element with `ctx` wiring and
subscription teardown handled), `HcLayoutShell` (§7.2),
`HcFloorplanLayerBase`, TypeScript types, and test harness stubs.


### 4.6 One contribution path, two kinds of widget

Core already owns a widget contribution path: `hc_types::widget_descriptor`. A
plugin declares a `WidgetDescriptor` — `widget_id`, `title`, `icon`,
`config_schema` (as `WidgetField`, the vocabulary core already validates
configs against), `bindings`, and a portable `render` tree, a `code`
attachment, or both.

**Extensions use that path.** `hc-extension.json` does not introduce a second
widget declaration format; `provides.widgets[]` entries are descriptors. One
manifest field, one validator, one thing a client must know how to read.
Inventing a parallel descriptor here would be the §3 Rule 1 mistake committed
one level up — a privileged path for extensions, alongside the one plugins use.

Three consequences, stated so they are not discovered in Phase 3:

- **`config_schema` is `WidgetField`, not JSON Schema.** §4.4's `x-hc-*`
  vocabulary *extends* `WidgetField`; it does not replace it. Core validates
  widget config against `dashboard_vocabulary` regardless of what the client
  believes, so a second schema language means two answers to "is this config
  legal," and the client's answer is the one that does not count.
- **`bindings` are the subscription set.** They are declared, and `ctx.subscribe`
  (§4.2) resolves from them rather than from a separately hand-written list.
  That is what makes the scoped-subscription promise structural instead of
  advisory — a widget cannot read what it did not declare, in exactly the same
  sense §6.4 means it.
- **`CodeAttachment` describes a sandboxed document, not an ESM module.**
  `entry` is *"the document the sandbox loads"*; `grant` names the devices it
  may reach — and that grant is these same `bindings`, not a second list. It is
  the right shape for a **code element** (§8.1) and the wrong one for an
  installed extension, which loads as a module in the main realm. The descriptor
  needs to say which, which is one more field alongside the `graphical` kind.

**The two kinds.**

| Kind | `render` | Who can draw it |
|---|---|---|
| **instrument** | required | any client; a browser may override with `code` |
| **graphical** | absent | a browser only |

Core's validator rejects `code` without `render` today, and its reason is a
good one: *"a code widget must still say what a client without a browser
draws."* That reason holds for a gauge. It does not hold for a floorplan, a
Rive artboard, or a light-spill field — a render tree for those is not a
fallback, it is a false claim about what the widget is.

So the rule keeps its exception instead of losing its force. A **graphical**
widget says so, and in exchange declares the fallback §10.3 already requires —
an icon plus the device's state as text — so a client that cannot draw it shows
something true rather than a blank rectangle. The widget decides, where the
cost of the decision is visible; the validator stops guessing from the outside.

**This is a core change**, and a small one: one field on the descriptor, one
branch in `validate`, and the existing error text stays exactly as it is for
instruments.

**Who the portable render is actually for.** Today, nobody. hc-tui does not
read dashboard documents — its `draw_dashboard` is a hand-written device
browser with fixed tabs — and the only other consumer is a browser client. The
`instrument` kind is a bet on a future non-browser client, not a live
requirement. It is worth keeping, because it costs a gauge nothing and it is
unrecoverable later. It is not worth letting it shape anything graphical, which
is most of what makes this UI worth building.

---

## 5. Host primitives

### 5.1 Why this section exists

Survey the most-installed Home Assistant custom cards and a pattern appears:
**a large share of them exist to work around a missing host primitive, not to
add a new visualization.**

| Popular card | Primitive it substitutes for |
|---|---|
| button-card, config-template-card | Expressions in config |
| card-mod | Styling hooks on cards |
| auto-entities | Dynamic entity queries |
| decluttering-card, streamline-card | Reusable parameterized templates |
| stack-in-card, vertical-stack-in-card | Nesting without chrome |
| swipe-card | Swipeable container |
| layout-card | A real layout engine |
| browser_mod (popups) | Dialog / sheet primitive |
| Every chart card's own history fetcher | History & statistics API |

That ecosystem is the result of shipping cards first and adding platform
capability later. The workarounds then calcify: card-mod exists because HA cards
are shadow-DOM encapsulated with no styling hooks, and now thousands of
dashboards depend on injecting CSS into other people's internals.

**Sequencing constraint:** the primitives below — the ten here plus
presentation (§1.1) — are built in Phase 2,
before the widget family (Phase 4) and — the part that is unrecoverable — before
the SDK is published in Phase 3. A primitive bolted on after third parties are
building cannot be adopted retroactively by widgets already in the wild; it just
becomes a second way to do the same thing. The throwaway widgets in Phase 0 are
not an exception to this: they are how the primitives get designed against
something real, and Phase 2 does not exit until they are rebuilt on top of it
(§18.1).

Every primitive is reachable from `HcContext` (§4.2). If a widget can only get a
capability by reaching around the host, the primitive is missing or wrong.

### 5.2 P1 — Expressions in config

Any config value may be an expression evaluated against a read-only binding
scope. Full treatment in §6.

*Obviates:* button-card's `[[[ ]]]`, config-template-card.

### 5.3 P2 — Device queries

Any field that accepts a device list also accepts a **query**. The host resolves
it to a live set that updates as devices appear, disappear, or change state.

```ts
export interface DeviceQuery {
  deviceType?: string[];          // ["light", "switch"] — device_type, or ui_hint
  area?: string[];                // homeCore areas — also floorplan rooms
  labels?: string[];
  namePattern?: string;           // regex
  attribute?: { key: string; op: Op; value: unknown }[];
  on?: boolean;                   // derived on-ness (§1.1), not a state string
  available?: boolean;
  not?: DeviceQuery;
  sort?: { by: "name" | "state" | "lastChanged" | string; dir: "asc" | "desc" };
  limit?: number;
}
```

Evaluated server-side at `/api/query` for the initial set, then maintained
client-side from the device store so it stays live without polling.

Because floorplan rooms carry area bindings (§12.1), `area: ["kitchen"]` is the
same query language on a dashboard and on the plan. "All lights in this room"
becomes a first-class expression rather than a hand-maintained list.

*Obviates:* auto-entities.

### 5.4 P3 — Widget templates

**Three different things are called "template" in this system.** Naming them
apart here, because conflating them is the easy mistake:

| Name | What it is | Semantics | Status |
|---|---|---|---|
| **Dashboard template** | a whole page you start from | **copy** — the two have nothing to do with each other afterwards | ships: `DashboardDefinition.template` |
| **Widget template** | a widget subtree with parameters | **copy** — corrected 2026-09-11 | this section |
| **Rule template** | a rule with parameters (§21.4) | open | not built |

**All of them are copies, and the paragraph that used to argue otherwise was
wrong.** It said reference was right for a widget template because "one edit
landing everywhere is the whole point". It is not: *"template are starting
points"*, said three separate times against three separate proposals, and
`hc-web-flutter`'s own plan records the same call —

> The thing this plan got most wrong was the shape of the answer. Four of the
> six phases were drawn as propagation — edit the definition, the copies follow
> — and none of them shipped that way. A template, a saved look and a repeat are
> all *applied and then yours*.
> — "From Cards to Frames", 3 September 2026

Copy deletes everything expensive with it: no instances, no overrides, no
re-sync, and nobody has to decide who wins when a definition changes under a
page made from it.

A **widget template** is a widget subtree with named parameters, stored
server-side and instantiated many times.

```json
{
  "id": "room-tile",
  "params": [
    { "name": "room",  "type": "room" },
    { "name": "icon",  "type": "asset", "default": "icons/room.svg" }
  ],
  "widget": {
    "type": "hc-device",
    "config": {
      "device_ids": { "$query": { "area": ["{{ params.room }}"], "deviceType": ["light"] } },
      "icon": "{{ params.icon }}",
      "label": { "$expr": "area_name(params.room)" }
    }
  }
}
```

Instantiation is by **copy**: placing one substitutes the parameters and stamps
out an ordinary widget, independent from that moment. Nothing in the document
records where it came from, which is what makes it an ordinary widget rather
than a thing with a link to manage. Combined with P2, a whole dashboard still
generates from a room list — the leverage is in the stamping, not in the link.

This client shipped the by-reference model on 2026-09-11 and reversed it the
same day. The reversal is recorded rather than erased because the reasoning is
worth keeping: the link is not more powerful, it is more expensive, and it asks
a question — who wins — that nobody wanted to answer.

Widget templates are also an extension kind (`provides.templates`), so an
extension can ship a curated arrangement, not just widgets. An extension that
wants to ship a whole page ships a **dashboard template** instead — a document,
copied on use, and already a thing core stores.

*Obviates:* decluttering-card, streamline-card.

### 5.5 P4 — Composition without chrome

Widgets nest. A widget declares slots; children are widgets like any other. The
container decides whether to render its own card chrome, and a nested widget
renders **without** a card background, border, or padding unless it is the
outermost one.

```ts
interface HcWidgetMeta {
  slots?: { name: string; accepts?: string[]; min?: number; max?: number }[];
  chrome?: "auto" | "always" | "never";
}
```

Layouts (stack, grid, swipe, tabs, accordion) are container widgets built on
this — not special-cased card types, and not first-party-only. An extension
ships a container the same way it ships anything else (§3, Rule 1).

**A declarative container is worth more than a coded one where it fits.** A
container whose behaviour is data — slot names, direction, gaps, per-breakpoint
placement — is expressible as a portable `RenderElement` (§4.6), so hc-tui can
draw a stack. A coded container is web-only by construction. Every container in
§7.3 is expressible as data, so ship them that way and let code containers be
the exception that earns itself.

**A sandboxed widget cannot be a container** — a frame cannot mount another
frame's element — so the per-extension sandbox flag (§8.1) and slots are
mutually exclusive. Worth knowing when flagging a misbehaving extension, not a
constraint on the design.

*Obviates:* stack-in-card, vertical-stack-in-card, swipe-card, and the whole
"in-card" family that exists purely to suppress double borders.

### 5.6 P5 — Overlay layer

The host owns a single overlay stack: modal dialogs, bottom sheets, popovers,
and toasts. Widgets request an overlay; they never create one in the document.

```ts
export interface OverlayApi {
  sheet(content: OverlayContent, opts?: SheetOpts): OverlayHandle;
  dialog(content: OverlayContent, opts?: DialogOpts): OverlayHandle;
  popover(content: OverlayContent, anchor: Element, opts?): OverlayHandle;
  toast(msg: string, opts?: ToastOpts): void;
  confirm(req: ConfirmRequest): Promise<boolean>;
}
```

`OverlayContent` may be a widget spec, so "tap opens a room control sheet" is a
config value, not code. Host ownership means focus trapping, scroll locking,
escape handling, and back-button behaviour are correct once instead of
per-widget — which is exactly what HA users install browser_mod to fix.

The floorplan info card and the room control sheet (§11.5) are overlays.

*Obviates:* browser_mod popups, per-card dialog implementations.

### 5.7 P6 — Layout engine

**The semantics are not ours to invent.** Core stores `flow`, `frame`, `groups`
and `rect` and deliberately never acts on them — it is a document store — but
what a stored layout *means* is pinned in three places, in increasing order of
authority:

| | |
|---|---|
| `core/docs/dashboard-layout.md` | the rules in prose |
| `hc_types::dashboard_layout` | the reference implementation |
| `core/docs/dashboard-layout-fixtures.json` | the cases every client must reproduce |

P6 is therefore *implement the reference and pass the fixtures*, not *design an
engine*. This is not a formality: `normalize` runs before every save and core
rejects the whole dashboard on the first illegal placement, so a client that
normalises differently does not draw a page differently — **it loses the user's
edit, including the parts that were fine.**

What the host owns:

- `Engine::normalize`, `is_legal` and `rows`, reproduced exactly, checked
  against the fixtures in CI.
- **Breakpoints are `mobile | tablet | desktop | tv`** — core's
  `DashboardBreakpoint`, four of them, not three. Each layout carries its own
  `columns`, `row_height` and `gap`.
- **`flow` is a document field, not a host preference.** `packed` (gaps close,
  the default and what every existing dashboard means) or `free` (gaps are
  content). Only a client with an authoring surface ever writes `free`; a
  derived layout is always `packed`.
- `derived_from` says which breakpoint a layout was computed from, or is absent
  when a person arranged it. An editor recomputes the derived ones and leaves
  the authored ones alone.
- CSS Grid is an *implementation* of the above, not a substitute for it. Where
  the grid's natural behaviour and the fixtures disagree, the fixtures win.

*Obviates:* layout-card.

### 5.8 P7 — Styling contract

The reason card-mod exists is that HA cards are shadow-DOM encapsulated with no
styling hooks, forcing users to inject CSS into internals. Design that away:

- Every widget exposes **documented CSS custom properties** for color, spacing,
  radius, and typography, defaulting to token values (§15).
- Every meaningful internal element carries a **`part` attribute**, so
  `hc-device::part(icon)` is a supported, versioned styling surface.
- The SDK ships a lint rule: a widget with unnamed internal structure and no
  custom properties fails review.
- Theme changes repaint everything, including third-party widgets and floorplan
  layers, because both read from tokens.

Treat `part` names and custom property names as **part of the ABI**. Renaming one
is a breaking change.

*Obviates:* card-mod.

### 5.9 P8 — History & statistics queries

Every chart card in HA ships its own history fetcher. Provide one.

```ts
export interface HistoryRequest {
  deviceIds: string[];
  start: number; end: number;
  resolution?: "raw" | "5m" | "1h" | "1d";
  aggregate?: ("mean" | "min" | "max" | "sum" | "last")[];
  maxPoints?: number;             // server-side downsampling (LTTB)
}
```

Downsampling happens server-side against the SQLite history DB. A chart widget
asks for 400 points over 7 days and gets 400 points, not 200,000 rows — which is
the difference between usable and unusable.

This also backs the floorplan time scrubber (§11.5).

*Obviates:* each chart card's bespoke history layer.

### 5.10 P9 — Action model

One shared schema for "what happens when the user interacts," reused by every
widget and by floorplan markers.

```ts
export interface ActionConfig {
  type: "none" | "toggle" | "service" | "navigate" | "url" | "overlay" | "details";
  service?: string;
  payload?: unknown;              // may contain expressions
  target?: string;                // dashboard id, url, overlay spec
  confirm?: { text?: string } | false;
}

interface WidgetActions {
  tap?: ActionConfig;
  hold?: ActionConfig;            // default: details
  doubleTap?: ActionConfig;
}
```

The host — not the widget — dispatches actions, which means the **safety policy
(§11.3) is enforced centrally**: locks and alarms never actuate from a plain tap
regardless of what a widget's config says, and destructive services always
confirm. A third-party widget cannot opt out of this by mishandling its own
events.

`hold` defaults to `details` everywhere, so there is always a non-actuating way
to inspect a device.

**Where the action list comes from.** For a device action, `ActionConfig` names
an `id` from that device's own `actions[]` (§5.11) and supplies its declared
parameters — not a hand-written service string. The designer's action picker is
then a list of what the device says it can do, and `requires_role` is checked
before the control is offered rather than after it is pressed.

*Obviates:* per-card action handling, and the class of bugs where one card's
long-press works differently from another's.

### 5.11 P10 — Capability schemas

**These already exist, and the plan had missed all four.** Core publishes what a
plugin can do, what its config means, what a device accepts, and what a device
can be told — declared by the plugin, served over the API, and consumed
identically by every client.

| Surface | Where | What it answers |
|---|---|---|
| `DeviceSchema` | `GET /devices/{id}/schema` | what this *device* accepts |
| `PluginCapabilities` | `GET /plugins` → `capabilities` | what this *plugin* can be asked to do |
| `config_descriptor` | `GET /plugins` → `config_descriptor` | how to *render* the plugin's settings |
| `config_schema` | `GET /plugins` → `config_schema` | how to *validate* them (JSON Schema) |

**Device: attributes and actions, complementary not alternative.** A writable
attribute is a state you set; an action is a thing you do.

```
attributes{}   kind, display_name, writable, min/max, options
actions[]      id, label, description, category, icon, requires_role, sentence,
               params[] { name, kind, required, default, options, options_from }
```

A Hue light has four writable attributes — `on`, `brightness_pct`, `color_temp`,
`color_xy` — and no actions. A Lutron keypad has **zero** writable attributes
and two actions, `press_button` and `set_led`, because pressing a button is an
event and not a state that can be assigned. `AttributeKind` is closed: `bool`,
`integer`, `float`, `string`, `enum`, `color_xy`, `color_rgb`, `color_temp`,
`json` — a control per kind, decided once.

`options_from` binds a parameter's options to a live attribute of the same
device:

```json
{ "name": "button", "kind": "int", "options_from":
  { "attribute": { "attribute": "available_buttons",
                   "label_key": "name", "value_key": "number" } } }
```

So a keypad's button picker is populated from what the bridge currently reports,
carrying the bridge's own engraved labels, and nothing in the client knows what
a Lutron keypad is.

**Plugin: operations with a declared shape.** `refresh_devices` on the Hue
plugin declares `requires_role`, `concurrency: "single"`, `cancelable`,
`timeout_ms`, `stream: true`, an `item_key` naming what it iterates, and a typed
`result` (`{ok, failed, bridges}`). A UI can therefore show progress, disable a
second run, offer cancel, and render the outcome — without knowing what Hue is.

**Config: a descriptor *and* a schema, deliberately both.** `config_descriptor`
carries `toggle`, `duration`, `enum`, `list`, `table`, `note`, `host`, `port`,
`secret` — semantic kinds with `help` prose and `visible_when` conditionals.
`config_schema` is the JSON Schema for the same settings. Core ships both
because, in `config_descriptor`'s own words, a JSON Schema cannot express units,
conditionals, live data sources or prose. **That is the answer to §4.4's
question, already made and already shipping:** schema validates, descriptor
renders, and they are not the same artifact.

**What this changes.**

- **The control row is generated, not written** (§7.2). `bool` → toggle,
  `integer` + `min`/`max` → slider, `enum` → select, `color_temp` → temperature
  picker. A widget hardcoding "lights have a brightness slider" is re-deriving,
  less well, something the plugin already said.
- **P9's `ActionConfig` should reference these, not duplicate them** (§5.10). A
  hand-authored service string is a guess about a device; `actions[]` is the
  device's own answer, with typed parameters and a `requires_role` the host can
  check *before* rendering the control.
- **`sentence`** — *"press button {button} on {device}"* — is a natural-language
  template for the same action, which is how hc-mcp drives a device nobody
  taught it about. Another reason to keep this surface declarative.
- **Absence is normal, and stays designed for.** Every device in the reference
  house publishes a schema today, but a plugin that has not restarted since a
  release publishes none, and the answer is the same as it always was:
  attributes displayed, no controls offered, no error shown. An *empty*
  attribute set is a different thing and a deliberate one — a pulsed CCO says
  `{attributes: {}, actions: [activate]}` because the Integration Guide forbids
  querying a momentary output.
- **The two things the schema could not say, it says now** (homeCore#29,
  closed). `DeviceSchema.primary` is an ordered list of the readings a device is
  *for*, so a lock leads with `locked` rather than with its battery; 170 of 184
  devices declare it, the exceptions being activate-only scenes with no readings
  to rank. `category` is set on 296 attributes, against zero when this was
  written. The measurable effect: this client's fallback list of boring
  attribute names — the stopgap this paragraph used to describe — now changes
  **zero** headlines, and survives only as a floor under the attributes a card
  *lists* (§5.11 in `SCHEMA_CONTRACT_2026-09.md`).

*Obviates:* per-widget knowledge of what each device type can do — which is the
thing that makes a widget family expensive to extend, and the reason §7.3 is as
short as it is.

---

## 6. Expression language

### 6.1 The decision

Config values may hold **pure expressions, written in JavaScript, evaluated in
the client**. There is no wasm evaluator and no second language.

| Option | Trade-off |
|---|---|
| No expressions | Simple; users hit walls and reimplement button-card as an extension anyway |
| Restricted DSL (CEL, JSONata, jsonlogic, jexl) | Analyzable — but a second language to learn, for a domain where nobody asked for one |
| Rhai → wasm | One syntax across rules and dashboards — bought with an interpreter in every client |
| **JavaScript** | **Already present, already known, zero bundle. `unsafe-eval` is the cost.** |

An earlier draft chose Rhai-to-wasm on the strength of *one syntax across the
whole system*. That argument is real but it was buying elegance, not capability,
and the price was hidden in a place §1.2 makes visible: it is one language **and
one engine**, and the engine is a per-client cost. hc-tui and hc-mcp cannot pay
it. Expression-capable labels would have become a web-only feature by accident
rather than by decision.

Three things settle it the other way:

- **This is a display concern, and display is client work.** Core says so:
  `dashboard_vocabulary` validates configs and *"does not know what a card looks
  like"*. A rule condition is a system-level statement about the house and
  belongs on the server; whether a label reads "Warm" or "21.5°" does not.
- **The audience already writes JavaScript.** The population most likely to
  reach for an expression is people arriving from Home Assistant's button-card,
  where `[[[ ]]]` is JS against entity state. They would be learning Rhai to do
  something they can already do.
- **The client is TypeScript.** A widget author writes JS in their widget and
  would have written Rhai in its config. That seam buys nothing.

**Rhai does not go away — it stays where it already is.** Rule conditions and
topic-map transforms are server-side, in `hc-scripting` and `hc-topic-map`,
validated and executed there. Nothing in this section changes them. What is
dropped is the plan to *also* ship that evaluator to the browser.

**Portability, stated so it is not lost.** Expressions are the escape hatch, not
the binding mechanism. The portable path is core's declarative `Binding`
(§4.6) — a name, a device, a key, and an optional range mapping — which every
client evaluates, hc-tui included. A widget that uses only bindings is portable;
a widget that uses expressions is web-only, and that is a property of the widget
its author chooses knowingly.

### 6.2 Purity constraint

Expressions **read state and return a value**. No side effects, no service
calls, no network, no DOM, no `window`. An expression that needs to *do*
something is an action (§5.10).

JavaScript cannot enforce this, and pretending otherwise would be worse than
saying it plainly: this is a **rule with a reason**, in the same category as
§19.4. The reason is that pure expressions are safe to evaluate speculatively —
which is what lets the designer preview a value while you type it, and lets a
value be recomputed whenever a dependency changes without wondering what else
happened.

Enforcement is by scope rather than by language (§6.4): an expression is
compiled with named parameters and given nothing else, so reaching `window` is
awkward and obvious rather than natural. Not a boundary — extensions run
in-realm (§8.1) and an extension can already do anything — just the absence of
an invitation.

### 6.3 Syntax and placement

Two forms, both unambiguous in JSON and both schema-checkable:

```json
{
  "label":     "{{ device.name }}",
  "icon":      { "$expr": "isOn(device) ? 'lamp-on' : 'lamp'" },
  "device_ids": { "$query": { "area": ["kitchen"], "deviceType": ["light"] } }
}
```

- `"{{ … }}"` — interpolation shorthand for simple reads inside a string.
- `{ "$expr": "…" }` — an expression, any return type. The body is a JS
  *expression*, not a statement list: no `return`, which also means no early
  exit and no accidental side-effect block.
- `{ "$query": { … } }` — device query (§5.3), not an expression.

A field accepts expressions only if its schema declares `x-hc-expr: true`. The
designer shows an "ƒx" toggle on those fields; everything else stays a plain
value. This keeps the property panel honest and keeps expressions out of places
they would surprise.

### 6.4 Evaluation scope

Read-only, explicitly enumerated, and passed as **named parameters** — so this
list is the whole scope by construction rather than by promise:

```
device          the primary bound device (attributes, available, last_seen)
devices[id]     any device the widget declared in its bindings
params          template parameters (§5.4)
vars            widget-local variables defined in config
tokens          resolved design tokens
user            locale, units, theme — not identity
now             evaluation timestamp
```

Plus the presentation helpers (§1.1) — `isOn`, `effectiveName`, `effectiveArea`,
`levelOf`, `facetOf` — because an expression that had to re-derive on-ness would
be re-deriving it *wrongly*, which is the whole reason that primitive exists.

A widget cannot reach a device it did not declare: expressions do not bypass the
subscription model, because an undeclared device is simply not in `devices`.

### 6.5 Validation

A malformed expression is rejected **at save time in the designer**, not
discovered at render time on a wall display. Compile it with `new Function` when
the field loses focus; a `SyntaxError` is the error message, with the offset.

There is no server-side parity to maintain, and that is a simplification rather
than a loss. Core validates *config*, not presentation — a display expression is
not something it has an opinion about, and asking it to acquire one would be the
category error §1.2 warns about pointed the other way.

### 6.6 What to get right

- **Compile once, cache by source.** `new Function` per render is the obvious
  performance mistake. Compile on config change, keep the function, discard it
  when the config does.
- **Re-evaluate on dependency change, not on every state push.** Which devices
  an expression reads is known from the widget's declared bindings, so a push
  that touches none of them recomputes nothing.
- **`unsafe-eval` in the CSP is the accepted cost**, and it should be stated
  rather than discovered. It was the argument against JS in the earlier draft;
  it lost most of its force when extensions became in-realm (§8.1), since an
  installed extension can already run anything an expression could. The code
  element's frame keeps its own strict CSP and does **not** get this.
- **An expression that throws renders a fallback, never a blank card.** Show the
  literal, or the device's name, and put the error in the inspector — the same
  rule §10.3 applies to a Rive file that fails to load.

---

## 7. Widget vocabulary

### 7.1 The two-tier split

Mushroom's stated mission is easy-to-use components with an editor for every
option, icon and color pickers, zero dependencies, Material colors, light/dark
support and i18n — and its README explicitly says deep customization is *not*
its goal, pointing users to button-card for that.

Adopt that split deliberately:

- **Tier 1 — the curated family.** Opinionated, GUI-editable, covers ~90% of
  dashboards. No expressions needed to use it.
- **Tier 2 — the escape hatch.** One highly configurable widget (`hc-button`)
  built directly on P1/P7/P9, for users who want button-card's power.

Trying to make one widget serve both produces a config surface nobody can
navigate. Shipping only Tier 1 produces an ecosystem of workaround extensions.

### 7.2 The shared layout shell

Every Tier 1 widget is a thin specialization of one shell. Build the shell in the
SDK; the type-specific widgets are then small, and `hc-device` is the shell with
nothing added — which is what makes an unknown `device_type` render as a plain
card rather than as an error.

```
┌─────────────────────────────────────────┐
│ [icon]  primary text            [badge] │
│         secondary text                  │
│ ─────────────────────────────────────── │
│ [ control row — domain specific       ] │
└─────────────────────────────────────────┘
```

Shell responsibilities: icon slot with state-driven color, primary/secondary
text (both expression-capable), optional badge, optional collapsible control
row, and the shared action model (§5.10).

**The control row builds itself from the device schema (§5.11)** — one control
per writable attribute by `kind`, one button per declared action. A type-specific
widget overrides that where it can do better (a light wants a colour wheel, not
an `x`/`y` pair), but it starts from what the plugin declared rather than from
what the widget assumes, and a device with no schema simply gets no controls. Layout options: horizontal/vertical,
icon-only, fill-container, hide-name, hide-state.

Icon color mapping comes from tokens (§15), not hardcoded — so a theme change
recolors every widget including third-party ones.

### 7.3 Tier 1 family

Ordered by what a real deployment actually contains (§1.1), not by Home
Assistant's domain list. The counts are one house and will not generalise
exactly, but the *shape* will: scenes and switches dominate, sensors are
numerous and undifferentiated, and a large tail is vendor hardware that no
domain vocabulary has a name for.

| Widget | Covers | Control row |
|---|---|---|
| `hc-scene` | `scene` ×58 | activate; **two kinds** — see below |
| `hc-switch` | `switch` ×28 | toggle |
| `hc-light` | `light` ×16 | brightness (§1.1 — a percentage, whichever way the plugin publishes it), color temp, color |
| `hc-sensor` | `temperature_sensor` ×14, `water_sensor` ×7, `rain_sensor`, `lightning_sensor`, `vibration_sensor`, `weather_station` | reading + unit + battery; no controls |
| `hc-contact` | `contact_sensor` ×8 | open/closed, battery; `ui_hint` picks the door/window/garage face |
| `hc-media` | `media_player` ×7 | transport, volume, source select |
| `hc-presence` | `occupancy_sensor` ×5, `motion_sensor` | occupied/clear, last-changed |
| `hc-fan` | `fan` ×4 | percentage slider, named speeds |
| `hc-timer` | `timer` ×4 | remaining, start / pause / reset |
| `hc-keypad` | `keypad` ×3, `pico_remote` ×8, `vcrx` | one control per entry in `available_buttons`, **pressable** where the device declares `press_button` (§5.11); LED state from `led_N`; last press from `last_button_name` |
| `hc-lock` | `lock` ×2 | lock / unlock, confirm-gated (§11.3) |
| `hc-device` | anything, including the 3 with no `device_type` at all | generic: attributes and an optional toggle |

Presentation widgets, bound to a query or an expression rather than to one
device type:

| Widget | Control row |
|---|---|
| `hc-list` | device list; takes a query (§5.3) |
| `hc-chips` | horizontal row of compact status pills |
| `hc-title` | section heading, expression-capable |
| `hc-chart` | time series over the history API (§5.9) |
| `hc-gauge` | radial/linear gauge with token-driven severity bands |
| `hc-markdown` | text with expression interpolation |
| `hc-camera` | still or live stream |
| `hc-rive` | generic Rive widget (§10.2) |

Containers (built on P4): `hc-stack`, `hc-grid`, `hc-swipe`, `hc-tabs`,
`hc-accordion`.

**Scenes are two things wearing one `device_type`.** Activating a scene is a
device *action*, not an attribute write — a scene is a thing you do, and it does
not meaningfully turn off. But how one reports itself afterwards differs, and a
client has to handle both:

- **Stateful.** Lutron marks some scenes on, so a client can tell when they are
  off and show which is currently applied. Hue publishes `active` for the same
  purpose. 45 of the 58 scenes in the reference house declare one of the two,
  and every one of them publishes what it declared. Ask `isOn`.
- **Momentary.** No feedback at all — the other 13. Offer to activate it and
  show **no state**, because there is none. Drawing these as "Off" is the
  failure mode: it says a thing about the house that nobody knows.

The distinction is `present.sceneKind()`, and it is **declared** now rather than
inferred: all 58 scenes declare `activate` as a `DeviceAction`, and the presence
or absence of `on`/`active` in the schema is the answer (homeCore#28). Six carry
`led_component` as the explanation, so a card can say *why* a scene has no
status instead of leaving a reader to guess. Reading the published shape stays
only as a fallback for an older core.

**Buttons are a worked example of why P10 matters.** `available_buttons` arrives
in two shapes from two plugins — Caséta sends `[2, 3, 4, 5, 6]`, Lutron sends
`[{name, number}, …]` with the engraving on the wall — and a label resolves as
`button_names[n]` (the user's rename) ?? the plugin's `name` ?? `"Button n"`. A
keypad's buttons are *pressable* because that device declares a `press_button`
action, and a Pico's are not because it declares none: it is a transmitter, and
core says so rather than the widget assuming it. Same widget, and the difference
is data.

**`hc-device` is the one that must be good**, and the domain widgets are
refinements of it rather than the other way round. Three devices in the
reference house declare no `device_type`, a fifth of the rest declare something
no widget will ever be written for (`bridge`, `gateway`, `zwave`), and the next
plugin will invent a type nobody has seen. A vocabulary that renders those as an
error state is a vocabulary that breaks every time the house grows.

**Not shipping, and why:** `hc-cover`, `hc-thermostat` — core knows both types
and this house has neither, so they are written when there is a device to test
them against. `hc-alarm`, `hc-vacuum`, `hc-humidifier`, `hc-person`,
`hc-update`, `hc-select`, `hc-number` — Home Assistant domains with no homeCore
`device_type` behind them at all. A widget precedes its `device_type` only when
a plugin is shipping one; otherwise it is a widget for devices that cannot
exist.

### 7.4 Tier 2 — `hc-button`

The button-card equivalent, and the proof that the primitives are sufficient. It
adds no host capability of its own; it is P1 + P7 + P9 exposed through a wide
config surface:

- Every visual field expression-capable (`x-hc-expr`)
- State-matching style blocks (`when state is X, apply these tokens`)
- Named regions styleable through the documented `part` names, no CSS injection
- Custom fields composed from child widgets (P4), not raw HTML
- Reusable via templates (P3) rather than a bespoke inheritance mechanism

**If `hc-button` requires a capability that isn't already a primitive, that is a
signal the primitive set is incomplete — fix the primitive, don't special-case
the widget.** This is the acceptance test for Phase 2.

### 7.5 Chart widgets

`hc-chart` covers line, bar, area, and scatter over `ctx.history`. Donut, radial,
and multi-axis comparison charts — the ApexCharts territory — are a good first
*third-party* extension, deliberately left out of Tier 1 to prove the SDK is
sufficient for someone outside the core team.

### 7.6 Deliberately not shipped first-party

Left to extensions, because they are genuinely new capability rather than
platform gaps: camera/NVR event browsing (Frigate-class), energy flow and Sankey
diagrams, calendar views, scheduler UIs, vacuum map control. Each needs a
primitive from §5 but nothing beyond it — if one of them can't be built on the
SDK, that is a finding, not an excuse to special-case it.

---

## 8. Loading and trust model

### 8.1 Trust — in-realm by default

**Settled: in-realm by default. Isolation is a tool, not a policy.**

An earlier revision made every widget sandboxed. That was wrong, and the reason
is worth recording so it does not get re-litigated:

- **Extension install is already a deliberate admin act.** Upload a `.tar.gz`,
  admin-only, never auto-fetched from a URL. The trust decision happens there.
- **homeCore plugins are native binaries.** `plugin_install.rs` unpacks them and
  `plugin_runtimes.rs` supervises them as processes with the broker, the devices
  and the filesystem. An admin who would install a hostile package has a far
  larger door already open, and hardening the browser layer while that one
  stands is defense pointed away from the risk.
- **Mandatory isolation is paid for by extension authors**, in a currency this
  project cannot afford: no shared Rive runtime, no spatial model, no
  extension-authored containers, everything async, the layout shell copied into
  every widget. A worse product for the exact person this rewrite exists to
  serve.
- **And it would not even be complete.** Floorplan layers and slot containers
  cannot be framed at all, so anyone wanting the session token ships a layer.
  A partial boundary at full price.

**Isolation is offered where it earns its place**, not imposed everywhere:

| Case | Mechanism | Why |
|---|---|---|
| Installed extension | **in-realm ESM** | the admin chose it; full capability |
| Floorplan layer | **in-realm ESM** | shares an SVG/canvas target; no other option |
| Code element — pasted, authored in-product | **sandboxed frame** | no install step and no act of trust; someone pasted it from a forum |
| A widget that misbehaves | **sandboxed, per-extension flag** | crash containment on a tablet that runs for months |

The last row is the argument for keeping the frame path alive that has nothing
to do with security: a runaway loop takes down the tab, and on a wall display
that is the whole dashboard. In a frame it takes down only itself. That is a
reason to *offer* isolation, not to mandate it — and Rule 3 is what keeps it
cheap to offer.

**The sandbox is real and specified**, as core's `CodeAttachment { entry, grant }`
— the document a frame loads and the devices it may reach. Its properties are
worth stating because they are what make the code element safe:

- `sandbox="allow-scripts"` **without** `allow-same-origin`, so the frame has an
  opaque origin. *The two must never be set together — that combination lets a
  frame remove its own sandbox attribute.*
- A CSP inside the document: `default-src 'none'`, inline script only, network
  opened per element and only when reaching the LAN is the point.
- A per-frame nonce on every message, so a stale frame cannot be mistaken for a
  live one.
- **The grant is the whole permission model.** Name a selection, get exactly
  those devices, act on exactly those. Name nothing and the element renders and
  can do nothing — the right default for code someone pasted.

**A descriptor therefore has to say which it is** (§4.6). `CodeAttachment`
describes a sandboxed document; an installed extension's widget is an ESM
module. That is one more field on the descriptor, alongside the `graphical`
kind, and it is a core change to make deliberately rather than a distinction to
leave implicit.

**Loading.** Native ESM. No Module Federation — it exists to share a bundler
runtime across builds you control, which is not this situation.

```ts
const manifest = await api.get(`/api/extensions/${id}/manifest`);
assertApiCompatible(manifest.hcApiVersion);
const mod = await import(
  /* @vite-ignore */ `/api/extensions/${id}/${manifest.entry}?v=${manifest.version}`
);
```

The `?v=` cache-buster keyed on manifest version means extension updates take
effect on reload without service-worker gymnastics.

### 8.2 What in-realm costs, stated plainly

An ESM module in the main realm has full DOM access and can read the session
token and everything the app can read. Home Assistant accepts this, and so do
we. The risk sits with the admin who installed the extension, which is where it
belongs — the alternative is a product that protects admins from their own
decisions at the cost of the ecosystem those decisions exist to build.

What follows from accepting it:

- **Minisign verification over the manifest**, before any public registry
  exists. Signing tells an admin the package is the one its author published;
  it is the cheap half of this and worth having early.
- **`HcContext` stays the only channel** (§19.4) as a rule rather than a
  boundary. It is not enforced, which is exactly why it is a stated constraint
  and why the SDK lint (§5.8) checks for reaching around it.
- **The per-extension sandbox flag** (§8.1) is the answer when an admin does
  want containment, or when a widget has proven it needs it.

Install flow is explicit and admin-only: upload a `.tar.gz`, host validates the
manifest, extracts to the extension store, restarts nothing. Never auto-fetch
from a URL.

---

## 9. Asset store

The capability Flutter's build-time `AssetManifest` made impossible.

```
/var/lib/homecore/assets/
  user/
    icons/garage.svg
    images/floorplan.png
    rive/fan.riv
    manuals/boiler.pdf
  ext/
    com.example.thermostat-dial/
      icons/dial.svg
      anim/dial.riv
```

- Served at `/api/assets/**` with content-hash cache headers.
- **A code element's frame must be able to fetch them too** (§8.1). That frame
  has an opaque origin and `default-src 'none'`, so the host admits the asset
  origin into its CSP for `img-src` and `font-src` and nothing else. An asset
  URL a frame cannot load renders as a broken image with no error anywhere.
- `ctx.asset("icons/dial.svg")` resolves within the calling extension's namespace.
- `ctx.asset("/user/icons/garage.svg")` reaches the shared user store.
- Users upload through the designer; no rebuild, no restart.
- `GET /api/assets/index?kind=` backs the asset picker in the property panel.

**SVG icon sprite.** Assemble user SVGs into a symbol sheet server-side and
reference via `<use href="/api/assets/sprite.svg#garage">`. Keeps the DOM light
when a floorplan has 200 icons.

**Attachments.** PDFs and documents are first-class assets — a floorplan marker
can carry an attached manual (§11.2).

**Limits.** Enforce per-file size caps and sanitize uploaded SVG (strip
`<script>`, `on*` handlers, external `href`) — an SVG is an executable document.

---

## 10. Rive integration

Rive is the answer to "highly visual and interactive widgets that end users can
add without writing code." A `.riv` file is a self-contained interactive
animation with a state machine and typed inputs. Mapping device state onto those
inputs turns an art asset into a live widget.

### 10.1 Why it fits homeCore specifically

- Home automation widgets are mostly *stateful visual objects* — a dial, a
  garage door, a fan, a lock, a valve. That is what Rive state machines model.
- Inputs are typed (boolean, number, trigger) and map cleanly onto device state
  and service calls.
- Rive events fire back into JS, so a tap on the dial can invoke an action.
- Authoring happens in Rive's editor by someone who is not a programmer. The
  handoff artifact is a single file dropped into the asset store.

### 10.2 The generic Rive widget — `hc-rive`

A **first-party generic widget** so that adding a new animated widget requires
**zero JavaScript**: a `.riv` file plus a config mapping.

```json
{
  "type": "hc-rive",
  "src": "/user/rive/garage.riv",
  "artboard": "Garage",
  "stateMachine": "State Machine 1",
  "inputs": [
    { "input": "isOpen",   "device_id": "garage_door",
      "map": { "type": "attribute", "attribute": "open" } },
    { "input": "position", "device_id": "garage_door",
      "map": { "type": "attribute", "attribute": "position",
               "scale": [0, 100, 0, 1] } }
  ],
  "textRuns": [
    { "run": "label", "device_id": "garage_door", "map": { "type": "name" } }
  ],
  "events": [
    { "event": "Tapped", "action": { "type": "toggle",
      "device_id": "garage_door", "confirm": false } }
  ]
}
```

Rive events dispatch through the shared action model (§5.10), so the safety
policy applies to them too — a Rive artboard cannot unlock a door on tap.

Input mappings may use expressions (§6) for anything the declarative `map` forms
don't cover.

**On the floorplan**, the same config is available as a marker renderer — a
device marker can be a Rive instance positioned at real-world coordinates
instead of a flat icon (§11.4).

### 10.3 Runtime notes

- Use **`@rive-app/canvas`**, not `@rive-app/webgl2`. Not a browser-support
  question — Chrome has WebGL2 — but a GPU and driver one, where the canvas
  renderer degrades gracefully on hardware WebGL2 does not.
- Bundle the runtime **once in the shell**, not per extension. Expose it through
  `ctx.rive` so extensions never bundle their own copy. Most extensions will not
  need it at all — §10.2's `hc-rive` takes a `.riv` plus a config, so an animated
  widget is an asset and a mapping rather than any code.
- **Lifecycle:** `rive.cleanup()` on `disconnectedCallback`. Pause instances
  scrolled out of view via `IntersectionObserver`; on the floorplan, pause
  instances outside the current viewport transform.
- **Sizing:** `Fit.Contain` + `Alignment.Center`, with
  `resizeDrawingSurfaceToCanvas()` on a `ResizeObserver`.
- **Input coercion:** device attributes are loosely typed; state machine inputs are
  not. Validate mappings against the artboard's declared inputs at `setConfig`
  time and surface a clear designer error.
- **Asset size:** cap `.riv` uploads. Warn above ~500 KB.
- **Fallback:** on load failure or missing artboard/state machine, render a
  static icon with the device's state as text. A wall dashboard must never show a
  blank rectangle.

### 10.4 Editing story

The Rive property panel reads artboards, state machines and input names **from
the file itself** and populates dropdowns. The user picks an input, a device,
and a mapping. No schema authoring required by the person who made the animation.

---

## 11. Floorplan surface — `hc-floorplan`

The flagship view. Benchmark for feature parity is
[Matysh/houseplan-card](https://github.com/Matysh/houseplan-card); the goal is
parity plus everything that real geometry unlocks.

### 11.1 The key asymmetry

houseplan-card starts from **a picture**: the user uploads an SVG/PNG plan, then
hand-traces each room by clicking grid points to close a polygon, and binds it to
an HA area. Everything downstream is built on traced polygons over a raster.

homeCore starts from **geometry**. The existing Sweet Home 3D importer yields
walls with thickness and height, named room polygons with computed area, doors
and windows as objects intersecting specific walls, furniture with
position/rotation/dimensions, and levels with real elevations — all in
centimeters, at true scale.

**Anti-goal, stated explicitly:** do not flatten SH3D to a background image plus
traced polygons. That discards the advantage and caps the product at parity. The
floorplan renders from the geometry model directly. A raster background is only a
*fallback importer* for users with no CAD source (§12.3).

### 11.2 Parity checklist

- [ ] Multiple **spaces** as tabs (floors, garage, yard), per-space zoom/pan state remembered
- [ ] Room → homeCore **area binding**; devices of that area auto-placed inside the outline
- [ ] **Device curation** — bridges, service records and duplicates filtered out by default, with a "show all devices" toggle. Without this a Zigbee network puts 40 junk markers on the plan.
- [ ] **Drag to reposition with no separate edit mode**; positions persisted server-side so the layout is identical on every browser and device
- [ ] **Reset to auto-layout**
- [ ] **Manual and virtual markers** — any device, group, or a point that is not a device at all (an inlet valve, a shutoff), with name, icon, model, link, description, and an **attached PDF manual**
- [ ] **Icon rules** — ordered name-pattern regexes → icon, with a live test field and one-click reset; falls back to `device_type` then `ui_hint`
- [ ] **Tap / long-press semantics** via the shared action model (§5.10, §11.3)
- [ ] Smooth vector zoom: wheel, buttons, two-finger pinch; crisp at any scale
- [ ] **Zero YAML.** Everything configured by pointing and clicking.
- [ ] Info card on marker tap, rendered as a host overlay (§5.6)

### 11.3 Interaction safety policy — non-negotiable

Adopted from houseplan-card because it is correct, and **enforced centrally in
the action primitive (§5.10)** so no widget or layer can opt out.

- Default tap on a marker opens its **info card**.
- A plan-wide "tap to toggle" setting may be enabled, but it **never** applies to
  locks, alarms, covers, or valves.
- Per-device toggle can be opted into individually — **except locks and alarms,
  which can never be toggled from the plan under any setting.**
- **Long press always opens the info card**, regardless of tap mode.
- Destructive or safety-relevant services require a confirm step.

### 11.4 Layer architecture

houseplan-card is a **closed card**: every new visualization requires a PR to the
maintainer. Building `hc-floorplan` as a monolith would rebuild exactly the
constraint this migration exists to escape.

`hc-floorplan` is a **host surface with its own extension point**. It owns the
viewport transform, hit-test dispatch, and the spatial model. Layers render in
world coordinates and get zoom/pan for free.

```ts
export interface HcFloorplanLayer {
  id: string;
  name: string;
  targetKind: "svg" | "canvas";
  /** Geometry the layer needs; host hides the layer if the model lacks it. */
  requires: ("rooms" | "walls" | "openings" | "furniture" | "scale")[];
  zBand: "floor" | "overlay" | "marker" | "annotation";

  init(ctx: HcContext, geom: SpatialModel, target: LayerTarget): void;
  update(states: DeviceState[]): void;
  viewportChanged?(vp: Viewport): void;
  hitTest?(pt: WorldPoint): LayerHit | null;
  configSchema?: JSONSchema;
  dispose(): void;
}
```

Layers declare a **z-order band** rather than absolute z-indices, so third-party
layers compose predictably.

**First-party layers, shipped as layers:**

| Layer | Band | What it does |
|---|---|---|
| `rooms` | floor | Room polygons, names, area labels, selection |
| `walls` | floor | Wall geometry with thickness |
| `openings` | floor | Doors/windows; animates swing/slide at the real opening |
| `markers` | marker | Device icons, drag, hit-test, Rive marker renderers |
| `light-spill` | overlay | Luminaire illumination, tinted by color/CCT, intensity by brightness |
| `climate` | overlay | Room choropleth: temperature, humidity, CO2, light level |
| `presence` | overlay | Occupancy shading and motion trails |
| `mesh` | annotation | Zigbee/Z-Wave route lines between located nodes, weighted by LQI |
| `coverage` | overlay | RSSI heatmap interpolated over true floor area |

**Third-party layers** ship in `provides.floorplanLayers`. An energy-flow,
Sonos-zone, or sprinkler-zone overlay requires no change to hc-web.

### 11.5 What geometry unlocks (beyond parity)

- **No tracing step.** Rooms arrive as named polygons; auto-suggest room→area
  binding by name match. Onboarding drops from ~an hour to ~90 seconds.
- **Anchored placement.** A marker attaches to a *wall segment*, *opening*, or
  *furniture piece*, not to absolute coordinates. Anchors survive re-import
  (§12.4).
- **Room-level data visualization.** Rooms are polygons — fill them. A
  temperature choropleth is legible in a way 40 numeric badges are not.
- **Light rendering.** Luminaire position + bounding walls + current
  color/CCT/brightness → actual light spill. The most visually striking
  capability, and nearly free once geometry exists.
- **Real openings.** Animate the actual swing at the real position and width.
- **True scale.** BLE/UWB presence trilateration, RSSI coverage heatmaps over
  real floor area, mesh topology between physically located nodes. No existing
  HA floorplan card has these.
- **Level stacking.** Exploded axonometric and stacked cross-floor views are
  rendering modes, not new data.
- **3D as a view toggle.** Walls have thickness and height; extrude in three.js
  from the same document. Don't build early; don't foreclose.
- **Time scrubbing.** Over the history API (§5.9) — replay lights coming on and
  motion propagating room to room.
- **Room-scoped control.** Tap a room → a control sheet (P5) with everything the
  area query (P2) returns. Select multiple rooms → apply a scene.

### 11.6 Rendering strategy

- **SVG for structure** — walls, rooms, openings, markers, annotations. Vector
  keeps zoom crisp, gives real hit-testing and accessibility, and themes from
  tokens via the styling contract (§5.8).
- **Canvas for fields** — light spill, heatmaps, coverage.
- **One shared viewport transform**, owned by the host. Layers never manage their
  own pan/zoom.
- **Level of detail.** Below a zoom threshold, drop area labels, cluster markers,
  skip furniture.

### 11.7 Performance profiles

- Render heatmaps at **reduced resolution into an offscreen canvas** and scale up.
- Recompute field layers on **state change, not per frame**.
- Gate expensive layers behind a **per-device performance profile** stored as a
  device setting, not a document edit: the wall tablet may get `rooms + markers`
  only, the desktop everything.
- Pause off-viewport Rive marker instances (§10.3).
- Budget: **profile 20 simultaneous Rive markers plus the light-spill layer**
  before committing to either. Both are plausible-looking features that can
  quietly cost a frame budget, which is the reason to measure rather than the
  device they run on.

---

## 12. Spatial model — `hc-spatial`

### 12.1 Keep the model independent of Sweet Home 3D

Do **not** couple the floorplan to the SH3D data model. Define `hc-spatial` as a
normalized, versioned geometry document. SH3D becomes one importer among several,
and the existing importer is reframed as `sh3d → hc-spatial` rather than as the
source of truth.

```
Level      id, name, elevation, floorThickness, height, index
Wall       id, levelId, start{x,y}, end{x,y}, thickness, height, heightAtEnd
Opening    id, wallId, kind: door|window, offsetAlongWall, width, height,
           sillHeight, swing{hinge, direction}
Room       id, levelId, name, polygon[{x,y}], areaM2, areaId?  ← homeCore area binding
Furniture  id, levelId, name, category, x, y, angle, width, depth, height,
           elevation, groupId?
Anchor     id, kind: room|wall|opening|furniture|free, refId?, u, v
Marker     id, anchorId, deviceId?|virtual{...}, icon?, riveConfig?, hidden,
           actions?, attachments[]
```

`Room.areaId` is what makes `area: ["kitchen"]` mean the same thing in a device
query (§5.3) and on the plan. It stores the **area slug** core normalizes to
(`living_room`), never a display name.

**Units:** store centimeters internally, matching SH3D. Record the unit
explicitly in the document header. Display units come from `ctx.units`.

**Coordinates:** SH3D is Y-down; SVG is Y-down. Convenient, but state it in the
schema so a future importer doesn't silently flip the world.

### 12.2 SH3D importer notes

**There is no Rust importer to port.** The working one is Dart, client-side, in
hc-web-flutter: `lib/core/dashboard/sweet_home.dart` (833 lines) unzips the
archive and parses `Home.xml`, with `floor_plan.dart`, `plan_textures.dart`,
`floor_plan_card.dart` and `home_plan_field.dart` around it — about 2,800 lines
with tests, drawing a live plan today. It already solved two things this design
needs: geometry is parsed into the *document* rather than flattened to a
picture, and the archive's JPEG textures — which cannot live in a document — are
uploaded to the asset store and referenced by address plus a
centimetres-per-tile scale.

Moving it to Rust behind `POST /api/spatial/import/sh3d` is a **rewrite into a
new normalized model**, not a port, and Phase 6 should be priced that way. The
model is the design work and `hc-spatial` is deliberately not shaped like either
SH3D or the Dart (§12.1); what the Dart offers is a worked example of the
parsing and the list below of things that bite.

- **Non-convex rooms.** L-shaped rooms are common. Point-in-polygon must handle
  concave polygons and holes — bounding boxes are not sufficient.
- **Furniture groups nest.** Flatten with transforms composed.
- **Doors and windows are not wall children.** They are furniture pieces that
  intersect walls. Compute the intersection to derive the real opening **at
  import time and store it**.
- **Catalog names are localized.** Don't build icon inference on name matching
  alone — use category plus the rules layer (§11.2).
- **SH3D element IDs are not reliably stable across re-saves.** Anchors must not
  key off them (§12.4).
- **Levels** carry elevation, floor thickness, height and an ordering index —
  preserve all four.

### 12.3 Fallback importers

1. **Raster + trace** — upload an image, trace rooms as polygons. Produces rooms
   but no walls, openings, or true scale. Layers declare their `requires` (§11.4)
   so geometry-dependent ones hide themselves rather than render wrongly.
2. **Scale calibration** — draw a line, enter its real length, recover scale.
3. Future: DXF, IFC.

### 12.4 Non-destructive re-import

Users *will* edit the house in Sweet Home 3D after setup.

- On re-import, **diff** the incoming geometry: added / removed / moved /
  resized, per level.
- Show the diff for confirmation. Never silently replace.
- **Merge, preserving bindings and placements.** Room→area bindings, marker
  anchors, icon overrides, actions, and attachments survive.
- **Anchor identity is the crux.** Anchor to *homeCore* room IDs plus normalized
  coordinates within the room polygon (`u,v`), not to SH3D element IDs. Wall- and
  opening-anchored markers are re-associated by nearest match with a distance
  threshold and flagged for review when ambiguous.
- Orphaned markers move to an "unplaced" tray — never deleted.

---

## 13. Shell stack

| Concern | Choice | Rationale |
|---|---|---|
| Component model | **Web Components (Lit 3)** | Framework-agnostic extension boundary |
| Language | TypeScript, strict | ABI types are the contract |
| Build | Vite | Fast, native ESM, good library-mode for the SDK |
| State | Signals (`@lit-labs/signals` or nanostores) | Fine-grained; avoids whole-tree re-render |
| Expressions | JavaScript, compiled with `new Function` | §6 — already present, already known |
| Routing | `@lit-labs/router` | Few top-level views |
| Charts | uPlot (Tier 1) | Dense time-series, small, fast on tablets |
| Designer surface | **DOM** — transformed scene + screen-space overlay | Draws the real widgets, extensions included (§14) |
| Floorplan | SVG + canvas hybrid, own viewport | §11.6 |
| Geometry ops | polygon-clipping or similar | Point-in-polygon, offsetting, booleans |
| Animation assets | Rive (`@rive-app/canvas`) | §10 |
| 3D (deferred) | three.js | Extrude from `hc-spatial` |
| PWA | `vite-plugin-pwa` (Workbox) | App shell cache, installable |

**Not React.** Workable as a host but awkward as a guest in a custom-element
ecosystem — its synthetic event system and historical custom-element handling
create friction precisely at our extension boundary.

**Not Module Federation.** See §8.1.

---

## 14. Authoring modes, rendering, and the document

### 14.1 Two authoring modes, one document, one renderer

The designer is **not one surface**. It is two, and the document already says
so — `flow` is `packed` or `free`, layouts carry an optional `frame`, and
placements carry an optional `rect` and `angle`. Treating "the designer" as a
single thing is how this gets designed wrong.

| | **Grid** | **Free** |
|---|---|---|
| What it is for | laying out controls | composing a page |
| Placement | cells (`x, y, w, h`), packed | rectangles in the frame (`rect`), plus `angle` |
| Snapping | cell edges — the coarse magnet | the fine grid, guides, other elements' edges |
| Resize | one grip; the card is anchored top-left | eight handles; no privileged corner |
| Rotation | none | yes, per element and per group |
| Overlap | forbidden — the engine pushes | the point; elements lift above the grid |
| Feels like | arranging a page | a design application |

Both are real requirements and neither is a degraded version of the other. A
household control page wants the grid: put six lights down and have them line
up without thinking about it. A wall display wants the other: a reading over a
photograph, a control floating on a floor plan, a headline across a hero — none
of which a tiling of rectangles can express.

**hc-web-flutter already built both**, and the parts worth carrying over are
decisions more than code:

- **Lifting is a property of the element, not the layout** (`free_layer.dart`).
  A lifted card is lifted at every breakpoint, because a design decision that
  changes when you rotate a tablet is not one anybody asked for. It rides in the
  widget's `config`, so there is no schema change behind it.
- **Free mode means drag-to-create, not catalogue-then-place**
  (`design_tools.dart`). You hold a tool and drag, and the thing exists at the
  size and place you dragged it. Choosing from a list and then moving and
  resizing what appears is a content-management interaction, and it is the
  single thing that makes an editor read as a form with a preview rather than as
  a design application. The catalogue stays — a device grid genuinely is chosen
  from a list of what the house can show — it just stops being the only way in.
- **Decorative elements are first-class.** An image, an icon, a text block —
  bound to no device, carrying an action or no action at all. `type` is a plain
  string and core accepts unknown ones (§14.2), so this needs nothing from the
  schema.
- **One geometry function, two magnets.** `resizedBy(coarse:)` is the whole
  distinction in one parameter: a packed card can only land on a cell edge, a
  composed one lands on the fine grid.

**The mode changes the gesture and constraint layer. It does not change the
renderer.** Both modes draw the same elements, in the same scene, from the same
document — which is what makes switching a page from grid to composed an edit
rather than a migration.

### 14.2 The renderer: DOM, in both modes

An earlier draft had the designer drawing to a Konva canvas while the viewer
drew custom elements. That is settled the other way, and the extension ABI
settles it rather than taste: a `CodeAttachment` is a sandboxed document
(§4.6), a Rive widget is its own canvas (§10), and a third-party widget is a
custom element nobody has seen. **None of those can be composited into a canvas
stage.** A canvas designer would show real first-party cards and grey
placeholders for everything else — extensions made second-class at exactly the
surface where somebody is deciding whether to use one, and §19.8 broken where it
is most visible.

- **Designer → the same custom elements the viewer draws**, inside a scene
  element carrying one `transform: translate(tx, ty) scale(k)`, with selection
  handles, guides and marquee in a **separate, untransformed overlay** so they
  hold a constant pixel size at any zoom. One source of truth for
  `{ tx, ty, k }`; every hit test and overlay position derives from it.
- **Viewer → the same elements**, laid out by §5.7.
- **Floorplan is its own surface** and follows neither. Marker drag is always on
  (§11.2); the room-markup mode exists only for the raster fallback importer.

**What makes drawing live widgets in an editor safe** is already in the ABI:
`ctx.mode` is `"view" | "edit"` (§4.2). Two rules make that real rather than
advisory:

- **The designer captures pointer events before the widget sees them.** Dragging
  a card that contains a slider moves the card; it does not set brightness. A
  widget receives interaction only when the designer hands it over deliberately.
- **`mode: "edit"` is enforced by the host.** `ctx.action` refuses to dispatch
  in edit mode, so a widget that ignores its own mode still cannot actuate
  anything — the §5.10 reasoning, applied here.

**No canvas library.** The temptation is to take Konva for its `Transformer`
rather than hand-build handles. The reason not to is that a generic transformer
is generic about the wrong things — it transforms pixels, and this designer
transforms *placements in a document core validates*. Concretely, it does not
know about:

- two snapping magnets, chosen by mode;
- snapping the **edge under the pointer, never the width**, or a card whose left
  sits off-grid can never have a right side on it;
- per-element minimum sizes — a slider that loses its knob below 64 should not
  be draggable to 48;
- group rotation about the **group's** centre, which an element's own rotation
  cannot express.

Adopting `Transformer` means overriding it through `boundBoxFunc` for precisely
those behaviours, and it *adds* work of its own: it attaches to canvas nodes, so
every DOM element needs a proxy node, and three representations — placement,
proxy, element — have to stay in sync.

**Read hc-web-flutter's geometry before writing ours** — `frame.dart`,
`design_tools.dart`, `free_layer.dart`, `group_frame.dart`, `constraints.dart`
are roughly 1,270 lines with the reasoning in the comments, and the bugs they
name are bugs worth not shipping twice. Read it as a **record of problems
encountered**, not as a specification (§1.2): it was written for a client with
no extension story, so it has no notion of a rectangle belonging to a widget
nobody in this repo wrote. Two things this design needs that it does not have:

- **A sandboxed element must be transformable without being inspectable.** The
  designer sizes and rotates a frame it cannot see inside, so every gesture has
  to work from the placement alone. Anything that reached into a widget to
  measure it does not survive the extension boundary.
- **Resize-while-rotated is unsolved there** — the geometry takes an
  axis-aligned rectangle and a raw offset, and `rotation` appears nowhere in
  those modules. The delta has to be rotated into the element's frame before the
  anchor math runs.

**Canvas is scoped, not banished.** The floorplan's field layers — light spill,
heatmaps, coverage — are canvas (§11.6), where thousands of primitives and
per-pixel fields actually live. A dashboard holds tens of elements, which is the
regime DOM is comfortable in.

### 14.2b Containers — a frame that holds what is in it

**Everything before this arranged elements beside each other.** Two cards can
overlap, a group can be drawn round a cluster, a rectangle can sit behind one —
but nothing was ever *in* anything. `core/groups.ts` was blunt about it in its
own words: *"This is not a container. A real group in a drawing tool is a node
in the document tree with its own frame, its own coordinate space and its own
clipping. Ours is a tag that several elements agree on."* It also predicted the
fix: *"A path is the shape that survives it."* The tree was there; what was
missing was somewhere to measure from.

`core/frames.ts` is that, and it needs **one new key**: `frame` on a group box,
saying whether its rect is a decoration drawn round some elements or the origin
they are measured from. Membership is already `group: "Wall/Lights"` in the
element's own config. The rule, and there is only one: *an element's rectangle
is stated in the space of its nearest framed ancestor.*

**Which frames are real elements, and which are backdrops.** A positioned frame
can be drawn *behind* its members, because they know where they are. Three
kinds cannot:

| | |
|---|---|
| `stack: true` | a column — a member that grows pushes the ones below it down, which only happens if they are really its children |
| `fit: "content"` | as tall as what is in it — a measurement of its members, and a box whose members are drawn elsewhere on the page has none to measure |
| nested inside either | its position comes from the flow while its contents would sit at page coordinates, which is two halves of one thing |

`stack` is **not** inherited. A container that does not stack lays its members
out at their stored rectangles, which are already stated in its own space — the
same arithmetic the page does, one level in. That is what lets the house's
footer be a modes block *beside* a scenes block and still be as tall as what is
in it.

**Heights are measured, not stated, wherever the content decides them.**
`fit: "content"` on a widget's config says a placement is as tall as what it
holds; on a group box it says the same of a container; `fit: "page"` says a
placement reaches the foot of the page, which is what the ground a page is
painted on and the hairline between its columns both want. A column is
content-height always — its drawn height is what its author saw on the day, and
keeping it as a floor is what a household calls *not dynamic*. `clip` is how a
container asks for the size it was drawn.

And the page itself: **as tall as what is on it**, in both directions. A canvas
that could only grow left every room but the busiest ending in a screenful of
ground, because the number its author drew was a guess about one room. The one
thing left out of that measurement is a placement drawn *to* the page, which
would otherwise set the height it reads.

**A container paints nothing.** It is a coordinate space and a layout; the
ground belongs to the page, which these documents draw explicitly with a shape.
A raised surface on a container put a panel the same colour as every device row
behind every device row, and the household's words for the result were that the
widgets blend together — a page with two grounds on it.

**A container is structure, not a cluster** (§14.1's groups). The cluster
gesture was written for groups somebody assembled, and the value of one is that
an ordinary press holds all of it. Sections and columns are groups too, so the
press walk starts at the deepest container an element is in rather than at the
page. Stepping out still wins in both directions: a second press goes further
in, Escape goes out, and out of a container is how somebody deliberately takes
hold of a whole section again.

**A section goes when its set does.** `hide_when_empty` was something
`scene_row` answered inside itself, which is as far as it went — the row drew
nothing and its heading, its rule and the space they were drawn in all stayed.
It is a question about the section now, asked from outside the widget: a
container holding something that *chooses* devices is as present as those
members are, and one holding none of them hides only when everything in it is
hidden. That second half is what leaves a band of three labels alone.

**Nothing saved changes.** No document in this household sets `frame`, so
`originOf` returns the page origin for every path in every one of them and
every layout resolves to precisely the numbers it did before. There is no
migration because there is nothing to migrate.

**A drop is a question about what is drawn, not about what is stored.** A
container's members are laid out in flow, so their stored tops are an ordering
and what separates two rows on screen is their content. The two drift apart
down a long column — on this household's Room page the last section of the left
column is drawn 516px above where its rectangle says it is — so a gesture that
converted a drop's page coordinate into the column's space would land a card
wherever the drift had got to. A column is therefore given a *place in its
order*, measured off the page, and restated as a stack from its top afterwards:
a top that is only an ordering loses nothing by being restated, and the numbers
it writes are the ones an unstack would want. A positioned container has no
order to take a place in and simply takes the rectangle, converted.

**A place is read off the page; the number that states it is the document's.**
A column draws only the rows that have something to show and holds every row
it was given, so the two lists are different lengths on any page with a hidden
section — the drop names the row it went past, and its index in the document's
order is what the write splices at. And what may be *aimed at* differs by what
is in hand: a card aimed at a section is aimed at that section, while a
container is aimed at a place in a column, so a container let go over a row of
a column lands beside that row rather than inside it. Nesting a container is
Frame on a selection, which is where it was made before a container could be
dragged at all.

### 14.3 The document

**Dashboard document format — already exists.** It is
`hc_types::dashboard::DashboardDefinition`, it is what is in redb today, and
hc-web-lit reads and writes it rather than defining a successor. A sketch of a
new format was here and has been removed: it was poorer than the real one and
would have orphaned every dashboard already authored.

```
DashboardDefinition  id, name, icon, description, tags, owner_user_id,
                     created_at, updated_at, access[], background?, template
  layouts[]          one per breakpoint: mobile | tablet | desktop | tv
    columns, row_height, gap, flow, derived_from?, frame?, groups[]
    placements[]     widget_id, x, y, w, h  (cells)
                     + rect?    where it really sits, when composed
                     + angle?   degrees clockwise, per arrangement
  widgets[]          widget_id, type (a plain string), config
```

Three properties worth knowing before designing against it:

- **Widget instances are defined once** in `widgets[]` and referenced by
  `widget_id` from each layout's `placements[]`. Editing a widget on the phone
  layout cannot fork it, structurally.
- **`type` is a plain string and core accepts unknown ones.** It was an enum of
  15 variants that every client mirrored by hand; the mirror cracked, and a
  client coerced an unknown card to `markdown` and would have saved it back that
  way. A dashboard authored against a newer core round-trips through an older
  one untouched.
- **`rect` and `angle` are stored and never acted on.** Core has no opinion
  about how a card looks; it has one about two clients disagreeing over where a
  person put something. The snapped cells are what core validates and what a
  client predating frames draws.

Anything genuinely missing is a change to `DashboardDefinition` with a
`serde(default)` and a note, the way `flow`, `frame`, `groups`, `background` and
`template` were each added — not a second format.

Floorplan documents live in `hc-spatial` (§12), **not** in the dashboard
document. A dashboard embeds a floorplan by reference plus a layer/profile
config.

---

## 15. Design tokens

### 15.0 Three scales, and a test for each

**A system nobody applies is a system that does not exist.** The token set in
this section was right and largely unused. Measured on the household's office
page: **twelve font sizes** where the ramp defines seven, **eleven box-shadows**
where the set defines two, and **123 raw spacing values** against 31 using the
space unit. That is what "the whole site needs refining" turned out to mean,
and none of it was a matter of taste.

**Type — the ramp had no middle.** It ran 26, 16, 14, 13, 12.5, 11, 10: one
display size and then six inside six pixels, with `title` three pixels above
body. Nothing could take the lead using the scale, so every widget that needed
presence invented a size — 34px in a device panel, 20 in a media card, 18 in a
gauge, a stepper and a heading. The top three are a scale now (28, 20, 16) and
the bottom four stay bunched on purpose: those are the UI sizes, and a dense
row of devices wants gradations rather than steps you can see.

`hc-text` — the most-used widget in the product — sized in `rem`, a fraction of
the browser root, and was the source of every off-ramp size on the page. It is
a calc against the body token. Not `em`: that compounds through every wrapper
that sets a size, and the same `scale` came out 8.84px in one placement and
11.44 in another.

**Depth — a knob is not a card.** The set had `card` and `overlay` and nothing
for the small raised things, so six drop shadows were written by hand, several
differing only by a decimal, and all of them dark-only literals — on the light
skin every one was a black smudge. `control` is the third height, derived per
skin like the others. Insets stay literal: a rim light drawn inside a box is
not a height off the page.

**Space — 2, 4, 6, 8, 12, 16, 20, 24, 32.** Fifteen declarations were on no
grid at all. `em` is exempt (prose spaces itself against its own type size), as
is a negative value (that centres something rather than spacing it).

**Semantic colour is not the accent.** Accent means a device is on; a wet floor
is not a device being on. `severityOf` (`core/attention.ts`) runs the checks
`worth_knowing` already had, so there is one definition of what is worth
noticing — water and a declared fault are critical, a lock or door left open is
a warning, an unreachable device is offline. Batteries are deliberately absent:
a battery needs a threshold somebody chose, and a page of sensors each a shade
of amber because one is at 19% is a page where the colour has stopped meaning
anything. The word colours, not the row — a row washed red for one open door is
an alarm about a house that is fine.

`styling.test.ts` fails on a text token that is not a role, a fallback that
disagrees with the ramp, a non-inset shadow written as a black literal, and a
gap or padding off the scale. **An invented token is the worst of these**: a
`var(--hc-ink-dim, #93a0b4)` compiles, renders, and silently ignores every
skin, while reading as though it were part of the system.

### 15.0.1 Icons — Phosphor, inlined

The marks were hand-drawn here first: 32 stroke paths on a 24×24 grid, added by
whoever needed one. The household's verdict on them was that the icons suck,
and that is not a fixable kind of wrong — drawing a legible 24px glyph is a
craft, and a client hand-rolling its own icon family is doing badly, by hand, a
job a professional family has already done.

**Phosphor**, which is the family hc-web-flutter uses, so these are shapes the
household already recognises. Three decisions around it:

- **A generator, not a pasted table.** `tool/icons.mjs` holds the map from this
  client's mark vocabulary to Phosphor's names and writes `design/marks.ts`. A
  family that can only be changed by editing a 300-line literal is one nobody
  changes.
- **Inlined SVG, not the font hc-web-flutter loads.** No download, no flash of
  nothing, and a glyph that can be two colours. `@phosphor-icons/core` is a
  devDependency and contributes nothing at runtime; the MIT licence is vendored
  beside the marks.
- **The paint belongs to the mark, not the caller.** Every call site used to
  carry `fill: none; stroke: currentColor; stroke-width: 1.6`, which was right
  for strokes on a 24 grid and wrong for filled paths on a 256 one. `icon()`
  states it once. The caller still owns the size and what `currentColor`
  resolves to. `sdk/shell.ts` keeps its stroke rule deliberately — it styles
  `::slotted(*)` too, so it is the contract an extension's own SVG is drawn
  under (§8), and that is not ours to change.

**A device that is on is drawn filled.** Phosphor ships each shape in a filled
weight, and an outlet that is on and one that is off used to draw the identical
grey glyph — the only difference on the row was the toggle at the far end, so a
column of five plugs took five separate looks to read. Only where being on
means something: a thermometer is not on, and those marks have no filled twin.

The resolution order is untouched (§11.2): a household's own rule, then
`ui_hint`, then `device_type`, then the generic device mark. What changed is the
drawing.

**Scene colour is not a token** (`design/scene-palette.ts`). A Hue scene arrives
with a name, an area, whether it is active and three resource ids — checked
against all 58 in the reference house, not one carries a palette — so the name
is the only evidence there is, and the table is what the names mean. These are
the colours of light in a room: like the warmth strip and the colour wheel, they
mean the same thing on every skin, and a skin tints the chip around them rather
than the light inside. Two departures from the Flutter table they came from: a
name that is not in the table gets a hue derived from the name rather than no
colour at all, because one dotless chip beside eleven reads as broken rather
than as unknown; and the match is on whole words, because a substring test makes
`off` match *Office*.


Core stores **skin seeds**; this client derives the tokens. That split already
exists — `hc_types::skin::SkinSeeds` holds ~26 chosen values and core refuses
to judge them, because *"whether `active` is legible on a card is a contrast
measurement that lives with the derivation"*. It is the right shape (§1.2), and
the reason §17 has no `/api/tokens.json`: resolved tokens are a client's
opinion, and a client that disagreed would be re-deriving them anyway.

**The seeds are chosen; the tokens are derived.** hc-web-flutter measured this
and the finding is worth inheriting rather than rediscovering: no single ratio
reproduces the four shipped skins. Midnight's corner scale is .29/.57/1.57 and
Control Room's is .4/.6/1.6; no lightness step yields all four surface sets. A
formula contorted to hit those numbers is curve-fitting wearing the clothes of a
rule. So a palette is *seeded* — ground, raised, sunken, overlay, ink, accent,
active, success, warn, danger, offline, hairline — and everything with an actual
rule behind it is *derived*: the type ramp (28 fields from one number), density
(4 from one preset), motion (6), the radii, and the shadows.

Five consumers, all client-side:

1. Shell CSS — the resolved tokens as `:root` custom properties.
2. `ctx.tokens` for extensions (§4.2), so a third-party widget restyles with the
   house instead of carrying literals.
3. The **styling contract** (§5.8) — every widget's custom properties default to
   token values, which is what makes card-mod unnecessary.
4. **Floorplan layers** — room fills, wall strokes, marker states, choropleth
   ramps.
5. The designer's own chrome, so an editor on a wall panel is legible in the
   skin the wall is running.

**The built-in skins stay compiled in**, and core says so: they are *"the floor:
a house should never be one bad row away from an unstyled app"*, and a stored
skin names which built-in it was forked from so a skin that fails to load has
somewhere to fall back to. That also means the derivation cannot live only on
the server even if someone later wants it there.

Known values: brand `#FFB661`, espresso glyph `#412402`.

State colours (on/off/unavailable/warning/error) and choropleth ramps are token
-defined and must be colourblind-safe. Do not hardcode a rainbow ramp.

This is the one artifact that survives every remaining architectural branch.
Build it first.

---

## 16. Device targets

| Target | Notes |
|---|---|
| Desktop browser (`desktop`) | Primary designer environment |
| Phone (`mobile`) | Viewer; designer read-only/limited |
| Tablet (`tablet`) | Viewer + light editing; primary floorplan surface |
| Wall tablet (kiosk) | Chrome, same as the others. No separate compatibility target |
| TV (`tv`) | A breakpoint core already has and this document does not target. Layouts exist; nothing is designed for it yet |

**One target: current Chrome.** Kiosk deployment specifies the browser, so the
web platform features this design wants — container queries, `:has()`,
`::part()`, `structuredClone` — are simply available, and there is no
lowest-common-denominator device shaping the architecture.

Performance on modest hardware is still a design concern, and §11.7 is where it
is addressed — as techniques that are right anyway (recompute on state change
rather than per frame, reduced-resolution field layers, pause what is off
screen), not as a gate against a specific device. Profile when there is
something worth profiling.

**Touch:** 44px minimum targets. Pointer Events throughout, so marker drag and
pinch-zoom work identically for mouse and finger.

**PWA:** service worker caches the app shell, extension bundles, and the spatial
document. The UI should survive a LAN blip with cached shell + last-known device
state and a clear stale indicator.

---

## 17. hc-api additions required

| Endpoint | Purpose |
|---|---|
| `POST /api/query` | Resolve a device query (§5.3) |
| `POST /api/history` | History + statistics, server-downsampled (§5.9). **`GET /devices/{id}/history` already ships** — this is the batched, downsampled form |
| `GET/PUT /api/templates/{id}` | Parameterized widget templates (§5.4) |
| `GET /api/extensions` | Installed extension list with manifests |
| `GET /api/extensions/{id}/manifest` | Single manifest |
| `GET /api/extensions/{id}/{path}` | ESM bundle + packaged assets |
| `POST /api/extensions` | Admin upload (`.tar.gz`), manifest validation |
| `DELETE /api/extensions/{id}` | Uninstall |
| `GET /api/assets/index?kind=` | Asset picker backing |
| `GET /api/assets/{scope}/{path}` | Asset fetch, content-hash cached |
| `POST /api/assets/user` | Upload; size cap, SVG sanitization |
| `GET /api/assets/sprite.svg` | Generated icon symbol sheet |
| `GET /api/spatial/{id}` | hc-spatial document |
| `PUT /api/spatial/{id}/bindings` | Room→area bindings, anchors, overrides |
| `POST /api/spatial/import/sh3d` | Upload `.sh3d`, returns parsed model + diff |
| `POST /api/spatial/{id}/merge` | Apply a confirmed re-import diff |
| `GET /api/spatial/{id}/areas` | Suggested room→area matches |
| `GET/PUT /api/dashboards/{id}` | Dashboard documents |

WebSocket gains per-device subscribe/unsubscribe so `ctx.subscribe` maps to real
server-side filtering rather than client-side discard.

---

## 18. Implementation order

### 18.1 What the ordering constraint actually says

The rule is **primitives before the ABI is published**, not primitives before
any widget. Those were run together in an earlier draft and they are not the
same claim:

- *Before the ABI is published* is load-bearing and unrecoverable. Once a third
  party has written against `HcContext`, a primitive added later cannot be
  adopted retroactively by widgets already in the wild — it just becomes a
  second way to do the same thing, which is §5.1's entire diagnosis of Home
  Assistant.
- *Before any widget* is not. Until the SDK is published, every caller is ours.
  A widget written against the wrong shape gets refactored, and having written
  it is the cheapest way to find out the shape was wrong.

Ordering the second way costs something real: it means designing nine
primitives against imagined widgets, with the first honest feedback arriving
months in. Phase 0 exists to prevent that, and Phase 2's exit gate is what keeps
it from becoming an excuse.

### 18.2 Coexistence — this is not a cutover

hc-web-lit and hc-web-flutter both read and render `DashboardDefinition`
(§14) — but each **stores its own copy**. A client depends on core to store
nothing of its own: core keeps the devices, their state, the plugins, and the
configuration a client submits about them, and a page is none of those.

**This changed on 2026-09-10 and it changed the shape of coexistence.** The
original plan had both clients working against one live document in core, so
an edit in either appeared in both. That is gone, and what replaces it is
plainer: each client renders its own pages, and a household moving from one to
the other imports once. The trade is deliberate — a shared document meant this
client could not be independent of core's storage, and independence is worth
more than a synchronisation nobody asked for.

- hc-web-lit ships as a **viewer** first. Pages authored in the Flutter
  designer are taken over on first run (`Authored.importDashboards`, once,
  recorded) and rendered here afterwards. It is no longer *only* a viewer: the
  property panel writes one widget's config back into this client's own store
  (§4.4), which is the narrowest useful write and the one the panel was
  pointless without. Placement, creation and deletion stay with the other
  client until Phase 10.
- **An edit here does not appear there.** Two copies of a page, diverging from
  the moment the import happens, is the honest description of what
  independence costs.
- The Flutter client stays in production and stays the default until the list
  below is done. Nothing is switched off on a date.
- Anything hc-web-lit cannot draw yet is a page you open in the other client.
  A degraded path, not a broken one.

**A client depends on core storing nothing of its own.** hc-web-flutter
compiles ahead of time and holds nothing, so client-side concerns were given a
home in core to have one at all — `/assets` and `/dashboards/templates` are the
named examples, and dashboard documents are the largest. Once this client has a
proper dashboard, Flutter is revamped and **those pieces come out of core**.
Building on one would make that cleanup a breaking change here, and would
recreate the problem the removal exists to fix, so this client keeps its own
store (`server/store.ts`, `core/content.ts`, `Authored`) and reads none of
those endpoints except once, to import.

The test to apply before using a core endpoint is the same one §1.1 and
homeCore#30 answer for data, with the storage question added: **what core
stores is core's** — devices, state, events, plugins, history, auth, and the
configuration a client *submits* about them (`ui_hint`, `name` and `area` on
`PATCH /devices/{id}`, plugin config, automations). Those are core-owned
however they arrive. **What a person authored is the client's**, and it is
stored here.

One consequence worth stating rather than discovering: pages are shared between
devices only where this client's own server is running (`ServerContent`). A
static deployment falls back to per-browser storage, which is right for a
preference and wrong for a page — so a household with more than one screen runs
the server, which is what "self-contained system" has meant since §2.

**hc-web-flutter can be retired when all of these are true.** Until then it is
maintained, not deprecated. Note that the bar is **what the product needs**, not
feature-parity with the other client: some of what that client does was shaped
by its own constraints and does not need reproducing, and the first item below
is something it can never do at all (§2).

- [x] **A third party can ship a widget** — install a `.tar.gz`, place the
      widget, configure it in the GUI, no rebuild. This is the reason the
      project exists, and no amount of parity substitutes for it. All three
      halves are in: `server/tar.ts` unpacks an archive into the store,
      `hc-extensions` offers it in the GUI, the property panel places and
      configures the widget. One thing an installer does not do: load the new
      extension into the running page, because a module that defines a custom
      element cannot be registered twice — it says "reload to use it".
- [x] Every dashboard in redb renders in hc-web-lit — **audited against the
      house on 2026-09-11, and the first audit was wrong.** It counted DOM
      nodes and passed while every composed page was in fact drawing as one
      stacked column under a full-page background shape, because a later CSS
      rule naming `.placed` for the drag handles had overridden its
      `position: absolute` since the handles landed. A household looking at the
      screen found it in a second. Counting mounted elements is not looking;
      `test/page-cascade.test.ts` now reads what the stylesheet *resolves* to
      rather than what it mentions. With that fixed:** All three
      documents core holds are present here, 80 widgets over 18 types, and
      every type is one this client draws: no placeholders anywhere. Ten
      widgets on the Room page draw nothing and all ten are *told* to —
      `hide_with: "@picked"` and `hide_unless`, and nine appear the moment a
      dimmable lamp is picked. The tenth is a `scene_row` with
      `hide_when_empty` and `skip_light_scenes`, and this house has no
      non-light room scenes for any room, so it correctly hides.
      **"Including plugin widgets" is unverified**: no page in this redb uses
      `plugin_widget` (or `floor_plan`), so the renderer is exercised only by
      core's conformance corpus (§4.6) and not by real authored content
- [x] Both authoring modes work (§14.1): grid placement, and free composition
      with rotation, groups and decorative elements. Grid: draw-to-create by
      cell, one grip, the coarse magnet. Free: eight handles, the fine magnet,
      guides, rotation per element and per group, lift, groups by path.
      Decorative elements are not a separate feature and never needed to be —
      `text`, `line` and `shape` are **52 of the 80 widgets on the household's
      own pages**, they place from the palette with no device binding, and a
      gesture is offered on them like anything else
- [ ] A floorplan that renders from geometry rather than from a picture (§11.1)
- [ ] Kiosk mode: no chrome, wake lock, auto-reconnect
- [ ] The rule editor (§21), or an agreed decision that rules stay in the other
      client for now

### 18.3 The phases

**Phase 0 — Walking skeleton and the two risk probes**

The point is a real page from redb on a real screen, in weeks rather than
months, and the two answers that are expensive to get late. **Nothing here is
ABI**: no `hc-extension.json`, no published SDK, no third-party anything.
Widgets written here are expected to be rebuilt in Phase 2 and that is the plan,
not a failure of it.

- [x] Shell: auth, WebSocket, device store with per-device fan-out
- [x] Read `DashboardDefinition` and draw one real dashboard from redb
- [x] `dashboard_layout` reference ported; fixtures green in CI (§5.7) — the one
      piece that is cheaper to get right than to redo, because a wrong
      `normalize` loses edits
- [x] Three widgets, however they come out: `hc-device`, `hc-light`, `hc-chart`
- [ ] Deploy it next to the Flutter client and use it for a week

**Phase 1 — Contract & tokens**
- [x] Skin seeds + the derivation to tokens, ported from the Dart, with the
      built-ins as fixtures — each must rebuild from its seeds field for field
      (§15). Five shipped rather than the four planned: `soft_home` is a light
      ground, and a derivation that had only dark ones to prove itself against
      would have been proving very little
- [x] `@homecore/widget-sdk` skeleton: `HcWidget`, `HcContext`, types
- [ ] `hc-extension.json` schema (incl. `provides`) + validator, Rust side too —
      **client side only.** This host reads and refuses a manifest; core has no
      validator, so a package it would reject installs anywhere else without a
      word. `provides.widgets[]` entries are `WidgetDescriptor`s (§4.6)
- [ ] Core: `graphical` widget kind + its `validate` branch, so a code widget
      with no portable render is legal when it says so (§4.6)
- [ ] Config-schema vocabulary — **the client half exists and the wire half does
      not.** `core/properties.ts` derives a picker per field from core's served
      vocabulary, which is what §4.4 asks these keys to express; nothing yet
      *reads* them off a manifest, because no extension ships a config schema:
      `x-hc-picker`, `x-hc-device-type`, `x-hc-asset-kind`,
      `x-hc-picker: room`, `x-hc-picker: device-or-query`, `x-hc-expr`,
      `hc://schema/action` — names checked against
      `hc_types::dashboard_vocabulary`'s naming ratchet
- [x] Vite target pinned to a Chrome version and stated in `vite.config.ts`

**Phase 2 — Host primitives** *(§5, plus presentation — before the SDK ships)*
- [x] Presentation primitive: `is_on`, facet classification, effective name/area (§1.1)
- [x] **P1** expression compile + cache, the named-parameter scope (§6.4), and
      the throw-renders-a-fallback rule (§6.6)
- [x] **P1** expression scope, AST caching, dependency-driven re-evaluation
- [x] **P2** device query type, live client-side maintenance — `/api/query` is
      **not built and not needed**: the whole house fits in the store, so a
      query resolved there is live by construction (§17)
- [x] **P3** template storage, parameter substitution, instantiation — **by copy**, not by reference (§5.4, corrected 2026-09-11)
- [x] **P4** slot model + chrome suppression rules
- [x] **P5** overlay stack: sheet, dialog, toast, confirm — **no popover**, which
      nothing has asked for: every case so far wanted the sheet, and a popover
      is the one of the five that a wall panel has no pointer for
- [x] **P6** layout engine: Phase 0's port finished — four breakpoints, `flow`,
      `frame`, `groups`, fixtures still green (§5.7)
- [x] **P7** styling contract: custom property naming scheme, `part`
      conventions, enforced by `styling.test.ts` against `design/parts.ts`
      rather than by the planned SDK lint rule — the list is the ABI (§19.7),
      so the check belongs where the list is
- [x] **P8** history/statistics endpoint with LTTB downsampling + client
- [x] **P9** action model, central dispatch, **safety policy (§11.3) enforced here**
- [x] **P10** capability schemas: device + plugin, control generation by kind,
      graceful absence (§5.11)
- [x] Every primitive reachable from `HcContext`, documented, with tests
- [x] **Exit gate:** Phase 0's three widgets rebuilt on the primitives, with
      nothing reaching around `HcContext`. This is what stops "we'll refactor
      later" from being the thing that never happens — and rebuilding a widget
      that already works is the cheapest possible test of whether the primitive
      set is usable.

**Phase 3 — Extension host + ABI proof**
- [x] `ext-host`: manifest load, API version gate, module load, error isolation
- [x] Sandbox host for code elements: frame lifecycle, nonce handshake, CSP,
      grant enforcement (§8.1) — and the per-extension flag that reuses it
- [x] In-realm ESM loader for the two kinds that cannot be framed (§8.1)
- [x] Asset store endpoints + SVG sanitization + attachments
- [x] `HcWidgetBase`, `HcLayoutShell` in the SDK
- [x] **Acceptance gate:** build `hc-button` (§7.4) *first*, as an extension. If
      it needs anything that is not already a primitive, stop and fix Phase 2.
- [ ] **The ABI is published here, and not before.** **Deliberately still
      open** — the surface stays freely changeable until the household says it
      is time. Everything up to this point is ours to change freely; after it,
      §19.7 applies and a rename is a breaking change.

**Phase 4 — Widget vocabulary**
- [x] The Tier 1 family (§7.3) on the shared layout shell — and past it: every
      widget type core validates is drawn except `floor_plan`, which is Phase 7.
      That includes `plugin_widget`, which needed the portable render tree
      (§4.6) rather than a widget: core's element table decides what a plugin
      may declare, and `core/descriptor.ts` is checked against core's own
      conformance corpus
- [x] Containers on P4: stack, grid, swipe, tabs, accordion
- [x] Schema-driven property panel for every widget — no JSON editing required
- [x] Icon rules engine — the floorplan it is to be shared with is Phase 7
- [x] i18n scaffolding

**Phase 5 — Dashboards & PWA**
- [ ] Dashboard document schema v1 + migration harness
- [ ] Per-breakpoint layouts; templates stamped out as copies (§5.4)
- [ ] PWA shell caching, stale-state indicator
- [ ] Kiosk mode (no chrome, wake lock, auto-reconnect)

**Phase 6 — Spatial model**
- [ ] `hc-spatial` schema v1 + Rust crate
- [ ] Write the SH3D importer in Rust against `hc-spatial` — a rewrite, and the
      normalized model is the design work; the Dart one is a worked example of
      the parsing, not a spec (§12.2)
- [ ] Opening derivation at import; non-convex point-in-polygon
- [ ] Anchor model; spatial endpoints; round-trip a real house

**Phase 7 — Floorplan parity**
- [ ] `hc-floorplan` host: viewport transform, SVG+canvas targets, hit dispatch
- [ ] `HcFloorplanLayer` API + `HcFloorplanLayerBase` in the SDK
- [ ] Layers: `rooms`, `walls`, `openings`, `markers`
- [ ] Room→area binding with name-match suggestions; device curation
- [ ] Drag placement (no edit mode), server persistence, reset-to-auto
- [ ] Manual + virtual markers, attachments, info card as an overlay
- [ ] Zoom/pan/pinch, per-space state
- [ ] **Parity review against houseplan-card's README feature list**

**Phase 8 — Rive**
- [ ] `hc-rive` generic widget (§10.2) — runtime bundled once in the shell and
      never exposed to extensions; a `.riv` plus config is the whole surface
- [ ] Artboard/state-machine/input introspection in the property panel
- [ ] Rive marker renderer on the floorplan
- [ ] Viewport pause + `cleanup()` lifecycle
- [ ] **Profile 20 simultaneous instances** (§11.7)

**Phase 9 — Floorplan beyond parity**
- [ ] `light-spill`, `climate`, `presence` layers
- [ ] `mesh` topology + `coverage` heatmap layers
- [ ] Per-device performance profiles (§11.7)
- [ ] Non-destructive re-import diff/merge UI (§12.4)
- [ ] Room-scoped control sheet; multi-room scene apply
- [ ] Level stacking / exploded view
- [ ] Time scrubber over the history API

**Phase 10 — Designer** *(two modes, §14.1)*
- [ ] Shared surface: transformed DOM scene + screen-space overlay, one
      `{ tx, ty, k }`, marquee, multi-select. **Marquee and multi-select are
      in; the transform is not.** A rubber band sweeps up everything it
      *touches* — containment is unusable on cards that are most of a row wide
      — and a group moves by one delta, clamped once so the shape survives the
      page edge, written as one document so it is one step to undo. The band
      lives in the untransformed overlay §14.2 asks for, which on a composed
      page is load-bearing rather than decorative: `.frame` carries a
      `transform`, and a transformed ancestor becomes the containing block for
      a `fixed` child. What is left is `{ tx, ty, k }` itself — pan and zoom,
      which a width-fitted grid page has no use for and which belongs with the
      free-mode designer below
- [x] **Grid mode:** cell placement, the coarse magnet, one grip, no rotation.
      The magnet is not a separate rule here — a cell *is* the unit, so
      rounding the pixels to cells is the coarse magnet — and the single grip
      is the whole of what a packed card needs, because it is anchored
      top-left and only its extent is in question
- [x] **Free mode:** `frame` + `rect` + `angle`, eight handles, the fine magnet,
      guides, lift above the grid, groups and group rotation. **`rect`, `angle`,
      the eight handles, the fine magnet and the guides are in.** `angle` was
      declared in the document and drawn by nobody until now, so a card could
      be stored turned and would render square. Guides are the third magnet and
      beat the grid where they catch, because an edge that snapped to the
      8-grid first would land *next* to its neighbour rather than on it — both
      edges and the middle, each axis decided on its own. **Lift is in too**,
      as a `Layer` choice in the property panel: `gridItems` has always
      resolved the engine's `floating` from `config.layer === "free"`, and
      nothing could write it — so a lifted card could only be made by hand in
      another editor. **Groups are in**, as a path in the widget's config
      (`core/groups.ts`, ported from the Dart's `groups.dart`): the path *is*
      the identity, so nesting is free, orphans cannot happen, and grouping
      then ungrouping leaves the document byte-identical. One press holds the
      cluster, a second press goes in, Escape steps out. **Group rotation is
      in**: holding more than one draws a frame round them with a turn handle
      of its own, and turning it orbits every member about the frame's centre
      as well as turning each one — which is the thing an element's own `angle`
      cannot express, and why rectangles and angles are written together as a
      single edit
- [x] **Handles belong to the selection.** Every placement wore a move grip
      and, on a composed page, eight resize grips and a turn — so entering
      Arrange on the house page put about three hundred grips over a page
      somebody was trying to read, and the household's word for it was noisy.
      Nothing is selected on entering edit mode, so the page is the page until
      something is pressed, and a press is what puts the handles on it. Press
      -anywhere-to-move was tried and taken back out in the same sitting: it
      costs the marquee, which starts wherever the finger lands, and on a page
      that is wall-to-wall cards there would then be nowhere to start one
- [x] Transform geometry — written against the placement model, gestures working
      from the placement alone so a sandboxed element is transformable without
      being inspectable (§14.2). `core/geometry.ts`, pure and tested as such.
      The Dart was read for the bugs it names and they are all here: the
      opposite edge stays put, the edge *under the pointer* snaps and never the
      width, per-element floors (`registerLeast`), and the whole-cell
      approximation stays legal for core so a composed edit cannot make a page
      unsaveable. **Resize-while-rotated, which that code does not have, is
      solved by rotating the pointer delta into the element's frame before the
      anchor arithmetic and rebuilding the rect about the anchor** — the
      alternative swings a growing card round its own moving centre, so it
      slides sideways while being resized
- [x] Tool palette with drag-to-create; the catalogue stays but is not the only
      way in (§14.1). The palette is the shell's, beside Undo and Arrange, and
      it *arms* rather than adds: a held tool turns the page into a surface you
      draw on, in both flows — cells on a packed page, frame pixels on a
      composed one. It is a list and not a row of tool buttons, because fifty
      widget types is not a row. A press that never travels still makes one, at
      the size the catalogue would have given it, where the pointer is: a tool
      that is held and does nothing reads as broken rather than as strict. The
      property panel's catalogue is untouched and still appends at the bottom
- [x] **Drag a widget into a container, or out of one** (§14.2b). Membership
      could only be changed by Group and Ungroup, so moving a card from one
      section to another meant dissolving the first section, re-selecting what
      was left, and grouping it again — on pages where the sections *are* the
      design. The drag already knew where it had let go; nothing read that as
      an answer to which container. **Membership and rectangle are one write**
      (`reparentWidgets`), because either without the other draws the card
      somewhere nobody dropped it: in the new section at the old section's
      coordinates, or where it was let go and still a member of the section it
      left. One document is also one step to undo, which is what the gesture
      was. **The card's own centre decides where it landed**, not the pointer —
      a card is moved by a grip in its corner, so the pointer is at a corner of
      the thing being dropped and the answer would otherwise depend on which
      corner was grabbed. **And the answer is read off the drawn page, never
      off the document**: on the household's Room page the last section of the
      left column draws 516px above where its stored top says, because a
      column's tops are an ordering and what separates two rows on screen is
      their content. Converting a drop's page y into that space would put a
      card dropped on the keypads section past the bottom of the column. So a
      column is given an *index* and renumbered as a stack from its top; a
      positioned container takes the rectangle as it is. The container a card
      *leaves* keeps the gap where it was — the order of what remains is
      unchanged, and rewriting rows nobody touched would be a diff for its own
      sake. **The tag below the container survives**: a card in `Room/Lights`
      dropped into `Footer` lands in `Footer/Lights`, because a drag says which
      container holds a card and not what cluster somebody made inside it.
      **A carried card leaves the flow for the length of the drag**, or the
      gesture shows nothing at all: a member of a column is positioned by the
      column, so the preview moves it nowhere and the drag reads as broken
      until the pointer is released. That is also what closes the column up
      behind it, which is the other half of what somebody needs to see — and
      it is why the surface captures the pointer on **its own host** rather
      than on the handle. Redrawing the card as the page's child instead of the
      container's destroys and rebuilds the grip on the first frame of the
      drag, taking the capture and both listeners with it; the gesture died the
      instant it started working, and silently, because the card had already
      left. Moving a whole *container* into another one is the next box, and
      is a different write: a rename of its path rather than a write to a
      widget's config
- [x] **Drag a whole container into another container**, or out on to the
      page. The half the card's drop left open, and not the same edit: a card
      changes container by a write to its own config, and a container cannot —
      its membership **is** its path, so this renames that path and every path
      underneath it (`reparentGroup`), converts one rectangle, and writes
      nothing at all to the things inside it, whose rectangles are stated in
      the space that travelled with the box. **An arriving name that is taken
      gets a number**, which is the one place the card's rule is turned round:
      a card dropped into `Footer` joins whatever `Footer/Lights` it finds,
      because agreeing on a name is what a cluster is *for*; two containers
      agreeing would be one box swallowing another's members while its own
      rectangle stayed where it was.
      **A section aimed at a section takes a place beside it, not inside it.**
      The deepest container under the pointer is the right answer for a card
      and cannot be for a section: on a page whose columns are wall to wall
      with sections, the deepest match is always one of them, so the household's
      room page nested `doors` inside `motion` the first time it was dragged
      back, and a sibling slot could only be hit in the 20px gap between two
      rows. One step up, and one only — pointing inside a row lands beside that
      row, pointing at the row's own padding lands beside *it* — so both depths
      stay reachable, and nesting a container is Frame on a selection, which is
      where it was made before this gesture existed.
      **The place is read off the page and the number is stated in the
      document**, which are two different lists and were being treated as one.
      A container draws only the rows that have something to show, and the
      write splices into every row the column holds: on the office room five of
      the left column's nine sections are hidden, so a section aimed at the
      foot of the column counted six rows past and landed sixth of eleven. The
      row the drop went past is named, and its place in the document's own
      order is the answer — **which was wrong for a card's drop too**, and is
      fixed for both. Two more numbers that were nobody's intent: a column sets
      its members' left edge, so a drop's x is a number that draws nothing and
      is where the section would leap the moment anybody unstacked the column
      (the room page stored an `x: -128` from this), and it is written as zero
      the same way the renumber writes the tops; and a carried container keeps
      its members, because taking them out of the flow empties the thing in
      hand — measured, a section collapsed from 82px to 0 the moment it moved,
      which is invisible and, since the drop is decided by the box's own
      centre, the wrong rectangle to decide it with
- [x] **The widgets are the size their placements say.** The household's
      verdict on this client against the one it replaces was that the widgets
      are a downgrade, and most of that turned out not to be taste. The room
      page draws the colour wheel at 132×132, the warmth column at 52×132 and
      the media card at 429×400; they rendered a fixed 46×46, a fixed 18px
      strip, and about 190px of card. The design was already in the document
      and nothing was reading it — §14.1's own rule, broken by three widgets at
      once. Fixing that is most of the gap; the rest is the wheel's hues at
      every 30° rather than 60° (six stops interpolate through the middle of
      sRGB and arrive muddy), a thumb that is the colour it points at, the
      warmth column carrying its own reading, album art at a size somebody
      recognises a record by, artist and album on separate lines instead of
      one truncated one, time remaining instead of an unchanging duration, and
      a round filled Play instead of a square 0.25rem larger than its
      neighbours
- [ ] Decorative elements: image, icon, text — no device binding, action optional
- [x] Host-enforced `mode: "edit"`: pointer capture, `ctx.action` refuses to
      dispatch (§14.2). **Both halves, and it was not theoretical**: the move
      grip was a 24px triangle in one corner and the rest of a card was live,
      so pressing the toggle in a device row while arranging the page switched
      a real outlet. The body is inert in edit mode — on the body and not the
      placement, because the placement also holds the handles, and the press
      still reaches the surface, which picks by hit test rather than by event
      target. The host refusing is the other half and the one that holds when
      a widget gets an event anyway: an extension's control, something the
      surface cannot cover, a keyboard. It says why, because a control that
      silently does nothing is the worst kind
- [x] Undo/redo stack. Whole documents rather than inverse operations
      (`core/undo.ts`): an inverse that is *nearly* right leaves a household
      with a page subtly different from the one they had, and snapshots cannot
      be nearly right. Forty steps, over the whole list of pages so a page
      deleted is a page undo brings back, and not persisted — a history that
      survived a reload would let somebody undo, tomorrow, a change they made
      today on a page they have edited since. The stack, the buttons and the
      tests have been in since the container work; this box was simply never
      ticked
- [x] **Give a group a body** (§14.2b). Group writes a *tag* — several
      elements agreeing on a name, which holds them together for a gesture and
      has no geometry at all — and nothing in the product could turn one into a
      container, so the nine sections on this household's room page were made
      by editing the document by hand. Against §19.9, which is the constraint
      and not a preference. **Two kinds**, because a page needs both: a
      **Column** is a section, one thing under another, growing as it fills; a
      **Band** is a row of things side by side that is still as tall as what is
      in it, which is what the house's footer is and what no amount of column
      would express. They are two keys on the same box, so changing between
      them moves nothing at all — a member's rect is stated in the box's space
      either way, a column ignores the tops and a band honours them. Whichever
      it is not is offered as the switch, and Unframe takes the body off; at
      most two buttons at a time and each word says what pressing it does. The
      conversion is exactly reversible: nothing about a member's size,
      order or relative position moves, so stack-then-unstack leaves the
      document byte-identical — the invariant group-then-ungroup already keeps,
      and the reason a household can try it on a real page. The gap between the
      rows is the one thing chosen rather than carried, and it is the median of
      the gaps their author drew. Offered only on a composed page, because a
      column of rectangles is not expressible in cells
- [x] **Move a container**, which is one write to its box and none at all to
      the things inside it. A drag on a whole section used to apply one delta
      to every member — right for a cluster, exactly wrong here, since a
      member's rectangle is stated in the container's space, so moving all of
      them moved them *within* it and left the box where it was. On a column
      it did not even show: a column ignores its members' tops, so the gesture
      read as having failed while quietly rewriting three rectangles. What the
      new rect *means* is the parent's business and both readings are the same
      write — a container on the page moves where it was dragged; one in a
      column is ordered by its stored top, so dragging it up or down the column
      is reordering, which is what a card in a column already did. Half a
      section in hand is still a move of those members: they are leaving, and
      moving the box would take the rest with them
- [x] **Resize a container** — eight grips round its own box, not round its
      contents, because a column drawn 600 tall holding 60 of content is 600.
      The members are untouched, and here that is the point of the gesture
      rather than only correctness: narrowing a column is how a set of rows
      goes from three across to two, and the rows have no say in it. Offered
      only where the *page* positions the container — one in a column takes
      its width from the column and its height from its contents, so there is
      nothing there to resize (§5.11's rule, applied to a gesture)
- [x] Expression editor: SyntaxError on blur, live preview against real state.
      An `ƒx` toggle on every value-shaped field turns a literal into
      `{ $expr }` and back, keeping what it came to on the way out. **Offered
      on every such field rather than on the ones core marks**, because core's
      vocabulary declares `x-hc-expr` for nothing (the wire half does not exist
      — §18.3, Phase 1) while `resolveConfig` evaluates `$expr` and `{{ … }}`
      on every key of every config. The toggle follows the renderer rather than
      a vocabulary that has not been written; offering it nowhere would have
      meant a feature that works everywhere and is reachable from nowhere
- [x] Template authoring UI (**built by reference, reversed to copy the same
      day** — §5.4). P3 has had the whole mechanism since it landed —
      substitution, by-reference instantiation, a store behind an interface —
      and nothing could make a template, so §5.4's "highest-leverage capability
      on the primitive list" was unreachable. Make one out of a widget on the
      page and draw it again from the palette; what lands is an ordinary widget
      with the parameters already substituted, independent from that moment.
      **The parameters are derived from the subtree**, not declared in a second
      editor: a person writes `{{ params.room }}` (or
      `params.room` through the `ƒx` toggle, since substitution is P1's
      language) and the template's inputs are whatever they wrote — a declared
      list that can disagree with the subtree is one that eventually does
- [ ] Device/query picker, asset picker, room picker, extension browser.
      **The asset picker is in**, which is the one of the four that had
      nothing at all: the store could hold a file and serve it back long
      before the GUI could reach it, so the only picture a `url` field could
      name was one somewhere else on the network. `GET /api/assets` lists it,
      the panel offers it on every `url` field, and "Add a picture…" uploads
      and fills the field in one go. Device, scene, room, icon, role, facet
      and dashboard pickers are `datalist` suggestions and have been since
      §4.4 — **open on purpose**, because a suggestion that also restricted
      would make a document naming something this build has not learned
      unsaveable. **The query builder is in too**: core stores `query` as a
      string and defines no syntax for it (§5.3), so authoring one meant typing
      JSON into a text box — the one thing §4.4 rules out. Rooms and kinds come
      from what the house has, and it says what the query matches *right now*,
      which is the thing worth having a builder for at all. Clauses it does not
      offer — `attribute`, `not`, `role`, `sort` — are carried through
      untouched and named on screen. Still open: searching a device list by the
      name a person reads rather than by the id a `datalist` matches on, which
      is unverified — the native popup does not open under automation, so what
      Chrome filters on has not actually been established
- [ ] Validate → diff → apply deployment flow. **Obsolete as written, and
      recorded rather than ticked.** It was designed when core stored
      dashboards: you validated a document, saw what would change, and applied
      it. §18.2 moved pages into this client's own store, so there is nothing
      to deploy *to* — `Authored.saveDashboards` writes straight to
      `server/store.ts` and every edit is already live. Verified rather than
      assumed: nothing in `core/api.ts` writes a dashboard, and the only
      apply-shaped operation left is `importDashboards`, which runs once.
      What survives of it is a **page-level legality check** — `Engine.normalize`
      already guarantees drawn-is-saveable for placements, and the panel flags
      one widget's fields at a time, but nothing answers "could the other
      client read this whole page?" while §18.2 says both clients are in use.
      That is the honest successor and it is a different, smaller thing

**Phase 11 — Ecosystem**
- [ ] Extension install/uninstall UI
- [ ] Manifest signature verification (minisign)
- [ ] Widget SDK + Layer SDK docs, template repos
- [ ] Iframe sandbox path behind the manifest trust flag
- [ ] Raster + trace fallback importer, scale calibration

Deferred, not scheduled: three.js 3D view, DXF/IFC importers, advanced chart
types (left as a third-party proving ground, §7.5).

---

## 19. Constraints to preserve

1. **hc-web is an API consumer.** No logic lives here that isn't reachable over
   hc-api. A CLI must be able to do anything the UI can.
2. **Primitives before the ABI is published** (§18.1) — not before any widget.
   The primitives (§5, plus presentation) ship in Phase 2 and the SDK goes out
   in Phase 3, in
   that order, because a primitive added after third parties are
   building cannot be adopted retroactively. A capability that half the ecosystem needs is a
   host primitive, not a popular extension. If a workaround extension becomes
   widely installed, that is a bug report against this document.
3. **No privileged built-ins, and one contribution path.** First-party widgets
   use the extension ABI; first-party floorplan layers use the layer API; and
   extensions declare widgets through core's `WidgetDescriptor` (§4.6), not a
   parallel manifest of their own. `hc-button` is the acceptance test for
   primitive completeness.
4. **`HcContext` is the only capability channel.** No widget or layer touches the
   socket, the token, or `window` directly. Sandboxed kinds have this enforced
   by an opaque origin; in-realm kinds (floorplan layers, slot containers) have
   only the rule, which is why §8.1 keeps that list short.
5. **Expressions are pure.** Read state, return a value. Anything with an effect
   is an action.
6. **Actions dispatch centrally.** The safety policy (§11.3) lives in the host,
   not in widgets, so no extension can bypass it.
7. **`part` names and CSS custom property names are ABI.** Renaming one is a
   breaking change. This is what keeps card-mod from ever being needed. Note
   they reach *into* a sandboxed frame only as tokens the host sends, not as
   the parent's stylesheet — so a sandboxed widget's parts are styleable by its
   own author, and theming crosses as data (§15).

8. **Adding a widget, layer, template, or asset must never require a rebuild.**
   This is the entire reason for the migration.
9. **Every option is GUI-editable.** No widget ships that requires hand-editing
   JSON.
10. **The floorplan renders from geometry, not from a picture.**
11. **`hc-spatial` is independent of Sweet Home 3D.** SH3D is one importer.
12. **Anchors never key off importer-supplied element IDs.**
13. **One browser target: current Chrome** (§16). No device-specific
    compatibility floor shapes the architecture.
14. **Dashboards, templates, and spatial documents are versioned** with explicit
    schema versions and migrations.
15. **Offline-capable.** No CDN dependencies at runtime.
16. **The rule editor is a projection of the rule document,** never a separate
    authoring format. There is no rule too complex for the visual editor to
    render — see §21.4.
17. **Rules command; pipelines produce state.** The boundary in §22 is enforced
    by MQTT ACL, not by convention. No feature that blurs it ships in either
    system.
18. **Keep every capability expressible as a message** (§3, Rule 3). Calls are
    direct and in-realm; the discipline is that they *could* be messages, so
    isolating a widget stays a transport swap rather than a rewrite.

---

## 20. Open questions

1. ~~**`hc-expr` wasm cost.**~~ **Settled** (§6): expressions are JavaScript,
   evaluated in the client. Rhai stays server-side for rules and topic-map
   transforms. What remains open is smaller — whether `vars` (§6.4) can itself
   hold expressions, which makes evaluation order something the document has to
   define rather than something the evaluator can improvise.
2. **Expression evaluation location.** Host-side before `setConfig` covers most
   cases, but state-dependent fields need per-update evaluation. Where is the
   boundary, and does the widget ever call `ctx.expr` directly?
3. **Extension distribution.** Manual upload only, or an eventual registry?
   Affects whether signing is Phase 11 or Phase 3 — and it matters more now that
   extensions run in-realm (§8.1), since the signature is what tells an admin the
   package is the one its author published.
4. ~~**Konva vs tldraw** for the dashboard designer canvas.~~ **Settled:
   neither** (§14). The designer draws real custom elements in a transformed
   DOM scene, because no canvas library can render a sandboxed extension
   document, a Rive artboard, or a third-party custom element. tldraw would
   additionally bring its own shape store, and the document is
   `DashboardDefinition`.
5. **Multi-user.** Do dashboards, templates and floorplans become per-user?
   hc-api plans per-user JWT scopes; all three formats should reserve ownership.
6. **Camera streams.** Confirm the codec/transport path (WebRTC vs HLS vs MJPEG)
   performs on tablet hardware before committing `hc-camera` — decoding several
   streams is a CPU question, not a browser-support one — and decide whether a
   floorplan camera marker shows a live thumbnail or only opens a stream.
7. **Rive licensing.** Confirm runtime license terms before Phase 8.
8. **Designer offline.** The earlier native design assumed an offline designer
   with a cached device catalog. Does that requirement survive in a browser?
9. **Presence positioning.** Is BLE/UWB trilateration in scope, or is room-level
   presence sufficient? Determines whether markers need a live position channel.
10. **How much furniture to render.** Default to structure only, with furniture
    as an optional layer?

---

## 21. Rule & automation editor

### 21.1 The model decides the editor

The recurring "Node-RED canvas vs. flat if/else list" debate compares two editors
optimized for **different underlying models**. The choice is already determined
by the rule model homeCore has:

- Triggers → conditions → actions
- Sequencing primitives: `Delay`, `Parallel`, `RepeatUntil`
- Conditions are side-effect free, so they can be evaluated speculatively for
  dry-run

That is a **rooted tree with control-flow nodes**.

- **Node-RED is a dataflow graph.** Messages travel wires, topology is arbitrary,
  the graph *is* the program.
- **Home Assistant's editor is a shallow list** with limited nesting.
- **homeCore's rules are neither.**

So the question is not "list or graph." It is: what visual form matches a tree?

### 21.2 The form: vertical nested block flow

Blockly / Apple Shortcuts / Zapier Paths, not a free canvas.

- Reads top to bottom.
- Branches render as visual forks.
- `Parallel` renders as side-by-side columns.
- `RepeatUntil` renders as a container that visually wraps its body.
- Drag to reorder; drop zones are structural, so an invalid tree cannot be built.

This captures most of the canvas's visual appeal without pretending the rules are
dataflow.

### 21.3 Why a free canvas is wrong here

Four reasons, all downstream of decisions already made in this document:

1. **Mobile and tablet are the targets** (§16). Free-canvas graph editing on a
   phone — pan, zoom, precise wire dragging, node placement — is miserable. A
   vertical block flow works with a thumb. This alone is close to decisive.
2. **Rules are data and version-controllable.** A tree serializes with stable
   ordering and diffs cleanly. A graph serializes to nodes + edges + x/y
   coordinates, so every nudged node churns the file.
3. **Dry-run depends on determinism.** A tree has one entry point and a
   deterministic evaluation order. A graph with parallel wires has no canonical
   order, which makes "what would this do?" genuinely hard to answer.
4. **Static validation.** From a tree: unreachable branches, conditions that can
   never hold, actions on nonexistent devices. From an arbitrary graph: much
   less.

Empirically, Node-RED home-automation setups have a well-known tendency toward
unmaintainable spaghetti at scale. The canvas that makes twelve nodes elegant
makes two hundred a crime scene.

### 21.4 Progressive disclosure — three tiers, one document

What makes both HA's editor and Node-RED feel bad is presenting full generality
for rules that are almost always trivial.

| Tier | Surface | Audience |
|---|---|---|
| 1 | **Templates** — pick "motion-activated light," fill three fields | Most rules; household members |
| 2 | **Block editor** — the vertical tree | The ~10% needing real branching |
| 3 | **Text** — the serialized rule document (TOML/JSON), Rhai for conditions | Power users, diffs, bulk edits |

Every rule offers all three with a toggle.

**The block editor is a projection of the rule document, not a separate authoring
format.** Because rules are already data, round-tripping is free rather than an
AST-projection problem — which means a rule authored in text always renders in
blocks, and the "this automation is too complex for the visual editor" failure
mode does not exist. This is a hard constraint (§19.16).

**Rule templates share the parameter model with widget templates (§5.4) — not
the mechanism.** Stated precisely, the same way §21.8 states the P9 overlap,
because "one template mechanism" is too strong and produces a schema that fits
neither:

- **Share:** the parameter vocabulary (`name`, `type`, `default`, which picker
  a type implies), the by-reference storage and instantiation model, and the
  editor components that render parameters and fill them in.
- **Do not share:** the body. A widget template's body is a widget subtree
  validated against `dashboard_vocabulary`; a rule template's body is a rule
  validated against the rule vocabulary. They are different documents and one
  schema over both would compromise each.

What this rules out is a **third** concept: there is no separate "blueprints"
system for automations. A rule template is a rule with parameters, authored in
the same editor, rendering in the same block tree (§21.2) — which is what makes
Tier 1 of the table above a projection of Tier 2 rather than a parallel format.

### 21.5 What Node-RED's appeal actually decomposes into

Separating the appeal from the editor is the useful move, because most of it is
separable:

| The draw | Available without a graph editor? |
|---|---|
| Seeing the whole system at once | **Yes** — derived read-only system graph (§21.6) |
| Watching data move through the flow | **Yes** — execution trace (§21.7) |
| Reusable subflows | **Yes** — rule templates (§5.4) |
| Direct-manipulation satisfaction | Partly — drag-to-reorder blocks |
| Arbitrary topology | No — and it is not wanted |

### 21.6 Derived system graph (read-only)

An **auto-laid-out, never hand-arranged** graph: devices on one side, rules in
the middle, devices and services they write on the other.

- Answers the single most common question in any home automation system:
  *"what turned that light on?"*
- Derived statically from the rule documents, so it is always accurate and there
  is no layout to persist and no diff churn.
- Comprehension, not authoring — which is what Node-RED users actually value.
- Filterable by device, by area/room (reusing the query primitive, §5.3), and by
  rule.
- Renders on tablet; it is a view, not an editor.

### 21.7 Execution trace

After a rule fires, show the path taken on the block tree: which conditions
evaluated true, the value at each step, timing per node.

- Easier on a tree than a graph, because there is exactly one path.
- This is Node-RED's debug-tap appeal, done better.
- Paired with the history DB (§5.9), past firings are replayable, not just live.
- Dry-run uses the same rendering: evaluate speculatively, highlight the path
  that *would* be taken, execute nothing.

### 21.8 Reuse from the primitives

The rule editor is not a special case. It is built from §5:

| Need | Primitive |
|---|---|
| Condition expressions, computed action payloads | P1 / §6 — same Rhai, same editor component |
| Device and area selection in triggers/conditions | P2 (§5.3) |
| Rule template parameters, storage, instantiation | P3 (§5.4) — the parameter model only, not the body (§21.4) |
| Block nesting and containers | P4 (§5.5) |
| Pickers, confirmation, trace detail panels | P5 (§5.6) |
| Trace timing charts | P8 (§5.9) |

**Partial overlap with P9 (§5.10), stated precisely:** UI `ActionConfig` includes
`navigate`, `overlay`, and `details`, which are meaningless server-side. Rule
actions include sequencing (`Delay`, `Parallel`, `RepeatUntil`), which is
meaningless in a tap handler. **Share the service picker and payload editor
component; do not share the schema.** Forcing one schema onto both would
compromise each.

### 21.9 Validate early

Build the block editor against a genuinely complex real rule — nested conditions,
a parallel group, and a repeat — and open it at `mobile` width. If a deep tree becomes unreadable there, a collapse/summary mode is
required, and that is far cheaper to discover before the editor exists than
after.

---

## 22. System boundary: rules vs. pipelines

Stream processing of MQTT and webhook payloads is a **separate system with its
own document**: `HC_PIPELINE_ARCHITECTURE.md`. That document is authoritative for
the pipeline model, node vocabulary, webhook handling, runtime semantics, and
editor. Nothing about pipelines is specified here.

This section records only what the UI side needs to know.

### 22.1 The invariant

> **Pipelines produce device state. Rules react to device state and act on the
> world.**

The test: **if it needs to command something, it is a rule; if it reshapes a
payload into state, it is a pipeline.** The boundary is enforced by broker ACL —
pipelines may publish only into `homecore/devices/#` — not by convention. Grey
cases and their resolutions are catalogued in `HC_PIPELINE_ARCHITECTURE.md` §2.

### 22.2 Two editors, deliberately

| | Rule editor (§21) | Pipeline editor |
|---|---|---|
| Model | Rooted tree | Dataflow graph |
| Form | Vertical block flow | Free canvas, auto-layout |
| Authoring | Desktop, tablet, phone | **Desktop browser only** |
| Mobile / tablet | Full authoring | Read-only: view, enable/disable, metrics, dead-letter |

Graph authoring on a phone is not worth solving. The read-only pipeline views on
tablet and phone are built from the primitives in §5 like any other surface, and
are the only pipeline UI this document covers.

### 22.3 Shared surfaces

Three things cross the boundary, and each is specified in this document rather
than duplicated in the pipeline doc:

- **Rhai** (§6) is the single transform/expression language across rule
  conditions, pipeline transforms, and dashboard config. The expression editor
  component is shared.
- **The extension manifest** (§4.3) carries `provides.pipelineNodes` alongside
  `widgets` and `floorplanLayers`. One install flow, one signing story.
- **Schema-driven property panels** (§4.4) render node config exactly as they
  render widget config.

**What must not cross:** a pipeline node type never reaches `HcContext` or any
UI capability. Sharing the manifest format is correct; sharing the capability
object would merge the two systems back together through the extension layer.

---

## 23. Reference implementations worth reading

- **[Matysh/houseplan-card](https://github.com/Matysh/houseplan-card)** — the
  floorplan parity benchmark. Read the README feature list before the Phase 7
  review. Study the good parts (device curation, no-edit-mode drag, server-side
  layout storage, icon rules, safety policy) and the structural limit: it is a
  closed card, so every new visualization needs a maintainer PR.
- **Mushroom** — the Tier 1 model. Note both the card list and the explicit
  non-goal: it does not chase deep customization and points users elsewhere for
  it. That split is the design being copied.
- **button-card** — the Tier 2 model, and the source of the primitive list.
  Everything it does with `[[[ ]]]`, `variables`, style blocks and templates maps
  onto P1, P3, P7 and P9. Read it as a requirements document for §5.
- **card-mod, auto-entities, decluttering-card, layout-card, stack-in-card,
  browser_mod** — read these as **bug reports against Home Assistant's host**,
  not as features to reimplement. Each one is a primitive that should have been
  in the platform.
- **Bubble Card, Ultra Card** — cards that became platforms (module stores,
  nested modules). Validates the layer/composition approach one level up.
- **ApexCharts card** — the ceiling for what a third-party chart extension should
  be able to build on the SDK without special cases.
- **Home Assistant custom cards docs** — the extension interface (`setConfig`,
  `hass` property, `config-changed`, `window.customCards`) and its failure modes:
  whole-object state push, no manifest, no versioning, ad-hoc editors.
- **Blockly, Apple Shortcuts, Zapier Paths** — the block-flow model for §21.
  Shortcuts in particular is the reference for editing a control-flow tree on a
  phone, which is the constraint most editors ignore.
- **Node-RED** — read for what to *decompose*, not what to copy (§21.5). Its
  debug tap and subflows are the parts worth having; its free canvas is not.
- **Home Assistant automation editor + YAML toggle** — the visual/text
  round-trip works because automations are already data. Same reason ours will.
- **Sweet Home 3D `Home.xml` format** — the importer's source of truth.
- **hc-web-flutter** — read for problems already encountered, never as a
  specification (§1.2). `sweet_home.dart` and `floor_plan_card.dart` for SH3D
  parsing and the texture-to-asset-store path; `code_runtime.dart` for a sandbox
  that works in a browser; the designer for transform, snapping and undo. All of
  it was written for a client with no extension story, which is the axis this
  design changes.
- **Rive runtime docs** — state machines, typed inputs, events, text runs.
- **Lit** — reactive properties, `ReactiveController` for subscription teardown.
- **Figma, Sketch, Illustrator** — for §14.1's free mode. The reference for
  what a composition surface feels like is a design tool, not a dashboard
  editor.
