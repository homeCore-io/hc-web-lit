/**
 * Transform geometry for a composed page — the arithmetic behind §14.1's
 * free mode.
 *
 * Pure, and separate from the surface that uses it, for the reason §14.2 gives
 * for not taking a canvas library: this designer does not transform pixels, it
 * transforms **placements in a document core validates**. The gestures work
 * from the placement alone, so a sandboxed element nobody can see inside is
 * transformable exactly like a first-party card.
 *
 * hc-web-flutter's `frame.dart` is the worked example these rules come from,
 * read as a record of problems encountered rather than as a specification
 * (§1.2). Two things it does not have and this does: rotation, and therefore
 * resize-*while*-rotated, which §14.2 names as unsolved there.
 */
import type { DashboardRect } from './layout.js';

/** Which part of a card was taken hold of, and so which edges move. */
export type Handle =
  'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';

/**
 * Which edges each handle moves. **The opposite edge stays put** — that is the
 * whole definition of a resize as against a move, and getting it wrong is the
 * bug everybody ships once: the card changes size and creeps across the page
 * at the same time, because the anchor was taken to be the origin rather than
 * the edge being held.
 */
const EDGES: Record<Handle, { left?: true; top?: true; right?: true; bottom?: true }> = {
  'top-left': { left: true, top: true },
  top: { top: true },
  'top-right': { right: true, top: true },
  right: { right: true },
  'bottom-right': { right: true, bottom: true },
  bottom: { bottom: true },
  'bottom-left': { left: true, bottom: true },
  left: { left: true },
};

export const HANDLES = Object.keys(EDGES) as Handle[];

/**
 * How far apart the things you snap to are, when composing.
 *
 * **A column is not a unit of composition.** Snapping a free element to a
 * 120-pixel cell edge means a text box can be 120 wide or 240 and nothing
 * between, so it is never the width of its own words. A cell is the right
 * magnet for a card that *is* a cell and the wrong one for everything else.
 *
 * Eight, because that is the design system's space unit: every padding, gap
 * and radius is a multiple of it, so an element on this grid lines up with the
 * things drawn inside it and not only with other elements.
 */
export const FINE = 8;

/**
 * The smallest a composed element may be pulled to, in frame units.
 *
 * Not zero: a card resized to nothing cannot be grabbed again, and core
 * rejects a rectangle with no size.
 */
export const LEAST = 24;

/** A value pulled to the nearest edge of a grid, or left where it is. */
export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/**
 * How close an edge has to come before a guide catches it, in frame units.
 *
 * Smaller than `FINE`, and that is the whole of the relationship between the
 * two magnets: a guide has to be *reachable* past the grid the pointer is
 * already being pulled to, and one that caught from further away than the grid
 * step would fire on almost every drag.
 */
export const NEAR = 6;

/**
 * A line something lined up with, and the span worth drawing it over.
 *
 * The span reaches from the near edge of one rectangle to the far edge of the
 * other, because a guide's job is to say *what* you lined up with. A line
 * across the whole page says only that something happened.
 */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

/**
 * A value pulled to the nearest candidate, or failing that to the grid.
 *
 * **A candidate beats the grid**, which is what makes guides usable at all: an
 * edge that snapped to the 8-grid first would land next to its neighbour
 * rather than on it, and the last few pixels are exactly the ones a person
 * cannot close by hand.
 */
export function pullTo(value: number, step: number, candidates: readonly number[]): number {
  let best: number | undefined;
  let closest = Infinity;
  // **Strictly closer wins, so the first of an equal pair does.** Two lines the
  // same distance away is ordinary — a card centred between two others has it
  // on both axes — and "whichever was considered last" is an answer that moves
  // when an unrelated widget is added to the page.
  for (const candidate of candidates) {
    const away = Math.abs(candidate - value);
    if (away < closest) {
      closest = away;
      best = candidate;
    }
  }
  return closest <= NEAR && best !== undefined ? best : snap(value, step);
}

/** The three lines a rectangle offers on one axis: both edges and the middle. */
function linesOf(r: DashboardRect, axis: 'x' | 'y'): number[] {
  return axis === 'x' ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];
}

/**
 * Where a rectangle wants to sit, given what is already on the page.
 *
 * §14.1's third magnet: free mode snaps to the fine grid, to guides, and to
 * other elements' edges — and this is the last two, which are the same thing.
 * Each axis is decided on its own, so a card can line up with one neighbour's
 * left edge and another's middle, which is what somebody arranging a row of
 * things is usually trying to do.
 *
 * **Both edges and the middle**, because "centred on that" is as much an
 * alignment as "flush with that", and a composition has more of the first than
 * a grid ever did.
 *
 * The result is a whole rectangle rather than a delta, so a caller cannot
 * apply it to the wrong one.
 */
export function alignTo(
  moving: DashboardRect,
  others: readonly DashboardRect[],
): { rect: DashboardRect; guides: Guide[] } {
  const guides: Guide[] = [];
  let { x, y } = moving;

  for (const axis of ['x', 'y'] as const) {
    const mine = linesOf(moving, axis);
    let best: { shift: number; at: number; other: DashboardRect } | undefined;
    let closest = Infinity;

    // Strictly closer wins, so the first of an equal pair does — see `pullTo`.
    for (const other of others) {
      for (const line of linesOf(other, axis)) {
        for (const edge of mine) {
          const away = Math.abs(line - edge);
          if (away < closest) {
            closest = away;
            best = { shift: line - edge, at: line, other };
          }
        }
      }
    }
    if (best === undefined || closest > NEAR) continue;

    if (axis === 'x') x += best.shift;
    else y += best.shift;

    // The span covers both rectangles on the *other* axis, so the line drawn
    // reaches from one to the other and says which two lined up.
    const across = axis === 'x' ? ('y' as const) : ('x' as const);
    const mineSpan = [moving[across], moving[across] + (across === 'y' ? moving.h : moving.w)];
    const theirs = [
      best.other[across],
      best.other[across] + (across === 'y' ? best.other.h : best.other.w),
    ];
    guides.push({
      axis,
      at: best.at,
      from: Math.min(...mineSpan, ...theirs),
      to: Math.max(...mineSpan, ...theirs),
    });
  }

  return { rect: { ...moving, x, y }, guides };
}

/**
 * A pointer delta turned into the element's own frame.
 *
 * **This is what makes resize-while-rotated work**, and it is the piece
 * hc-web-flutter has no answer for — its geometry takes an axis-aligned
 * rectangle and a raw offset, and `angle` appears nowhere in it. Dragging the
 * right edge of a card rotated 90° moves the pointer *down* the screen, and
 * anchor arithmetic fed the screen delta would widen the card instead of
 * making it taller.
 *
 * Clockwise degrees on screen, so the inverse rotation is by `-angle`.
 */
export function intoFrame(dx: number, dy: number, angle: number): { dx: number; dy: number } {
  if (angle === 0) return { dx, dy };
  const r = (-angle * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

export interface ResizeOptions {
  /** The magnet: `FINE` when composing, a cell step when packing, 0 for none. */
  step?: number;
  /** The element's own floor, when it has said it has one. */
  leastW?: number;
  leastH?: number;
  /** Degrees clockwise the element is drawn at. */
  angle?: number;
  /**
   * What else is on the page, so a pulled edge can land on a neighbour's.
   *
   * The same magnet a move gets (`alignTo`), applied to the one edge under the
   * pointer: sizing a card flush with the one beside it is the commonest thing
   * anybody does in a composition, and the fine grid alone cannot close the
   * last few pixels when the neighbour is off-grid.
   */
  near?: readonly DashboardRect[];
}

/**
 * The rectangle `from` becomes when `handle` is dragged by a screen delta.
 *
 * **Snapping is applied to the edge under the pointer, never to the width.**
 * Snapping a width instead puts the far edge wherever the near edge's offset
 * happens to leave it, so a card whose left side sits off-grid could never
 * have a right side on it.
 *
 * **A rotated card keeps its centre.** Rotation is drawn about the centre, so
 * growing a rotated card only to the right by changing `x`/`w` would swing the
 * whole thing round that centre as it grew — the card would appear to move
 * sideways while being resized. The rect is rebuilt about the centre the
 * unrotated arithmetic produced, which is what a person sees the handle do.
 */
export function resizedBy(
  from: DashboardRect,
  handle: Handle,
  by: { dx: number; dy: number },
  options: ResizeOptions = {},
): DashboardRect {
  const { step = FINE, leastW = LEAST, leastH = LEAST, angle = 0, near = [] } = options;
  const moves = EDGES[handle];
  const d = intoFrame(by.dx, by.dy, angle);

  // A rotated card's edges do not line up with anything axis-aligned, so the
  // guides are left out of that case rather than made to mean something they
  // do not: what would be matched is the unrotated footprint, which is nowhere
  // a person can see.
  const alongX = angle === 0 ? near.flatMap((r) => linesOf(r, 'x')) : [];
  const alongY = angle === 0 ? near.flatMap((r) => linesOf(r, 'y')) : [];

  const right = from.x + from.w;
  const bottom = from.y + from.h;
  let { x, y, w, h } = from;

  if (moves.left === true) {
    const edge = pullTo(from.x + d.dx, step, alongX);
    // Never past the edge being held still, or the card turns inside out.
    x = Math.min(edge, right - leastW);
    w = right - x;
  } else if (moves.right === true) {
    const edge = pullTo(right + d.dx, step, alongX);
    w = Math.max(leastW, edge - from.x);
  }

  if (moves.top === true) {
    const edge = pullTo(from.y + d.dy, step, alongY);
    y = Math.min(edge, bottom - leastH);
    h = bottom - y;
  } else if (moves.bottom === true) {
    const edge = pullTo(bottom + d.dy, step, alongY);
    h = Math.max(leastH, edge - from.y);
  }

  if (angle === 0) return { x, y, w, h };

  // **The anchor stays put on screen, and rotation is drawn about the centre.**
  // A rotated card whose `x`/`w` changed would swing round its own moving
  // centre as it grew, so it would appear to slide sideways while being
  // resized. What a person expects is the edge they are not holding to stay
  // exactly where it is, so the new centre is derived from that.
  //
  // A point P of a card is drawn at `C + R(angle)·(P − C)`. Writing `o` for the
  // anchor's offset from the centre — which depends only on the size and on
  // which handle — holding the anchor still means `C + R·o = screen(anchor)`,
  // and so `C = screen(anchor) − R·o`.
  const before = offsetToAnchor(from, moves);
  const after = offsetToAnchor({ x, y, w, h }, moves);
  const was = centreOf(from);
  const onScreen = add(was, rotate(before, angle));
  const centre = subtract(onScreen, rotate(after, angle));

  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
}

const add = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

const subtract = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

/** The middle of a rectangle. */
function centreOf(r: DashboardRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** A point rotated clockwise about the origin, in degrees. */
function rotate(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const r = (angle * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * Where the held point sits relative to the centre, for a card of this size.
 *
 * The point a resize holds still is the corner or edge *opposite* the handle,
 * and a side handle holds the middle of the opposite side — which is why
 * dragging a card's right edge does not move its top or bottom. As an offset
 * from the centre rather than an absolute point, because that is the form the
 * rotated case needs and it depends only on the size.
 */
function offsetToAnchor(
  r: DashboardRect,
  moves: { left?: true; top?: true; right?: true; bottom?: true },
): { x: number; y: number } {
  return {
    x: moves.left === true ? r.w / 2 : moves.right === true ? -r.w / 2 : 0,
    y: moves.top === true ? r.h / 2 : moves.bottom === true ? -r.h / 2 : 0,
  };
}

/**
 * The angle a card should be at, given where the pointer is around its centre.
 *
 * Degrees clockwise from the card's own starting angle, so a rotation gesture
 * is "how far round from where I grabbed it" rather than "where my finger is",
 * which is what keeps the card from jumping to meet the pointer on the first
 * pixel of the drag.
 */
export function angleFrom(
  centre: { x: number; y: number },
  grabbed: { x: number; y: number },
  now: { x: number; y: number },
  was: number,
): number {
  const before = Math.atan2(grabbed.y - centre.y, grabbed.x - centre.x);
  const after = Math.atan2(now.y - centre.y, now.x - centre.x);
  const turned = ((after - before) * 180) / Math.PI;
  // Into [0, 360), because a document holding -0.0000001 degrees is a document
  // that says something different from the one holding 360.
  return (((was + turned) % 360) + 360) % 360;
}

/**
 * The box a set of rectangles sits in.
 *
 * The group frame: what a selection of several looks like as one thing, and
 * what a group rotation turns about. Absent for an empty set, because a box
 * around nothing has no honest position.
 */
export function boundsOf(rects: readonly DashboardRect[]): DashboardRect | undefined {
  if (rects.length === 0) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.w);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * One element of a group, turned about the group's centre.
 *
 * **This is the thing an element's own angle cannot express** (§14.2). Turning
 * a cluster is not turning each card where it stands: every card also *orbits*
 * the point the group turns about, and a rotation that only added to each
 * angle would spin the cards in place and leave the arrangement exactly where
 * it was — five cards each pointing somewhere new, still in a straight row.
 *
 * So both halves move. The centre orbits, and the card turns by the same
 * amount on top of whatever it was already at, which is what keeps a group of
 * already-rotated cards rigid as it turns.
 *
 * The rectangle stays axis-aligned because that is what a rectangle plus an
 * angle means here: `rect` is the unrotated footprint and `angle` says how it
 * is drawn (§14.3).
 */
export function turnedAbout(
  rect: DashboardRect,
  angle: number,
  by: number,
  about: { x: number; y: number },
): { rect: DashboardRect; angle: number } {
  const centre = centreOf(rect);
  const orbit = rotate({ x: centre.x - about.x, y: centre.y - about.y }, by);
  const moved = { x: about.x + orbit.x, y: about.y + orbit.y };

  return {
    rect: { x: moved.x - rect.w / 2, y: moved.y - rect.h / 2, w: rect.w, h: rect.h },
    // One spelling per angle, the same normalisation `angleFrom` applies.
    angle: (((angle + by) % 360) + 360) % 360,
  };
}

/**
 * The whole-cell approximation of a rectangle — **guaranteed legal for core**.
 *
 * Core rejects `x < 0`, `y < 0`, `w <= 0`, `h <= 0` and `x + w > columns`, and
 * it applies those rules to the **cells** rather than to the rectangle. So a
 * card composed off the left edge, or wider than the grid, still has to come
 * back as something core will accept, or composing a page makes it unsaveable
 * and the failure arrives at save time talking about columns.
 *
 * This is the safety property of storing both: a client that has never heard
 * of frames draws these cells and gets a page that is approximately right
 * rather than blank, and taking the frame off a layout leaves a working grid
 * behind. A composition only its own author could read would not be a
 * document, it would be a save file.
 *
 * Angle is deliberately not in it. A rotated card has no whole-cell
 * approximation worth the name, and the cells are a fallback rather than a
 * rendering — so they describe where it sits, and a client without frames
 * draws it square.
 */
export function cellsOf(
  rect: DashboardRect,
  grid: { width: number; columns: number; rowHeight: number; gap: number },
): { x: number; y: number; w: number; h: number } {
  // A frame's units *are* the canvas width, which is what lets one definition
  // of where a cell is serve both directions.
  const stepX = pitch(grid);
  const stepY = grid.rowHeight + grid.gap;
  if (stepX <= 0 || stepY <= 0 || grid.columns < 1) return { x: 0, y: 0, w: 1, h: 1 };

  // From the span *including* the gap the card does not own, so a rectangle
  // built from a cell comes back the same size it went in.
  let w = Math.min(grid.columns, Math.max(1, Math.round((rect.w + grid.gap) / stepX)));
  const h = Math.max(1, Math.round((rect.h + grid.gap) / stepY));

  let x = Math.max(0, Math.round(rect.x / stepX));
  const y = Math.max(0, Math.round(rect.y / stepY));
  // Core rejects a card that runs off the right, so the one that would is
  // pushed back rather than narrowed: a wide card kept wide and moved left is
  // closer to what somebody drew than a narrow one in the right place.
  if (x + w > grid.columns) x = Math.max(0, grid.columns - w);
  if (x + w > grid.columns) w = grid.columns - x;

  return { x, y, w, h };
}

/** One column and the gap after it, in frame units. */
function pitch(grid: { width: number; columns: number; gap: number }): number {
  if (grid.columns < 1) return 0;
  return (grid.width - grid.gap * (grid.columns - 1)) / grid.columns + grid.gap;
}
