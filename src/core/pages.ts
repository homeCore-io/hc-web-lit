/**
 * Making and copying a page.
 *
 * Possible at all only since pages moved into this client's own store (§18.2):
 * while they lived in core, creating one meant asking core to hold a document
 * that was never core's. Now it is a write to the same place the icon rules
 * and templates go.
 *
 * **Not the designer** (Phase 10). Placement, dragging and the canvas are that;
 * this is the document management underneath, and it is what the designer will
 * need to exist before it can be built. What it buys today is the authoring
 * loop a household actually has: duplicate the page that nearly does what you
 * want, then edit it with the property panel.
 */
import type {
  DashboardBreakpoint,
  DashboardDefinition,
  DashboardGroupBox,
  DashboardLayout,
  DashboardWidget,
  DashboardWidgetPlacement,
} from './dashboard.js';
import { layoutToDraw } from './dashboard.js';
import type { DashboardRect } from './layout.js';
import { cellsOf } from './geometry.js';
import { groupOf, isUnder, withGroup } from './groups.js';
import { framesByPath, toLocal } from './frames.js';

/**
 * A page id from what somebody typed.
 *
 * Ids are addresses — an `on_tap` names one, and so does a link — so they are
 * lower case, hyphenated and free of anything that has to be escaped. The
 * name keeps whatever was typed; only the id is tidied.
 */
export function pageId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'page';

  if (!taken.includes(base)) return base;
  // A household with two pages called "Upstairs" gets `upstairs` and
  // `upstairs-2`, not a refusal and not a silent overwrite.
  for (let n = 2; ; n++) {
    const tried = `${base}-${n}`;
    if (!taken.includes(tried)) return tried;
  }
}

/**
 * A new page, ready to be edited.
 *
 * **It comes with a heading and a property panel pointed at that heading**,
 * which looks like a strange default until you try the alternative: an empty
 * page cannot be given a widget, because placing one is the designer's job and
 * the designer is Phase 10. A page that ships with the tool for editing itself
 * is the difference between "you can make a page" and "you can make a page and
 * then nothing".
 *
 * One `desktop` layout and no others: `layoutFor` falls back across
 * breakpoints, so a phone draws the desktop arrangement rather than nothing,
 * and writing four copies of one layout would be writing three of them wrong.
 */
export function newPage(
  name: string,
  taken: readonly string[],
  owner: string,
): DashboardDefinition {
  const id = pageId(name, taken);
  const widgets: DashboardWidget[] = [
    { id: 'title', type: 'heading', config: { text: name, level: 'h1' } },
    {
      id: 'panel',
      type: 'property_panel',
      config: { widget: { type: 'heading', config: { text: name, level: 'h1' } }, edits: 'title' },
    },
  ];

  return {
    id,
    name,
    icon: 'home',
    owner_user_id: owner,
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 120,
        gap: 12,
        placements: [
          { widget_id: 'title', x: 0, y: 0, w: 12, h: 1 },
          { widget_id: 'panel', x: 0, y: 1, w: 6, h: 4 },
        ],
      },
    ],
    widgets,
  };
}

/**
 * A copy of a page, under a new id.
 *
 * **The whole document, deeply copied.** A shallow copy shares the widget
 * objects with the original, so editing the copy edits both — and the two are
 * in one array in one store, so it would be saved that way too.
 *
 * Widget ids are kept: they are addresses *within* a page, and a placement
 * refers to one. Renaming them would mean rewriting every placement and every
 * `edits` a panel carries, to fix a collision that cannot happen.
 */
export function duplicatePage(
  doc: DashboardDefinition,
  taken: readonly string[],
  name = `${doc.name} copy`,
): DashboardDefinition {
  const copy = structuredClone(doc) as DashboardDefinition;
  return { ...copy, id: pageId(name, taken), name };
}

/** A widget id that is not already taken on this page. */
function widgetId(type: string, taken: readonly string[]): string {
  const base = type.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  for (let n = 1; ; n++) {
    const tried = `${base}_${n}`;
    if (!taken.includes(tried)) return tried;
  }
}

/**
 * Where a new widget goes in one layout.
 *
 * Below everything else, full-ish width, because the alternative is guessing
 * at a gap somebody left on purpose. Moving it is the designer's job (Phase
 * 10); putting it somewhere visible is this one's.
 */
function placeBelow(layout: DashboardLayout, id: string): DashboardWidgetPlacement {
  const placements = layout.placements ?? [];
  const nextRow = placements.reduce((low, p) => Math.max(low, p.y + p.h), 0);
  const grid = { widget_id: id, x: 0, y: nextRow, w: Math.min(6, layout.columns || 12), h: 2 };

  // A composed page positions by rect and ignores the grid, so a placement
  // with only grid coordinates lands at the top left under everything already
  // there. The grid numbers are still filled in: they are what a client that
  // has never heard of frames draws (§5.7).
  if (layout.flow !== 'free') return grid;

  const bottom = placements.reduce(
    (low, p) => Math.max(low, (p.rect?.y ?? 0) + (p.rect?.h ?? 0)),
    0,
  );
  return { ...grid, rect: { x: 0, y: bottom + (layout.gap || 12), w: 360, h: 200 } };
}

/**
 * The page with a widget added, and the id it was given.
 *
 * **A placement in every layout the page has, not just the one on screen.**
 * A document with a desktop and a mobile layout that gained a widget in one of
 * them is a page where a phone silently shows less than a laptop — and nobody
 * finds out until they pick up a phone. Where they *sit* can differ per size;
 * whether they exist cannot.
 *
 * The config is empty. Almost every type needs one — a device, a heading, a
 * selection — and inventing a plausible one would mean a widget that looks
 * configured and points at nothing. It draws as its own "nothing to show"
 * until somebody fills it in, which is the honest first frame.
 */
export function addWidget(
  doc: DashboardDefinition,
  type: string,
): { doc: DashboardDefinition; id: string } {
  const id = widgetId(
    type,
    (doc.widgets ?? []).map((w) => w.id),
  );
  const widget: DashboardWidget = { id, type, config: {} };

  return {
    id,
    doc: {
      ...doc,
      widgets: [...(doc.widgets ?? []), widget],
      layouts: (doc.layouts ?? []).map((l) => ({
        ...l,
        placements: [...(l.placements ?? []), placeBelow(l, id)],
      })),
    },
  };
}

/**
 * The page with several widgets moved into (or out of) groups.
 *
 * One function for grouping, ungrouping and renaming, because all three are
 * the same edit: a map of widget id to the path it should now carry, applied
 * in one document so the whole regrouping is one step to undo. Doing them one
 * at a time would leave a cluster half-grouped as a state somebody could undo
 * back to, which is an arrangement that never existed.
 *
 * A path of `undefined` takes the key out entirely (`withGroup`), so grouping
 * and then ungrouping leaves the document exactly as it was found.
 *
 * **Widgets, not placements.** A group is a property of the element and not of
 * the arrangement (§14.1's rule for `layer`, and the same reasoning): a cluster
 * held together on the wall is held together on the phone, so it lives in the
 * widget's config where there is one copy of it rather than one per layout.
 */
export function regroupWidgets(
  doc: DashboardDefinition,
  paths: ReadonlyMap<string, string | undefined>,
): DashboardDefinition {
  return {
    ...doc,
    widgets: (doc.widgets ?? []).map((w) =>
      paths.has(w.id) ? { ...w, config: withGroup(w.config, paths.get(w.id)) } : w,
    ),
  };
}

/**
 * The page without a widget, and without its placements.
 *
 * Both halves, because a placement naming a widget that is not there is a
 * document core would still store and every client would draw as nothing —
 * a gap in a page with no way to tell why.
 */
export function removeWidget(doc: DashboardDefinition, id: string): DashboardDefinition {
  return {
    ...doc,
    widgets: (doc.widgets ?? []).filter((w) => w.id !== id),
    layouts: (doc.layouts ?? []).map((l) => ({
      ...l,
      placements: (l.placements ?? []).filter((p) => p.widget_id !== id),
    })),
  };
}

/**
 * The page under another name.
 *
 * **The id does not move.** It is an address — an `on_tap` targets one, a
 * `dashboard_link` lists them — so renaming a page that others link to would
 * break the links to fix a label. The name is what a person reads and the id
 * is what a document refers to, which is the split §1.1 makes for devices one
 * level up.
 *
 * `undefined` for a name that is blank or unchanged, so a caller can leave the
 * store alone rather than writing a document that says the same thing.
 */
export function renamed(doc: DashboardDefinition, name: string): DashboardDefinition | undefined {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === doc.name) return undefined;
  return { ...doc, name: trimmed };
}

/** Where a widget sits, in whatever units its layout uses. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Move or resize a widget, in the layout that is actually on screen.
 *
 * **The layout being drawn, which is not always the one for this size.**
 * Three of the four pages in the reference house carry a `desktop` layout and
 * nothing else, and a phone borrows it (§5.7). Writing the numbers into a new
 * `mobile` layout instead would silently split one arrangement into two — the
 * page would stop following the desktop one, and nobody asked for a
 * per-breakpoint design by dragging something on a phone. So an edit lands
 * where the numbers came from, and the surface says which size that is.
 *
 * The units are the layout's own: cells on a packed page, pixels in the frame
 * on a composed one. A composed page ignores the grid entirely, so writing
 * cells there would move nothing and look broken.
 *
 * `undefined` when there is no such widget in that layout, so a caller can say
 * so rather than writing a document that changed nothing.
 */
export function placeWidget(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  widgetId: string,
  box: Box,
): DashboardDefinition | undefined {
  return placeWidgets(doc, breakpoint, new Map([[widgetId, box]]));
}

/**
 * Move several widgets at once, in the layout that is actually on screen.
 *
 * **One document, not one per widget.** Dragging six selected cards is one
 * thing a person did, and six writes would be six entries in the undo stack —
 * five of them states nobody ever saw, with the page half-moved. It is also
 * five more saves to the household's store than the gesture deserves.
 *
 * Everything `placeWidget` says about *which* layout an edit lands in applies
 * unchanged; this is that function with more than one placement in it.
 *
 * Ids the drawn layout does not have are skipped rather than refused, because
 * a selection outlives the thing it points at: a widget removed in another
 * window is a stale id in a set, and losing the other five moves to it would
 * be the wrong trade. `undefined` only when *none* of them landed, so a caller
 * can still tell "nothing happened" from "something did".
 */
export function placeWidgets(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  moves: ReadonlyMap<string, Box>,
): DashboardDefinition | undefined {
  const changes = new Map<string, Change>();
  for (const [id, box] of moves) changes.set(id, { box });
  return transformWidgets(doc, breakpoint, changes);
}

/** A rectangle, an angle, or both — whatever one gesture actually changed. */
export interface Change {
  box?: Box;
  angle?: number;
}

/**
 * Move, resize and turn several widgets, in the layout that is on screen.
 *
 * **One function because a group rotation is one gesture that changes both.**
 * Turning a cluster orbits every member *and* turns it, so a rect write and an
 * angle write that were separate would be two documents and two undo steps for
 * a thing somebody did once — with the half-turned arrangement in between as a
 * state they could land on, which never existed.
 *
 * Everything `placeWidget` says about which layout an edit lands in applies
 * unchanged.
 */
export function transformWidgets(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  changes: ReadonlyMap<string, Change>,
): DashboardDefinition | undefined {
  const drawn = layoutToDraw(doc, breakpoint);
  if (drawn === undefined) return undefined;

  const editing = drawn.borrowedFrom ?? breakpoint;
  const layout = (doc.layouts ?? []).find((l) => l.breakpoint === editing);
  if (layout === undefined) return undefined;

  const placements = layout.placements ?? [];
  if (!placements.some((p) => changes.has(p.widget_id))) return undefined;

  // Which group each widget is in, for the frame-space conversion below.
  const byId = new Map((doc.widgets ?? []).map((w) => [w.id, w.config]));

  const move = (p: DashboardWidgetPlacement): DashboardWidgetPlacement => {
    const change = changes.get(p.widget_id);
    if (change === undefined) return p;

    // An angle is a composed idea only: a packed card's position is cells, an
    // angle is not expressible in them, and grid mode has no rotation (§14.1).
    const turned =
      layout.flow === 'free' && change.angle !== undefined
        ? { angle: ((change.angle % 360) + 360) % 360 || null }
        : {};

    const box = change.box;
    if (box === undefined) return { ...p, ...turned };
    if (layout.flow !== 'free') return { ...p, x: box.x, y: box.y, w: box.w, h: box.h };

    // **The cells follow the rectangle.** Core validates the cells and knows
    // nothing about frames, so a composed edit that left them behind would
    // save a page whose fallback says where the card used to be — and would
    // eventually save one core rejects, with the failure arriving at save time
    // talking about columns. This is the safety property of storing both
    // (§14.3): a client that has never heard of frames draws these and gets a
    // page that is approximately right rather than blank.
    // **The write half of the frame seam**, the exact inverse of the read in
    // `gridItems`. Every gesture works in page coordinates; a document states
    // a rectangle in its frame's space. One place converts, so no gesture has
    // to know frames exist — and the round trip is what keeps a card inside a
    // frame from leaping to the page origin the first time it is nudged.
    const frames = framesByPath(layout.groups);
    const local = toLocal({ ...(p.rect ?? {}), ...box }, groupOf(byId.get(p.widget_id)), frames);
    const rect = { ...(p.rect ?? {}), ...local };
    const frame = layout.frame;
    if (frame == null) return { ...p, ...turned, rect };
    return {
      ...p,
      ...turned,
      rect,
      ...cellsOf(rect, {
        width: frame.width,
        columns: layout.columns,
        rowHeight: layout.row_height,
        gap: layout.gap,
      }),
    };
  };

  return {
    ...doc,
    layouts: (doc.layouts ?? []).map((l) =>
      l.breakpoint === editing ? { ...l, placements: placements.map(move) } : l,
    ),
  };
}

/**
 * Turn a widget, in the layout that is actually on screen.
 *
 * Separate from placing it, because it is a separate edit: a rectangle and an
 * angle are stored side by side (§14.3), and folding the angle into `Box`
 * would put a field on every grid move that a packed page has no use for —
 * §14.1 gives grid mode no rotation at all.
 *
 * Only a composed layout, for the same reason. A packed card's position is
 * cells, an angle is not expressible in them, and a client drawing the cells
 * would show a rotated card square with no hint that it was ever turned.
 */
export function turnWidget(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  widgetId: string,
  angle: number,
): DashboardDefinition | undefined {
  const drawn = layoutToDraw(doc, breakpoint);
  if (drawn === undefined) return undefined;

  const editing = drawn.borrowedFrom ?? breakpoint;
  const layout = (doc.layouts ?? []).find((l) => l.breakpoint === editing);
  if (layout === undefined || layout.flow !== 'free') return undefined;
  if (!(layout.placements ?? []).some((p) => p.widget_id === widgetId)) return undefined;

  // One spelling per angle, and `null` for a card that is straight — which is
  // how this schema spells absence everywhere else (`rect`), and keeps a card
  // that was turned and turned back from carrying a `0` forever.
  const turned = ((angle % 360) + 360) % 360 || null;

  return {
    ...doc,
    layouts: (doc.layouts ?? []).map((l) =>
      l.breakpoint === editing
        ? {
            ...l,
            placements: (l.placements ?? []).map((p) =>
              p.widget_id === widgetId ? { ...p, angle: turned } : p,
            ),
          }
        : l,
    ),
  };
}

/** Where a widget sits now, and in what units, for a surface that shows it. */
export function boxOf(
  layout: DashboardLayout | undefined,
  widgetId: string,
): { box: Box; units: 'cells' | 'pixels' } | undefined {
  const placement = (layout?.placements ?? []).find((p) => p.widget_id === widgetId);
  if (placement === undefined || layout === undefined) return undefined;

  if (layout.flow === 'free' && placement.rect != null) {
    const r = placement.rect;
    return { box: { x: r.x, y: r.y, w: r.w, h: r.h }, units: 'pixels' };
  }
  const { x, y, w, h } = placement;
  return { box: { x, y, w, h }, units: 'cells' };
}

/**
 * A group given a body, changed from one kind of body to the other, or turned
 * back into a plain tag.
 *
 * **The gap this closes is a stated constraint, not a nicety.** §19.9 says
 * every option is GUI-editable and no widget ships that requires hand-editing
 * JSON — and the nine sections on this household's room page were made by
 * editing the document by hand, because Group and Ungroup write a *tag* and
 * nothing in the product could give one a body (§14.2b).
 *
 * **Reversible, exactly.** Stacking adds the box and restates every member's
 * rectangle in the new space; unstacking removes it and adds the origin back.
 * No member's size, order or relative position moves, so stack-then-unstack
 * leaves the document byte-identical — the same invariant group-then-ungroup
 * already keeps, and the reason a household can try this on a real page
 * without wondering what it cost.
 *
 * The gap between the rows is the one thing that has to be *chosen* rather
 * than carried, because a column spaces its members evenly and the drawn ones
 * are not. The median of the gaps their author actually drew is the closest a
 * single number gets to what was there. A band chooses nothing: it leaves its
 * members exactly where they are and takes its height from them.
 *
 * **Two kinds, because a page needs both.** A column is a section — one thing
 * under another, growing as it fills. A band is a row of things side by side
 * that is still as tall as what is in it, which is what the house's footer is
 * and what no amount of column would express. They are two keys on the same
 * box, so changing between them moves nothing: a member's rect is stated in
 * the box's space either way, a column ignores the tops and a band honours
 * them, and switching back gets the arrangement it started with.
 *
 * `undefined` when there is nothing to do — no such layout, no members, or the
 * group is already the way it was asked to be — so a caller can leave the
 * document alone rather than write an identical one.
 */
export type Body = 'column' | 'band';

export function frameGroup(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  path: string,
  as: Body | undefined,
): DashboardDefinition | undefined {
  const drawn = layoutToDraw(doc, breakpoint);
  if (drawn === undefined) return undefined;
  const editing = drawn.borrowedFrom ?? breakpoint;
  const layout = (doc.layouts ?? []).find((l) => l.breakpoint === editing);
  // Composed only: a column of rectangles is not expressible in packed cells,
  // and grid mode has an engine that would immediately undo it (§14.1).
  if (layout === undefined || layout.flow !== 'free') return undefined;

  const boxes = layout.groups ?? [];
  const existing = boxes.find((b) => b.path === path);
  const now: Body | undefined =
    existing?.frame !== true || existing.rect == null
      ? undefined
      : existing.stack === true
        ? 'column'
        : 'band';
  if (now === as) return undefined;

  const mine = new Set(
    (doc.widgets ?? [])
      .filter((w) => {
        const at = groupOf(w.config);
        return at !== undefined && (at === path || isUnder(at, path));
      })
      .map((w) => w.id),
  );
  if (mine.size === 0) return undefined;

  const shift = (by: { x: number; y: number }): DashboardWidgetPlacement[] =>
    (layout.placements ?? []).map((p) =>
      !mine.has(p.widget_id) || p.rect == null
        ? p
        : { ...p, rect: { ...p.rect, x: p.rect.x + by.x, y: p.rect.y + by.y } },
    );

  const within = (
    groups: DashboardGroupBox[],
    places: DashboardWidgetPlacement[],
  ): DashboardLayout => ({ ...layout, groups, placements: places });

  const swap = (next: DashboardLayout): DashboardDefinition => ({
    ...doc,
    layouts: (doc.layouts ?? []).map((l) => (l.breakpoint === editing ? next : l)),
  });

  if (as === undefined) {
    const rect = existing?.rect;
    if (rect == null) return undefined;
    return swap(
      within(
        boxes.filter((b) => b.path !== path),
        shift({ x: rect.x, y: rect.y }),
      ),
    );
  }

  // **Changing how a body lays out moves nothing at all.** A member's rect is
  // stated in the box's space either way — a column ignores the tops and a
  // band honours them — so switching between the two is two keys and no
  // arithmetic, and switching back gets the arrangement it started with.
  if (now !== undefined && existing?.rect != null) {
    const same: DashboardGroupBox = {
      ...existing,
      frame: true,
      ...(as === 'column'
        ? { stack: true, stack_gap: existing.stack_gap ?? 12, fit: null }
        : { stack: false, fit: 'content' as const }),
    };
    return swap(
      within(
        boxes.map((b) => (b.path === path ? same : b)),
        layout.placements ?? [],
      ),
    );
  }

  // The members' own rectangles, which are already stated in the space this
  // box will sit in — so their bounding box is the box, with nothing to
  // convert on the way in.
  const rects = (layout.placements ?? [])
    .filter((p) => mine.has(p.widget_id) && p.rect != null)
    .map((p) => p.rect as DashboardRect);
  if (rects.length === 0) return undefined;

  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x;
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y;

  const box: DashboardGroupBox = {
    ...(existing ?? { path }),
    rect: { x, y, w, h },
    frame: true,
    padding: existing?.padding ?? 0,
    // A column decides where its members go and needs a gap; a band leaves
    // them where they are and needs a height, which is a measurement of them
    // (§14.2b).
    ...(as === 'column'
      ? { stack: true, stack_gap: drawnGap(rects) }
      : { fit: 'content' as const }),
  };

  return swap(within([...boxes.filter((b) => b.path !== path), box], shift({ x: -x, y: -y })));
}

/**
 * The gap a column should use, from the gaps its members were drawn with.
 *
 * The median rather than the mean, because one member drawn a long way below
 * the rest — a footer under a list, a heading with air over it — would drag an
 * average somewhere nothing actually is. Negative gaps are overlaps and count
 * as nothing.
 */
function drawnGap(rects: readonly DashboardRect[]): number {
  const sorted = [...rects].sort((a, b) => a.y - b.y);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const above = sorted[i - 1];
    const below = sorted[i];
    if (above === undefined || below === undefined) continue;
    gaps.push(Math.max(0, below.y - (above.y + above.h)));
  }
  if (gaps.length === 0) return 12;
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)] ?? 12;
  return Math.round(mid);
}

/**
 * A container moved, by writing its box rather than everything inside it.
 *
 * **What a drag on a whole section used to do was rewrite its contents.** One
 * delta applied to every member, which is right for a cluster of cards and
 * exactly wrong for a container: a member's rectangle is stated in the
 * container's space, so moving all of them moves them *within* it and leaves
 * the box where it was. On a column it did not even show — a column ignores
 * its members' tops — so the gesture read as having failed while quietly
 * rewriting three rectangles.
 *
 * What the new rect *means* is the parent's business, and both readings are
 * the same write. A container on the page moves to where it was dragged. A
 * container in a column is ordered by its stored top, so dragging it up or
 * down moves it up or down the column — which is reordering, and is the same
 * thing a card in a column already does.
 */
export function moveGroupBox(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  path: string,
  by: { x: number; y: number },
): DashboardDefinition | undefined {
  const drawn = layoutToDraw(doc, breakpoint);
  if (drawn === undefined) return undefined;
  const editing = drawn.borrowedFrom ?? breakpoint;
  const layout = (doc.layouts ?? []).find((l) => l.breakpoint === editing);
  if (layout === undefined) return undefined;

  const box = (layout.groups ?? []).find((b) => b.path === path);
  const rect = box?.rect;
  if (box === undefined || rect == null) return undefined;
  if (by.x === 0 && by.y === 0) return undefined;

  const moved: DashboardGroupBox = {
    ...box,
    rect: { ...rect, x: Math.round(rect.x + by.x), y: Math.round(rect.y + by.y) },
  };
  return {
    ...doc,
    layouts: (doc.layouts ?? []).map((l) =>
      l.breakpoint === editing
        ? { ...l, groups: (l.groups ?? []).map((b) => (b.path === path ? moved : b)) }
        : l,
    ),
  };
}

/**
 * A container resized, which is again one write to its box.
 *
 * Only meaningful where the page positions the container: a container in a
 * column takes its width from the column and its height from its contents, so
 * there is nothing there to resize and the surface does not offer the grips
 * (§5.11 — not offered rather than offered and refused).
 *
 * The members are untouched, and this time that is not only correctness but
 * the point of the gesture: narrowing a column is how a set of rows goes from
 * three across to two, and the rows have no say in it.
 */
export function sizeGroupBox(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
  path: string,
  rect: { x: number; y: number; w: number; h: number },
): DashboardDefinition | undefined {
  const drawn = layoutToDraw(doc, breakpoint);
  if (drawn === undefined) return undefined;
  const editing = drawn.borrowedFrom ?? breakpoint;
  const layout = (doc.layouts ?? []).find((l) => l.breakpoint === editing);
  if (layout === undefined) return undefined;

  const box = (layout.groups ?? []).find((b) => b.path === path);
  const was = box?.rect;
  if (box === undefined || was == null) return undefined;

  const next = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.max(1, Math.round(rect.w)),
    h: Math.max(1, Math.round(rect.h)),
  };
  if (next.x === was.x && next.y === was.y && next.w === was.w && next.h === was.h) {
    return undefined;
  }

  return {
    ...doc,
    layouts: (doc.layouts ?? []).map((l) =>
      l.breakpoint === editing
        ? {
            ...l,
            groups: (l.groups ?? []).map((b) => (b.path === path ? { ...b, rect: next } : b)),
          }
        : l,
    ),
  };
}
