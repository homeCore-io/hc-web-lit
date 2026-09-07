# hc-web — UI Architecture

> Design record and implementation context for the homeCore web UI.
> Drop into the repo root as `CLAUDE.md` (or import into `docs/`) so Claude Code
> picks it up per session.

**Status:** design accepted, implementation not started
**Supersedes:** the Flutter/wasm implementation of hc-web
**Targets:** browser (desktop), phone, tablet. **No desktop-native target.**

---

## 1. Purpose

hc-web is the primary user interface for homeCore. It is an API consumer only —
it holds no automation logic and no privileged state. Everything it does is
available over the hc-api REST/WebSocket surface.

It has two modes:

- **Viewer** — renders dashboards. Runs on phones, tablets, wall-mounted
  kiosks (Fire tablets), and desktop browsers.
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
| domain (`light.*`) | **`device_type`** | `"light"`, `"switch"`, `"cover"`, `"thermostat"`, `"media_player"`, `"timer"`, `"button"`, `"camera"`, `"scene"` |
| — | **`ui_hint`** | user override of `device_type` for presentation (`"door"`, `"window"`, `"garage"`) |
| `friendly_name` | **`name`** / `name_override` | `effective_name()` = override ?? plugin name |
| area | **`area`** / `area_override` | slug (`living_room`); `effective_area()` = override ?? plugin area |
| `state` (scalar) | **`attributes`** (map) | there is no scalar state — see below |
| more-info | **details** | homeCore has no "more info" dialog |

**The one that is not a rename.** A homeCore device has no scalar state string.
It has `available: bool` and `attributes: HashMap<String, Value>`, and
"on-ness" is *derived* from whichever attribute the device actually publishes —
`on`, `locked` (inverted), `open`, `motion`, `occupancy`, a `state` string for
transports, or a non-zero level. `entity.state == "on"` has no translation.

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
desktop browser, phone, and Fire tablet with one codebase.

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
  └── /api/tokens.json        resolved DTCG design tokens                [NEW]

hc-expr (Rust crate)                                                     [NEW]
  ├── Rhai-based pure expression evaluator, shared with the rule engine
  └── wasm build for the browser

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
  │   ├── expr                expression evaluation (hc-expr wasm)
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

**Rule 3 — the ABI is a protocol, not a class.** Most widgets run in a sandbox
(§8.1), so the contract between host and widget is **messages across a
boundary**, and a JavaScript object with methods is one binding of it rather
than the thing itself. Any capability that cannot be expressed as an async
message is a capability extensions do not get — see §4.2.

---

## 4. The extension contract

This is the ABI. It is the most expensive thing to change later. Lock it before
writing UI.

### 4.1 Widget interface

**The contract is a protocol.** Most widgets run in a sandboxed frame (§8.1) and
are therefore not objects in the host's realm at all, so the ABI is the sequence
of messages, and the TypeScript below is the **in-realm binding** of it — what
the SDK hands an author, and what the two unsandboxable kinds implement
directly.

```
host → widget    config      the resolved config; widget replies ok | error
host → widget    state       the granted devices, on connect and on change
host → widget    mode        "view" | "edit"
host → widget    tokens      resolved design tokens, again on theme change
widget → host    size        preferred size (see below)
widget → host    request     any HcContext call (§4.2), correlated, awaited
widget → host    log         author diagnostics, surfaced in the inspector
```

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

A custom element is a convenient binding, not the boundary. **If a capability
cannot be phrased as one of those messages, extensions do not have it** — which
is Rule 3, and the discipline that keeps the two kinds from drifting into two
ABIs.

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
   *  Content is a widget *spec*, never a DOM node — a sandboxed widget has no
   *  nodes the host could mount. */
  overlay: OverlayApi;

  /** P8 — history and statistics, downsampled server-side. */
  history(req: HistoryRequest): Promise<HistorySeries[]>;

  /** P9 — run a configured action with the shared safety/confirm policy. */
  action(cfg: ActionConfig, source: ActionSource): Promise<void>;

  /** Resolve an asset reference to a URL, namespaced to this extension.
   *  A sandboxed frame has an opaque origin and `default-src 'none'`, so the
   *  host must also admit the asset origin into that frame's CSP (§9) — a URL
   *  the frame cannot fetch is worse than no URL. */
  asset(ref: string): Promise<string>;

  /** Read-only spatial geometry, when a model is loaded. Queried, not handed
   *  over: a house is too large to copy into every frame, and a widget wants
   *  one room's polygon rather than the document. */
  spatial?: SpatialQuery;

  /** Resolved DTCG design tokens. */
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

**Every call is async, and that is not a detail.** Each member above is a
request across a frame boundary (§8.1), so the whole surface returns promises
and nothing here may be a live object the widget holds. That is why `spatial` is
a query rather than a model, why `overlay` takes a widget spec rather than a
node, and why **`rive` is not on this list at all** — a frame cannot share the
host's runtime instance, and shipping a copy of it into every frame is megabytes
per widget. Rive is reached the way §10.2 already describes: a first-party
`hc-rive` widget configured by *data*, which any extension can instantiate and
no extension needs to bundle.

**The test for anything added here later:** phrase it as a message with a
correlated reply. If it cannot be phrased that way, it is a capability only the
first-party client would have, and Rule 1 says that is the ABI being wrong
rather than a reasonable exception.

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

Each widget ships JSON Schema for its config. The designer renders the property
panel from the schema — extension authors get an editor for free.

This mirrors the `schemars::JsonSchema` approach already planned server-side, so
widget config validation can run identically on both ends.

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
- **`CodeAttachment` is a sandboxed document, not an in-realm ESM module.**
  `entry` is *"the document the sandbox loads"*; `grant` names the devices it
  may reach — and the grant is these same `bindings`, not a second list.
  **Settled in §8.1:** sandbox by default, in-realm only for the kinds that
  cannot be framed. §4.1's custom-element `HcWidget` interface therefore
  describes the in-realm kinds; a sandboxed widget's equivalent is the shim
  inside its frame, and `HcContext` reaches it over `postMessage`.

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

**Sequencing constraint:** the primitives below — the nine here plus
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
| **Widget template** | a widget subtree with parameters | **by reference** | this section |
| **Rule template** | a rule with parameters (§21.4) | **by reference** | not built |

Copy is right for a starting point and reference is right for the other two, for
opposite reasons. A page you began from is not a thing you want changing under
you later — *"template are starting points"* — and that decision is what keeps
it one boolean rather than an instance model, with nothing to re-sync and no
question about who wins. A `room-tile` used in twelve rooms is the exact
opposite case: one edit landing everywhere is the whole point.

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

Instantiation is by reference, not copy — editing the template updates every
instance. Combined with P2, a whole dashboard generates from a room list, which
is the single highest-leverage capability on this list for real users.

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
this — not special-cased card types.

**Containers are the one place Rule 1 does not fully hold, and it is worth
saying rather than discovering.** A container's children are host-rendered
widgets, each in its own frame; a container that was itself sandboxed could not
hold them, because a frame cannot mount another frame's element. So containers
run in-realm (§8.1) and an extension cannot currently ship one.

Two ways out, neither free, and this needs deciding before §7.3's containers are
built rather than after:

- **A container declares layout, the host performs it.** The container is data —
  slot names, direction, gaps, breakpoints — evaluated by the host, which owns
  the children. Extensions can then ship containers, but only declarative ones.
- **Containers stay code and stay first-party**, and the manifest simply has no
  container kind, said plainly in the SDK docs rather than left as a gap someone
  discovers.

The first is more in keeping with §3's Rule 1 and is probably right, since every
container in §7.3 is expressible as data. It is listed here as an open decision
because it constrains the slot model, which is this primitive.

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
  radius, and typography, defaulting to DTCG token values (§15).
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
the difference between usable and unusable on a Fire tablet.

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

*Obviates:* per-card action handling, and the class of bugs where one card's
long-press works differently from another's.

---

## 6. Expression language

### 6.1 The decision

Config values may hold **pure expressions**. The evaluator is **Rhai, compiled to
wasm**, shared with the server-side rule engine via the `hc-expr` crate.

| Option | Trade-off |
|---|---|
| No expressions | Simple and safe; users hit walls and reimplement button-card as an extension anyway |
| Restricted DSL (CEL, JSONata, jsonlogic, jexl) | Sandboxed, analyzable, CSP-clean — but a second language to learn |
| **Rhai → wasm** | **Same language as rule conditions and topic transforms; one syntax across the whole system** |
| Full JS `eval` | Maximum power; requires `unsafe-eval` in CSP; unsandboxable |

homeCore already uses Rhai for rule conditions and topic-map transforms. Shipping
the same evaluator to the browser means a user learns one syntax and it works in
automations, transforms, and dashboard config. Nothing else in this space can
offer that, and it falls out of decisions already made.

### 6.2 Purity constraint

Expressions **read state and return a value**. No side effects, no service calls,
no network, no DOM, no `window`. This is the same constraint already placed on
rule conditions, and for the same reason: pure expressions are safe to evaluate
speculatively, to preview in the designer, and to run identically on the server.

An expression that needs to *do* something is an action (§5.10), not an
expression.

### 6.3 Syntax and placement

Two forms, both unambiguous in JSON and both schema-checkable:

```json
{
  "label":   "{{ device.name }}",
  "icon":    { "$expr": "if is_on(device) { \"lamp-on\" } else { \"lamp\" }" },
  "device_ids":{ "$query": { "area": ["kitchen"], "deviceType": ["light"] } }
}
```

- `"{{ … }}"` — interpolation shorthand for simple reads inside a string.
- `{ "$expr": "…" }` — full expression, any return type.
- `{ "$query": { … } }` — device query (§5.3), not an expression.

A field accepts expressions only if its schema declares `x-hc-expr: true`. The
designer shows an "ƒx" toggle on those fields; everything else stays a plain
value. This keeps the property panel honest and keeps expressions out of places
where they would be surprising.

### 6.4 Evaluation scope

Read-only, and explicitly enumerated:

```
device          the primary bound device (attributes, available, last_seen)
devices[id]     any device the widget declared in its bindings
params          template parameters (§5.4)
vars            widget-local variables defined in config
tokens          resolved design tokens
user            locale, units, theme — not identity
now             evaluation timestamp
```

Nothing else is in scope. A widget cannot reach a device it did not declare —
expressions do not bypass the subscription model.

### 6.5 Server-side parity

The same `hc-expr` crate validates and previews expressions in the API. A
malformed expression is rejected at save time with a line/column error, not
discovered at render time on a wall tablet.

### 6.6 Risks to measure early

- **Wasm bundle size and cold start.** Benchmark `hc-expr` on the Fire tablet in
  Phase 2. If it is unacceptable, fall back to a restricted DSL — but make that
  call before widgets depend on Rhai syntax, not after.
- **Evaluation frequency.** Cache compiled ASTs per config value; re-evaluate
  only when a dependency in scope changes, not on every state push.
- **CSP.** The chosen approach must not require `unsafe-eval`. Rhai-in-wasm does
  not; JS `eval` does. This is a reason to avoid the JS option beyond taste.

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

Every Tier 1 widget is a thin specialization of one shell. The shell ships in
the SDK and is bundled *into* each widget, since a sandboxed widget cannot
import from the host — so keep it small, and keep anything large (icon sets,
the token table) on the host side of the boundary where it is sent as data.

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
row, and the shared action model (§5.10). Layout options: horizontal/vertical,
icon-only, fill-container, hide-name, hide-state.

Icon color mapping comes from tokens (§15), not hardcoded — so a theme change
recolors every widget including third-party ones.

### 7.3 Tier 1 family

Ship these. The list is deliberately close to Mushroom's, because it is a proven
vocabulary rather than a guess.

| Widget | Control row |
|---|---|
| `hc-device` | generic; attributes + optional toggle |
| `hc-light` | brightness slider, color temp, color picker |
| `hc-cover` | position slider, up / stop / down, tilt |
| `hc-fan` | percentage slider, oscillate, preset |
| `hc-thermostat` | setpoint +/−, mode select, current temp |
| `hc-lock` | lock / unlock (confirm-gated) |
| `hc-media` | transport, volume, source select |
| `hc-alarm` | keypad, mode buttons (confirm-gated) |
| `hc-vacuum` | start / pause / return, fan speed |
| `hc-humidifier` | target humidity, mode |
| `hc-timer` | remaining, start / pause / reset |
| `hc-button` (device) | keypad buttons, per-button labels from `button_names` |
| `hc-person` | presence + location |
| `hc-update` | version, install |
| `hc-chips` | horizontal row of compact status pills |
| `hc-title` | section heading, expression-capable |
| `hc-list` | device list; takes a query (§5.3) |
| `hc-chart` | time series over the history API (§5.9) |
| `hc-gauge` | radial/linear gauge with token-driven severity bands |
| `hc-markdown` | text with expression interpolation |
| `hc-camera` | still or live stream |
| `hc-rive` | generic Rive widget (§10.2) |

Containers (built on P4): `hc-stack`, `hc-grid`, `hc-swipe`, `hc-tabs`,
`hc-accordion`.

**Not in this list, deliberately:** `hc-alarm`, `hc-vacuum`, `hc-humidifier`,
`hc-person`, `hc-update`, `hc-select`, `hc-number`. Those are Home Assistant
domains; homeCore has no `device_type` for them. A widget precedes its
`device_type` only if a plugin is shipping one — otherwise it is a widget for
devices that cannot exist.

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

### 8.1 Loading — two mechanisms, chosen by kind

**Settled: sandboxed by default, in-realm by declared exception.**

The earlier draft said "start trusted, build for hybrid." The argument against
it is the driver itself (§1.2): the point of this rewrite is that somebody
outside this repo can add a widget. **In-realm means every such widget can read
the session token**, so "trusted by default" quietly limits the ecosystem to
code the admin has personally audited — which is the small, cautious ecosystem
this project is trying not to have. A sandbox is what makes a widget from a
stranger a reasonable thing to install.

It is also the decision that cannot be walked back. Once extensions assume
main-realm DOM, sandboxing them later breaks all of them at once.

**The mechanism is specified in core**, as `CodeAttachment { entry, grant }`,
and hc-web-flutter's `code_runtime.dart` is one implementation of it — evidence
the shape works in a browser, not the reason to choose it. What that
implementation gets right and this one should keep:

- `sandbox="allow-scripts"` **without** `allow-same-origin`, so the frame gets an
  opaque origin and cannot reach this app's cookies, storage or DOM. *The two
  must never be set together — that combination lets a frame remove its own
  sandbox attribute.*
- A CSP meta inside the document, `default-src 'none'`, inline script only, with
  network opened per element and only when reaching the LAN is the point.
- A per-frame nonce carried on every message in both directions, so a stale
  frame in an old tab cannot be mistaken for a live one.
- Messages are JSON **strings**, not structured clones — no conversion surface
  at a boundary where getting it wrong means a sandbox escape.
- **The device grant is the whole permission model.** An element names a
  selection and is handed exactly those devices, and may act on exactly those.
  Naming nothing renders and can do nothing, which is the right default for code
  someone pasted from the internet.
- Skin tokens go in as CSS custom properties, so a sandboxed element restyles
  with the house instead of being a permanent literal.

**The grant and the bindings are the same thing** (§4.6). A descriptor's
`bindings` are the subscription set in-realm and the grant across the frame
boundary; they must not become two lists that can disagree.

**Which mechanism a kind gets:**

| Kind | Mechanism | Why |
|---|---|---|
| Code element (pasted, authored in-product) | **sandbox** | untrusted by definition; ships today |
| Extension widget | **sandbox** | owns a rectangle, talks in messages — nothing more is needed |
| Floorplan layer | **in-realm ESM** | renders into a *shared* SVG/canvas target; cannot be framed |
| Container widget (P4 slots) | **in-realm, first-party** | its children are host-rendered widgets, which an iframe cannot hold |
| Pipeline node UI | **sandbox** | same shape as a widget |

So the in-realm ESM path is not deleted — it is **scoped to the kinds that
cannot be framed**, and those kinds are higher-trust by nature. The install UI
says which kind an extension is contributing, because "this adds a floorplan
layer" is a different consent than "this adds a card."

**The gap is the whole job.** That existing shim exposes four functions —
`states`, `onUpdate`, `set`, `log` — which is enough for a card that draws a
gauge and enough to prove a frame is safe. It is nowhere near `HcContext`
(§4.2), and the difference is not a detail: `query`, `overlay`, `history`,
`action`, `expr` and the presentation primitive all have to cross
`postMessage` before a sandboxed widget is a **first-class** widget rather than
a tolerated one. §4.2 claims that is a transport swap. Phase 3 is where the
claim is tested, and §3's Rule 1 is what it is tested against: if a first-party
widget would be unreasonable to write against the proxied context, the proxy is
wrong — not the rule.

**Measure the frame cost, do not assume it.** Thirty iframes on a Fire tablet is
the objection to this design and it deserves a number, not a shrug — the same
treatment §11.7 gives Rive. Profile it in Phase 0 alongside the other probes. If
frames are too expensive at dashboard scale, the fallback is a **shared worker
frame** hosting several widgets behind one origin, not a retreat to the main
realm.

**Loading, for the in-realm kinds.** Native ESM. No Module Federation — it
exists to share a bundler runtime across builds you control, which is not this
situation.

```ts
const manifest = await api.get(`/api/extensions/${id}/manifest`);
assertApiCompatible(manifest.hcApiVersion);
const mod = await import(
  /* @vite-ignore */ `/api/extensions/${id}/${manifest.entry}?v=${manifest.version}`
);
```

The `?v=` cache-buster keyed on manifest version means extension updates take
effect on reload without service-worker gymnastics.

### 8.2 What in-realm still costs

An ESM module imported into the main realm has full DOM access and can read the
session token and everything the app can read. Home Assistant accepts this for
everything; their guidance is to host resources locally and let the risk sit
with the admin who installed the extension. We accept it for **two kinds only**,
and that narrowing is the point of §8.1's table.

For those kinds:

- The install UI names the kind and what it implies, rather than presenting one
  undifferentiated "install extension" button.
- Minisign verification over the manifest, before any public registry exists.
- A layer that only needs to draw should still be written against
  `HcFloorplanLayer` and nothing else — §19.4 applies with more force here, not
  less, because nothing is enforcing it.

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
- **A sandboxed widget's frame must be able to fetch them.** The frame has an
  opaque origin and a `default-src 'none'` policy, so the host admits the asset
  origin into that frame's CSP for `img-src` and `font-src` and nothing else.
  An asset URL a frame cannot load is the failure mode to design against: it
  renders as a broken image with no error anywhere.
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

- Use **`@rive-app/canvas`**, not `@rive-app/webgl2`. Fire tablet GPU/driver
  support is inconsistent; the canvas renderer is the safer default.
- **The runtime is bundled once, in the shell, and never handed to an
  extension.** There is no `ctx.rive`: a sandboxed frame cannot share the host's
  runtime instance, and shipping a copy into every frame costs megabytes per
  widget. Rive is reached the way §10.2 describes — the first-party `hc-rive`
  widget, configured by data. An extension that wants an animated widget ships a
  `.riv` file and a config, which is the point of §10.2 and a *lower* barrier
  than a runtime binding would be.
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

### 11.7 Performance profiles — the Fire tablet problem

- Render heatmaps at **reduced resolution into an offscreen canvas** and scale up.
- Recompute field layers on **state change, not per frame**.
- Gate expensive layers behind a **per-device performance profile** stored as a
  device setting, not a document edit: the wall tablet may get `rooms + markers`
  only, the desktop everything.
- Pause off-viewport Rive marker instances (§10.3).
- Budget: **profile 20 simultaneous Rive markers plus the light-spill layer on
  the real Fire tablet before committing to either.**

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
| Expressions | `hc-expr` (Rhai → wasm) | §6 |
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

The DTCG token file is the root of the visual system and feeds five consumers:

1. Shell CSS (`:root` custom properties, generated at build).
2. `ctx.tokens` for extensions.
3. The **styling contract** (§5.8) — every widget's custom properties default to
   token values, which is what makes card-mod unnecessary.
4. **Floorplan layers** — room fills, wall strokes, marker states, choropleth
   ramps.
5. `/api/tokens.json` — for any future non-web consumer.

Known values: brand `#FFB661`, espresso glyph `#412402`.

State colors (on/off/unavailable/warning/error) and choropleth ramps are
token-defined and must be colorblind-safe. Do not hardcode a rainbow ramp.

This is the one artifact that survives every remaining architectural branch.
Build it first.

---

## 16. Device targets

| Target | Notes |
|---|---|
| Desktop browser (`desktop`) | Primary designer environment |
| Phone (`mobile`) | Viewer; designer read-only/limited |
| Tablet (`tablet`) | Viewer + light editing; primary floorplan surface |
| **Fire tablet (kiosk)** | **The compatibility and performance floor** |
| TV (`tv`) | A breakpoint core already has and this document does not target. Layouts exist; nothing is designed for it yet |

**Fire tablet is the constraint.** Fire OS's Silk/WebView lags mainline Chromium.
Custom Elements v1 and Shadow DOM are fine; anything newer is not assumed.

- Set the Vite `browserslist` target from an **actual Fire tablet UA**.
- Verify before relying on: container queries, `:has()`, Popover API, View
  Transitions, `structuredClone`, `OffscreenCanvas`, `::part()` behaviour.
- Test on the real device from **phase 1**, not at the end. The `hc-expr` wasm
  benchmark (§6.6) happens here.

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
| `POST /api/expr/validate` | Validate/preview an expression (§6.5) |
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
| `GET /api/tokens.json` | Resolved DTCG tokens |

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

hc-web-lit reads and writes `DashboardDefinition` (§14). So does
hc-web-flutter. **Both clients therefore work against the same live documents,
at the same time**, and the new one does not need an authoring surface to be
useful:

- hc-web-lit ships as a **viewer** first. Pages are authored in the Flutter
  designer, which already exists and works, and rendered in either client.
- The Flutter client stays in production and stays the default until the list
  below is done. Nothing is switched off on a date.
- Anything hc-web-lit cannot draw yet is a page you open in the other client.
  A degraded path, not a broken one.

**hc-web-flutter can be retired when all of these are true.** Until then it is
maintained, not deprecated. Note that the bar is **what the product needs**, not
feature-parity with the other client: some of what that client does was shaped
by its own constraints and does not need reproducing, and the first item below
is something it can never do at all (§2).

- [ ] **A third party can ship a widget** — install a `.tar.gz`, place the
      widget, configure it in the GUI, no rebuild. This is the reason the
      project exists, and no amount of parity substitutes for it.
- [ ] Every dashboard in redb renders in hc-web-lit, including plugin widgets
- [ ] Both authoring modes work (§14.1): grid placement, and free composition
      with rotation, groups and decorative elements
- [ ] A floorplan that renders from geometry rather than from a picture (§11.1)
- [ ] Kiosk mode on the real Fire tablet, at the performance budget (§11.7)
- [ ] The rule editor (§21), or an agreed decision that rules stay in the other
      client for now

### 18.3 The phases

**Phase 0 — Walking skeleton and the two risk probes**

The point is a real page from redb on a real screen, in weeks rather than
months, and the two answers that are expensive to get late. **Nothing here is
ABI**: no `hc-extension.json`, no published SDK, no third-party anything.
Widgets written here are expected to be rebuilt in Phase 2 and that is the plan,
not a failure of it.

- [ ] Shell: auth, WebSocket, device store with per-device fan-out
- [ ] Read `DashboardDefinition` and draw one real dashboard from redb
- [ ] `dashboard_layout` reference ported; fixtures green in CI (§5.7) — the one
      piece that is cheaper to get right than to redo, because a wrong
      `normalize` loses edits
- [ ] Three widgets, however they come out: `hc-device`, `hc-light`, `hc-chart`
- [ ] **Probe 1 — `hc-expr` wasm on the Fire tablet** (§6.6, §20.1). Bundle
      size and cold start. This needs only a wasm build and a tablet, and it can
      invalidate §6 entirely; it does not belong behind the primitive set.
- [ ] **Probe 2 — Fire tablet UA captured**, browserslist set, and §16's
      "verify before relying on" list actually verified on the device
- [ ] **Probe 3 — frame cost on the Fire tablet** (§8.1). How many sandboxed
      widgets a dashboard can hold before it stops feeling live. This is the
      standing objection to the sandbox-by-default decision and it deserves a
      number.
- [ ] Deploy it next to the Flutter client and use it for a week

**Phase 1 — Contract & tokens**
- [ ] DTCG token file + build pipeline, including state colors and ramps
- [ ] `@homecore/widget-sdk` skeleton: `HcWidget`, `HcContext`, types
- [ ] `hc-extension.json` schema (incl. `provides`) + validator, Rust side too —
      `provides.widgets[]` entries are `WidgetDescriptor`s (§4.6)
- [ ] Core: `graphical` widget kind + its `validate` branch, so a code widget
      with no portable render is legal when it says so (§4.6)
- [ ] Config-schema vocabulary: `x-hc-picker`, `x-hc-device-type`, `x-hc-asset-kind`,
      `x-hc-picker: room`, `x-hc-picker: device-or-query`, `x-hc-expr`,
      `hc://schema/action` — names checked against
      `hc_types::dashboard_vocabulary`'s naming ratchet
- [ ] Fire tablet UA captured; browserslist set; hello-world verified on device

**Phase 2 — Host primitives** *(§5, plus presentation — before the SDK ships)*
- [ ] Presentation primitive: `is_on`, facet classification, effective name/area (§1.1)
- [ ] **P1** `hc-expr` crate + wasm build — or the restricted-DSL fallback, if
      Probe 1 said so
- [ ] **P1** expression scope, AST caching, dependency-driven re-evaluation
- [ ] **P2** device query type, `/api/query`, live client-side maintenance
- [ ] **P3** template storage, parameter substitution, by-reference instantiation
- [ ] **P4** slot model + chrome suppression rules
- [ ] **P5** overlay stack: sheet, dialog, popover, toast, confirm
- [ ] **P6** layout engine: Phase 0's port finished — four breakpoints, `flow`,
      `frame`, `groups`, fixtures still green (§5.7)
- [ ] **P7** styling contract: custom property naming scheme, `part` conventions,
      SDK lint rule
- [ ] **P8** history/statistics endpoint with LTTB downsampling + client
- [ ] **P9** action model, central dispatch, **safety policy (§11.3) enforced here**
- [ ] Every primitive reachable from `HcContext`, documented, with tests
- [ ] **Exit gate:** Phase 0's three widgets rebuilt on the primitives, with
      nothing reaching around `HcContext`. This is what stops "we'll refactor
      later" from being the thing that never happens — and rebuilding a widget
      that already works is the cheapest possible test of whether the primitive
      set is usable.

**Phase 3 — Extension host + ABI proof**
- [ ] `ext-host`: manifest load, API version gate, module load, error isolation
- [ ] Sandbox host: frame lifecycle, nonce handshake, CSP, grant enforcement
- [ ] **`HcContext` proxied across `postMessage`** — query, overlay, history,
      action, expr, presentation. The gate is Rule 1: a first-party widget must
      be reasonable to write against the proxied context (§8.1)
- [ ] In-realm ESM loader for the two kinds that cannot be framed (§8.1)
- [ ] Asset store endpoints + SVG sanitization + attachments
- [ ] `HcWidgetBase`, `HcLayoutShell` in the SDK
- [ ] **Acceptance gate:** build `hc-button` (§7.4) *first*, as an extension. If
      it needs anything that is not already a primitive, stop and fix Phase 2.
- [ ] **The ABI is published here, and not before.** Everything up to this point
      is ours to change freely; after it, §19.7 applies and a rename is a
      breaking change.

**Phase 4 — Widget vocabulary**
- [ ] The Tier 1 family (§7.3) on the shared layout shell
- [ ] Containers on P4: stack, grid, swipe, tabs, accordion
- [ ] Schema-driven property panel for every widget — no JSON editing required
- [ ] Icon rules engine (shared with the floorplan)
- [ ] i18n scaffolding

**Phase 5 — Dashboards & PWA**
- [ ] Dashboard document schema v1 + migration harness
- [ ] Per-breakpoint layouts; template instances by reference
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
- [ ] **Profile 20 simultaneous instances on the Fire tablet**

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
      `{ tx, ty, k }`, marquee, multi-select
- [ ] **Grid mode:** cell placement, the coarse magnet, one grip, no rotation
- [ ] **Free mode:** `frame` + `rect` + `angle`, eight handles, the fine magnet,
      guides, lift above the grid, groups and group rotation
- [ ] Transform geometry — written against the placement model, gestures working
      from the placement alone so a sandboxed element is transformable without
      being inspectable (§14.2). Read the Dart's for the bugs it names; it has
      no resize-while-rotated and no extension boundary
- [ ] Tool palette with drag-to-create; the catalogue stays but is not the only
      way in (§14.1)
- [ ] Decorative elements: image, icon, text — no device binding, action optional
- [ ] Host-enforced `mode: "edit"`: pointer capture, `ctx.action` refuses to
      dispatch (§14.2)
- [ ] Undo/redo stack
- [ ] Expression editor with `hc-expr` validation and live preview
- [ ] Template authoring UI
- [ ] Device/query picker, asset picker, room picker, extension browser
- [ ] Validate → diff → apply deployment flow

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
13. **Fire tablet is the compatibility and performance floor.**
14. **Dashboards, templates, and spatial documents are versioned** with explicit
    schema versions and migrations.
15. **Offline-capable.** No CDN dependencies at runtime.
16. **The rule editor is a projection of the rule document,** never a separate
    authoring format. There is no rule too complex for the visual editor to
    render — see §21.4.
17. **Rules command; pipelines produce state.** The boundary in §22 is enforced
    by MQTT ACL, not by convention. No feature that blurs it ships in either
    system.
18. **Every capability is expressible as a message** (§3, Rule 3). Most widgets
    run in a frame, so a capability that only works as a shared in-realm object
    is one only the first-party client can have — which is Rule 1 being broken,
    not an exception to it.

---

## 20. Open questions

1. **`hc-expr` wasm cost.** Bundle size and cold start on the Fire tablet. If
   unacceptable, fall back to a restricted DSL — **decide in Phase 2, before
   widgets depend on Rhai syntax.**
2. **Expression evaluation location.** Host-side before `setConfig` covers most
   cases, but state-dependent fields need per-update evaluation. Where is the
   boundary, and does the widget ever call `ctx.expr` directly?
3. **Extension distribution.** Manual upload only, or an eventual registry?
   Affects whether signing is Phase 11 or Phase 3 — and it matters most for the
   in-realm kinds (§8.1), since a sandboxed widget is contained whether or not
   its manifest is signed.
4. ~~**Konva vs tldraw** for the dashboard designer canvas.~~ **Settled:
   neither** (§14). The designer draws real custom elements in a transformed
   DOM scene, because no canvas library can render a sandboxed extension
   document, a Rive artboard, or a third-party custom element. tldraw would
   additionally bring its own shape store, and the document is
   `DashboardDefinition`.
5. **Multi-user.** Do dashboards, templates and floorplans become per-user?
   hc-api plans per-user JWT scopes; all three formats should reserve ownership.
6. **Camera streams.** Confirm the codec/transport path (WebRTC vs HLS vs MJPEG)
   works in Silk before committing `hc-camera` — and decide whether a floorplan
   camera marker shows a live thumbnail or only opens a stream.
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
a parallel group, and a repeat — and open it on the **Fire tablet** at `mobile`
width. If a deep tree becomes unreadable there, a collapse/summary mode is
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
