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
  DashboardLayout,
  DashboardWidget,
  DashboardWidgetPlacement,
} from './dashboard.js';
import { layoutToDraw } from './dashboard.js';
import { cellsOf } from './geometry.js';
import { withGroup } from './groups.js';

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
  const drawn = layoutToDraw(doc, breakpoint);
  if (drawn === undefined) return undefined;

  const editing = drawn.borrowedFrom ?? breakpoint;
  const layout = (doc.layouts ?? []).find((l) => l.breakpoint === editing);
  if (layout === undefined) return undefined;

  const placements = layout.placements ?? [];
  if (!placements.some((p) => moves.has(p.widget_id))) return undefined;

  const move = (p: DashboardWidgetPlacement): DashboardWidgetPlacement => {
    const box = moves.get(p.widget_id);
    if (box === undefined) return p;
    if (layout.flow !== 'free') return { ...p, x: box.x, y: box.y, w: box.w, h: box.h };

    // **The cells follow the rectangle.** Core validates the cells and knows
    // nothing about frames, so a composed edit that left them behind would
    // save a page whose fallback says where the card used to be — and would
    // eventually save one core rejects, with the failure arriving at save time
    // talking about columns. This is the safety property of storing both
    // (§14.3): a client that has never heard of frames draws these and gets a
    // page that is approximately right rather than blank.
    const rect = { ...(p.rect ?? {}), ...box };
    const frame = layout.frame;
    if (frame == null) return { ...p, rect };
    return {
      ...p,
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
