---
name: homecore-designer-shell
description: Layout, interaction model, and invariants for the homeCore dashboard designer — an application shell with a canvas viewport, NOT a web page with a canvas in it. Read this before writing or modifying any designer UI, tool, panel, or canvas code.
---

# hc-designer — Designer Shell Specification

> Companion to `HC_WEB_UI_ARCHITECTURE.md` (§14, §18 Phase 10) and
> `HC_PIPELINE_ARCHITECTURE.md` (§12). Covers the **dashboard designer**; the
> pipeline graph editor follows the same shell with a different centre surface.
>
> Usable as-is as a Claude Code skill — the frontmatter above is the skill
> header. Drop it in `.claude/skills/homecore-designer-shell/SKILL.md` so it
> loads without prompting.

---

## 0. Read this first

**The designer is an application shell, not a web page.**

A web page is a *document*: it flows, it scrolls, its height is content-driven.
A design tool is an *application*: fixed viewport, never scrolls, panels pinned
to the edges, and exactly one transformable surface in the middle.

If you catch yourself producing a header, a sidebar, a scrolling content column,
and cards — stop. That is the admin-dashboard shape, and it is the single most
common failure mode when building this screen. It is wrong here.

**Reference tools:** Figma, Affinity Designer, Blender's 2D workspaces. When a
decision is ambiguous, ask "how does Figma do this," not "how does a web app do
this."

**Target:** desktop browser only. Mouse and keyboard are assumed. Do **not**
add responsive breakpoints, mobile layouts, or touch-first affordances — the
viewer is the responsive surface, the designer is not. Responsive handling here
muddies the layout and buys nothing.

---

## 1. Shell anatomy

```
┌──────────────────────────────────────────────────────────────────┐
│ APP BAR   ⌂ · file · edit · view   |  document title  |  zoom ⌄  │  40px
│                                                        deploy ▸  │  fixed
├────┬──────────────────┬───────────────────────┬──────────────────┤
│    │                  │                       │                  │
│ T  │  LAYERS          │   VIEWPORT            │  INSPECTOR       │
│ O  │  object tree     │   overflow: hidden    │                  │
│ O  │  z-order, lock,  │   no scrollbars       │  context to      │
│ L  │  hide, rename    │                       │  selection:      │
│    │                  │   ┌───────────────┐   │   0 → document   │
│ R  ├──────────────────┤   │   SCENE       │   │   1 → object     │
│ A  │                  │   │   pan/zoom    │   │   n → common     │
│ I  │  PAGES /         │   │   transform   │   │                  │
│ L  │  BREAKPOINTS     │   └───────────────┘   │  align/distribute│
│    │  sm · md · lg    │                       │  arrange         │
│40px│                  │   OVERLAY (screen sp) │                  │
│    │                  │   handles, guides,    │  ~280px          │
│    │  ~240px          │   marquee, labels     │  resizable       │
│    │  resizable       │                       │                  │
├────┴──────────────────┴───────────────────────┴──────────────────┤
│ STATUS   87%  ·  x 412 y 190  ·  snap ▣  grid ▣  ·  2 selected   │  28px
└──────────────────────────────────────────────────────────────────┘
```

### Regions

| Region | Size | Notes |
|---|---|---|
| App bar | 40px, fixed | Menus, doc title, zoom control, deploy action |
| Tool rail | 40px, fixed | Icon-only, vertical, one active tool |
| Left panel | ~240px, resizable, collapsible | Layers tree + pages/breakpoints |
| Viewport | fills remaining | `overflow: hidden`. The only transformable region |
| Inspector | ~280px, resizable, collapsible | Selection-driven |
| Status bar | 28px, fixed | Zoom, pointer position, toggles, selection count |

Collapsing or resizing a panel **must not** change canvas scroll position or
zoom. The scene transform is independent of panel geometry.

---

## 2. The three-layer viewport

This is the part that most often gets built wrong. The viewport is not one
element — it is three stacked layers:

```
┌─ viewport (position: relative; overflow: hidden) ─────────┐
│                                                            │
│  ┌─ 1. BACKDROP ──────────────────────────────────────┐   │
│  │    grid / dot pattern, transformed with the scene  │   │
│  └────────────────────────────────────────────────────┘   │
│  ┌─ 2. SCENE (transform: translate(x,y) scale(k)) ────┐   │
│  │    widgets, artboards, geometry — world space      │   │
│  └────────────────────────────────────────────────────┘   │
│  ┌─ 3. OVERLAY (NO transform — screen space) ─────────┐   │
│  │    selection handles, rotation handle, snap guides,│   │
│  │    marquee rect, measurement labels, hover outline │   │
│  └────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

**The overlay is the single clearest tell between a real design tool and a fake
one.** Handles, guides, and labels are drawn in **screen space at constant pixel
size** regardless of zoom. An 8px handle is 8px at 25% and at 400%.

The common mistake — putting handles inside the transformed scene group — makes
them shrink and grow with zoom, and it reads as broken immediately.

Overlay geometry is computed by projecting world coordinates through the current
transform each frame:

```ts
const toScreen = (p: WorldPoint): ScreenPoint => ({
  x: p.x * k + tx,
  y: p.y * k + ty,
});
const toWorld = (p: ScreenPoint): WorldPoint => ({
  x: (p.x - tx) / k,
  y: (p.y - ty) / k,
});
```

Keep exactly one source of truth for `{ tx, ty, k }`. Every layer and every hit
test derives from it. Never store a second copy.

---

## 3. Non-negotiable invariants

Check every one of these before considering designer UI done. They are
verifiable, which is why they are written as rules rather than adjectives.

### Layout

1. `html, body { height: 100%; overflow: hidden; }` — the page never scrolls.
2. The shell is a `100dvh` CSS Grid with named areas. Not flexbox chains, not
   absolute positioning, not nested scroll containers.
3. Only the viewport transforms. Panels are fixed geometry.
4. Panels scroll internally when their content overflows; the shell does not.
5. No `max-width` container, no centred content column, no page margins.

### Viewport

6. The viewport has `overflow: hidden` and **no scrollbars, ever**. A scrollbar
   on the canvas means the model is wrong.
7. Pan and zoom are transform operations, never scroll operations.
8. Selection handles, guides, marquee, and measurement labels render at constant
   screen size at all zoom levels.
9. Zoom is anchored to the pointer (or to the pinch centroid), not to the
   viewport origin.
10. Zoom range is clamped — 5% to 1600% — and the current value is always
    displayed in the status bar.

### Interaction

11. Tools are a **state machine** with exactly one active tool. The cursor
    reflects the active tool.
12. Every tool has a single-key shortcut. Holding a modifier for a temporary
    tool (space = hand) restores the previous tool on release.
13. Undo/redo is a **command stack** — each mutation is an object with `do()`
    and `undo()`. Not state snapshots, not a serialized-document history.
14. Every mutation goes through the command stack. If a code path mutates the
    document directly, that is a bug.
15. Nothing is modal without an escape. `Esc` cancels the current drag, clears
    selection, or exits the active tool, in that order of precedence.

### Panels

16. The inspector renders a correct **empty state** (0 selected → document
    properties) and **multi-selection state** (n selected → shared properties
    with mixed-value indicators). A blank div is not acceptable.
17. The layers tree supports reorder-by-drag, rename in place, lock, and hide.
18. Panel collapse/resize never affects the scene transform.

### Quality floor

19. Visible keyboard focus on every interactive element, including canvas
    objects reached by Tab.
20. All colors, spacing, and radii come from the DTCG tokens
    (`HC_WEB_UI_ARCHITECTURE.md` §15). No hardcoded hex in designer code.
21. Reduced motion respected — snap guides and selection feedback must not
    animate when `prefers-reduced-motion` is set.

---

## 4. Tool state machine

```ts
type ToolId = "select" | "hand" | "region" | "text" | "measure" | "zoom";

interface Tool {
  id: ToolId;
  cursor: string;
  onPointerDown(e: CanvasPointerEvent, ctx: ToolCtx): void;
  onPointerMove(e: CanvasPointerEvent, ctx: ToolCtx): void;
  onPointerUp(e: CanvasPointerEvent, ctx: ToolCtx): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolCtx): boolean;   // true = handled
  onActivate?(ctx: ToolCtx): void;
  onDeactivate?(ctx: ToolCtx): void;                     // must clean up
}
```

`CanvasPointerEvent` carries **both** world and screen coordinates, already
converted. Tools never do their own transform math — that is how the two copies
of the transform get out of sync.

Rules:

- Exactly one active tool. Switching calls `onDeactivate` then `onActivate`.
- A tool that starts a drag owns the pointer until `pointerup` or `Esc`.
- Temporary tool override (space-hold) pushes onto a stack and pops on release.
- Tools do not mutate the document directly — they push commands.

---

## 5. Keyboard shortcuts

Ship all of these. A design tool without them does not feel like one, and this
is the cheapest possible way to make the shell read correctly.

### Tools
| Key | Tool |
|---|---|
| `V` | Select |
| `H` | Hand (pan) |
| `R` | Region / draw area |
| `T` | Text |
| `M` | Measure |
| `Z` | Zoom |
| `Space` (hold) | Temporary hand |

### View
| Shortcut | Action |
|---|---|
| `Ctrl/Cmd` + `+` / `-` | Zoom in / out |
| `Ctrl/Cmd` + `0` | Zoom to 100% |
| `Ctrl/Cmd` + `1` | Zoom to fit document |
| `Ctrl/Cmd` + `2` | Zoom to fit selection |
| `Ctrl/Cmd` + wheel | Zoom at pointer |
| Wheel / two-finger | Pan vertically |
| `Shift` + wheel | Pan horizontally |
| Middle-drag | Pan |
| `Ctrl/Cmd` + `'` | Toggle grid |
| `Ctrl/Cmd` + `;` | Toggle guides |
| `Shift` + `Ctrl/Cmd` + `'` | Toggle snapping |

### Selection & editing
| Shortcut | Action |
|---|---|
| Click | Select |
| `Shift` + click | Add / remove from selection |
| Drag on empty canvas | Marquee select |
| `Ctrl/Cmd` + `A` | Select all |
| `Esc` | Cancel drag → clear selection → exit tool |
| Arrows | Nudge 1 unit |
| `Shift` + arrows | Nudge 10 units |
| `Ctrl/Cmd` + `D` | Duplicate |
| `Delete` / `Backspace` | Delete |
| `Ctrl/Cmd` + `G` / `Shift`+`G` | Group / ungroup |
| `Ctrl/Cmd` + `Z` / `Shift`+`Z` | Undo / redo |
| `Ctrl/Cmd` + `]` / `[` | Bring forward / send backward |
| `Alt` + drag | Duplicate-drag |
| `Shift` + drag | Constrain to axis |

---

## 6. Snapping and guides

Snapping is what makes a canvas feel precise rather than approximate. Three
sources, each independently toggleable:

1. **Grid** — configurable step, matching the dashboard's column grid so
   designer output lands on valid layout positions.
2. **Objects** — edges and centres of other objects.
3. **Guides** — user-dragged rulers.

Behaviour:

- Threshold is a **screen-space** distance (~6px), so snapping feels identical
  at every zoom level. A world-space threshold makes snapping unusable when
  zoomed out.
- Alignment guides appear **during** the drag, not after. They render on the
  overlay layer.
- Show the measurement when a snap is active — the distance between the snapped
  edges, in world units.
- Holding a modifier suspends snapping for the duration of the drag.

---

## 7. Shell skeleton

Start from this. Build and commit the shell **alone**, with empty panels, before
any feature exists.

```html
<div class="hc-designer">
  <header class="app-bar">   <!-- menus, title, zoom, deploy --> </header>
  <nav    class="tool-rail"> <!-- icon buttons, one active   --> </nav>
  <aside  class="panel-left">
    <section class="layers"><!-- object tree --></section>
    <section class="pages"><!-- breakpoints --></section>
  </aside>
  <main   class="viewport">
    <div class="backdrop"></div>
    <div class="scene"></div>
    <svg class="overlay"></svg>
  </main>
  <aside  class="panel-right"><!-- inspector --></aside>
  <footer class="status-bar"><!-- zoom, coords, toggles --></footer>
</div>
```

```css
html, body { height: 100%; margin: 0; overflow: hidden; }

.hc-designer {
  display: grid;
  height: 100dvh;
  grid-template-columns:
    var(--rail-w, 40px)
    var(--panel-left-w, 240px)
    1fr
    var(--panel-right-w, 280px);
  grid-template-rows: var(--appbar-h, 40px) 1fr var(--status-h, 28px);
  grid-template-areas:
    "appbar appbar     appbar   appbar"
    "rail   panelleft  viewport panelright"
    "status status     status   status";
  background: var(--hc-surface-base);
  color: var(--hc-text-primary);
}

.app-bar     { grid-area: appbar;     }
.tool-rail   { grid-area: rail;       }
.panel-left  { grid-area: panelleft;  overflow: auto; }
.viewport    { grid-area: viewport;   position: relative; overflow: hidden;
                                       contain: strict; touch-action: none; }
.panel-right { grid-area: panelright; overflow: auto; }
.status-bar  { grid-area: status;     }

.backdrop, .scene, .overlay {
  position: absolute; inset: 0;
}
.scene {
  transform-origin: 0 0;
  /* transform set imperatively: translate(tx,ty) scale(k) */
  will-change: transform;
}
.overlay {
  /* NEVER transformed. Screen space only. */
  pointer-events: none;
}
```

Panel widths are CSS custom properties so the resize handles write to one place
and the grid recomputes. Do not implement panel resizing with JS width
assignment on the elements.

---

## 8. Build order

The reason designer layouts come out wrong is that they get invented fresh on
every request. Invert that: build the skeleton once, then every later task is
filling it in.

1. **Shell only.** Grid regions, empty panels, no features. Verify against §3.
   Commit.
2. **Viewport transform.** Pan and zoom, the three layers, the status bar
   readout. No objects yet. Verify handles-at-constant-size with a test rect.
3. **Command stack.** Before any mutation exists, so nothing can bypass it.
4. **Select tool + overlay.** Hit test, selection state, handles, marquee.
5. **Inspector.** Empty, single, and multi-selection states.
6. **Layers panel.** Tree, reorder, lock, hide, rename.
7. **Transform ops.** Move, resize, rotate — each as a command.
8. **Snapping and guides.**
9. **Remaining tools.**
10. **Feature work** — widget placement, property panels, deploy flow.

After step 1, phrase every request as "add X to the shell," not "build a
designer with X." Filling a given skeleton is a task these tools do well;
inventing the skeleton is where they reach for the admin-dashboard prior.

---

## 9. Failure modes to check for

If any of these appear, the shell has drifted back toward a web page:

- A scrollbar anywhere except inside a panel
- Selection handles that change size when zooming
- The page scrolling instead of the canvas panning
- A centred, max-width content column
- Cards with soft shadows as the primary structural device
- The inspector rendering blank with nothing selected
- Responsive breakpoints or a mobile layout
- Two places that store the pan/zoom transform
- A mutation that does not go through the command stack
- Snapping that feels sticky when zoomed out (world-space threshold)
- `Esc` doing nothing

---

## 10. Pipeline editor variant

The pipeline graph editor (`HC_PIPELINE_ARCHITECTURE.md` §12) uses this same
shell. Differences:

| Region | Dashboard designer | Pipeline editor |
|---|---|---|
| Scene | Widgets on a layout grid | Nodes and edges |
| Left panel | Layers + breakpoints | Node palette (searchable) + pipeline list |
| Inspector | Widget properties | Node config (schema-driven) + live sample output |
| Status bar | Zoom, coords, snap | Zoom, message counters, fixture pass/fail |
| Extra | — | Minimap, auto-layout button |

Everything in §2 through §6 applies unchanged. Do not build a second shell.
