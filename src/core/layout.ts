/**
 * What a stored layout means — this client's implementation of core's spec.
 *
 * **Not a design of ours.** `hc_types::dashboard_layout` is the reference
 * implementation, `core/docs/dashboard-layout.md` is the prose, and
 * `core/docs/dashboard-layout-fixtures.json` pins it case by case. Where they
 * disagree the fixtures win; where *this file* disagrees with the fixtures, this
 * file is wrong. `test/layout.fixtures.test.ts` is what keeps that honest.
 *
 * It matters more than it looks. `normalize` runs before every save and core
 * rejects the whole dashboard on the first illegal placement, so a client that
 * normalises differently does not draw a page differently — **it loses the
 * user's edit, including the parts that were fine.**
 *
 * Field names are core's, not camelCase, because these come straight off the
 * wire from `DashboardWidgetPlacement`. A conversion layer here would be one
 * more thing that can drift from the document.
 */

/** Where a composed element really sits, in the frame's units. */
export interface DashboardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Gaps close, or gaps are content. The single axis the two flows differ on. */
export type DashboardFlow = 'packed' | 'free';

/** One card's box, in grid cells. */
export interface GridItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;

  /** Sections partition a layout; items never collide across them. */
  section_id?: string | null;

  /**
   * Sits *above* the grid rather than in it: it keeps cell geometry, but
   * nothing pushes it, it pushes nothing, and gravity does not pull it.
   */
  floating?: boolean;

  /**
   * Where it really sits, when the layout is composed. The cells are then a
   * snapped approximation of this — and the fallback for a client that has
   * never heard of frames.
   */
  rect?: DashboardRect | null;

  /**
   * Degrees clockwise about the element's own centre, when it is composed.
   *
   * The engine has no opinion about it: gravity, collision and packing all
   * work on cells, and a rotated card's cells are its unrotated footprint
   * (§14.3 — the cells are a fallback, not a rendering). It rides here so the
   * surface drawing an item does not have to go back to the placement for the
   * one field the engine did not carry across.
   */
  angle?: number | null;
}

const right = (i: GridItem): number => i.x + i.w;
const bottom = (i: GridItem): number => i.y + i.h;

/** Placed, not packed: somebody put this at a point on a canvas. */
const isComposed = (i: GridItem): boolean => i.rect != null;

/** `null` and `undefined` are the same absence here; the wire sends either. */
const section = (i: GridItem): string | null => i.section_id ?? null;

/**
 * Do these two compete for the same cells?
 *
 * **Overlapping is not the same as competing**, and that distinction is the
 * whole of the free layer. Two grid items in one cell is a layout to be
 * resolved; a floating element over a grid item is a design. So a floating *or
 * composed* element on either side answers no, and every other rule inherits
 * that from here rather than restating it.
 */
export function overlaps(a: GridItem, b: GridItem): boolean {
  return (
    !a.floating &&
    !b.floating &&
    !isComposed(a) &&
    !isComposed(b) &&
    section(a) === section(b) &&
    a.id !== b.id &&
    a.x < right(b) &&
    right(a) > b.x &&
    a.y < bottom(b) &&
    bottom(a) > b.y
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** `(y, x)` — the order somebody reads a page in. */
const readingOrder = (a: GridItem, b: GridItem): number => a.y - b.y || a.x - b.x;

/** The layout engine for one breakpoint's layout. */
export class Engine {
  constructor(
    /**
     * Core validates `x + w <= columns` and rejects the whole dashboard
     * otherwise, so this is a hard bound rather than a preference.
     */
    readonly columns: number,
    readonly flow: DashboardFlow,
  ) {}

  /**
   * Makes an arbitrary layout legal: clamps every item inside the grid, then
   * removes every overlap. Run before every save.
   *
   * 1. **Clamp.** `w` into `1..=columns`, `h` to at least 1, `x` so the card
   *    ends inside the grid, `y` to at least 0.
   * 2. **Reading order.** Re-place by `(y, x)`, so a corrupt layout resolves
   *    predictably rather than according to whatever order the JSON was in.
   * 3. **Push down.** Each item drops one row at a time until it competes with
   *    nothing already placed. A floating element skips this — the position is
   *    the design.
   * 4. **Settle.** Under `packed`, gravity pulls everything back up into the
   *    gaps. Under `free`, gaps are content and nothing moves.
   *
   * ## The composed-under-packed asymmetry
   *
   * Step 3 skips floating elements explicitly, and composed ones implicitly
   * because `overlaps` answers no for them. Gravity (step 4) skips only
   * *floating*. A composed element therefore competes with nothing, never
   * breaks gravity's rise loop, and is pulled to `y = 0`.
   *
   * Reproduced deliberately, because core does it. Usually invisible — a
   * composed element is drawn from its `rect` — but the cells are what core
   * validates and what a frame-unaware client draws, so it is not harmless.
   * Changing it is a decision about the document, not a tidy-up.
   */
  normalize(items: readonly GridItem[]): GridItem[] {
    const clamped = items.map((i): GridItem => {
      const w = clamp(i.w, 1, Math.max(this.columns, 1));
      return {
        ...i,
        w,
        h: Math.max(i.h, 1),
        x: clamp(i.x, 0, Math.max(this.columns - w, 0)),
        y: Math.max(i.y, 0),
      };
    });

    // Array.prototype.sort is stable per spec, which matters: two items at the
    // same (y, x) must resolve in input order, as Rust's stable sort_by does.
    clamped.sort(readingOrder);

    const out: GridItem[] = [];
    for (const item of clamped) {
      if (item.floating) {
        out.push(item);
        continue;
      }
      const placed = { ...item };
      while (out.some((o) => overlaps(placed, o))) {
        placed.y += 1;
      }
      out.push(placed);
    }

    return this.settle(out);
  }

  /**
   * Gravity, or not — the single place the two flows differ. Everything else is
   * identical, because a gap being content does not make an overlap acceptable.
   */
  private settle(items: GridItem[]): GridItem[] {
    return this.flow === 'packed' ? this.gravity(items) : items;
  }

  /** Pulls every item as far up as it will go, in reading order. */
  private gravity(items: GridItem[]): GridItem[] {
    const ordered = [...items].sort(readingOrder);

    const out: GridItem[] = [];
    for (const item of ordered) {
      // A floating element is where it was put. Gravity would pull it to the top
      // of the page, since nothing below can block something that competes with
      // nothing.
      if (item.floating) {
        out.push(item);
        continue;
      }
      const placed = { ...item };
      while (placed.y > 0) {
        const up = { ...placed, y: placed.y - 1 };
        if (out.some((o) => overlaps(up, o))) break;
        placed.y = up.y;
      }
      out.push(placed);
    }

    return out;
  }

  /**
   * Whether core would accept this layout as-is: the bounds core checks, plus
   * the overlap rule it does not. Core validates placement arithmetic, and a
   * client that saved overlapping cards would get a document every *other*
   * client draws differently.
   */
  isLegal(items: readonly GridItem[]): boolean {
    for (const i of items) {
      if (i.x < 0 || i.y < 0 || i.w < 1 || i.h < 1) return false;
      if (right(i) > this.columns) return false;
      if (items.some((o) => overlaps(i, o))) return false;
    }
    return true;
  }

  /** The grid's height in rows — what a canvas must be tall enough to show. */
  rows(items: readonly GridItem[]): number {
    return items.reduce((max, i) => Math.max(max, bottom(i)), 0);
  }
}
