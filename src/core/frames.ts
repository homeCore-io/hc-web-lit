/**
 * The coordinate space a frame gives the things inside it.
 *
 * Everything before this arranged elements *beside* each other: two cards can
 * overlap, a group can be drawn round a cluster, a rectangle can sit behind
 * one — but nothing was ever **in** anything. `core/groups.ts` is blunt about
 * it, in its own words: *"This is not a container. A real group in a drawing
 * tool is a node in the document tree with its own frame, its own coordinate
 * space and its own clipping. Ours is a tag that several elements agree on."*
 *
 * It also predicted the shape of the fix, correctly: *"A path is the shape that
 * survives it: when there are real nodes, `Wall/Lights` is already the address
 * of one."* The tree was there the whole time. What was missing was somewhere
 * to measure from.
 *
 * **The rule, and there is only one.** An element's rectangle is stated in the
 * space of its nearest framed ancestor, and a frame's own rectangle is stated
 * in the space of *its* nearest framed ancestor. Page coordinates are what you
 * get when nothing above you is a frame. So resolving a position is walking up
 * the path adding origins, and that is `originOf` — the function the rest of
 * this file is written in terms of.
 *
 * **Why the document needs no new field for the parent.** Membership is already
 * `group: "Wall/Lights"` in the element's own config, and a group box already
 * carries a rect. The only new thing is `frame`, which says whether that rect
 * is a decoration drawn around some elements or the origin they are measured
 * from. One key — and it is already in `DashboardGroupBox` here, read by
 * nothing until now.
 *
 * **Why no saved page changes.** Nothing in this household's documents sets
 * `frame`, so `originOf` returns the page origin for every path in every one of
 * them, `toPage` and `toLocal` are the identity, and every layout resolves to
 * precisely the numbers it resolved to before. There is no migration because
 * there is nothing to migrate.
 *
 * Ported from hc-web-flutter's `frame_space.dart`, whose reasoning is the
 * design (§1.2 — a worked example, read for the problems it names).
 */
import type { DashboardGroupBox } from './dashboard.js';
import type { DashboardRect } from './layout.js';
import { SEPARATOR, parentOf, segmentsOf } from './groups.js';

/** The top-left of a coordinate space, in page units. */
export interface Origin {
  x: number;
  y: number;
}

/** The page's own space — where everything was measured from before frames. */
export const PAGE_ORIGIN: Origin = { x: 0, y: 0 };

/**
 * Whether a box is a frame, which needs both halves of the claim.
 *
 * A box that says `frame` and states no rect is dropped rather than honoured:
 * a coordinate space with no origin is not one, and treating it as the page's
 * would silently move everything inside it.
 */
export function isFrame(box: DashboardGroupBox): boolean {
  return box.frame === true && box.rect != null;
}

/**
 * The frames among these boxes, by path.
 *
 * Built once per resolution and passed down, so the walk in `originOf` is a
 * map lookup per segment rather than a scan of every box on the layout.
 */
export function framesByPath(
  boxes: readonly DashboardGroupBox[] | undefined,
): Map<string, DashboardGroupBox> {
  const found = new Map<string, DashboardGroupBox>();
  for (const box of boxes ?? []) if (isFrame(box)) found.set(box.path, box);
  return found;
}

/**
 * Where the space named by a path begins, in page coordinates.
 *
 * Every framed ancestor contributes its own top-left, outermost first, because
 * a nested frame's rectangle is itself stated inside its parent. A group that
 * is *not* a frame contributes nothing at all — it is a tag, and a tag has no
 * geometry to offer.
 *
 * The path names an element's group, and the answer is where that element's
 * rectangle is measured from. Passing a *frame's own* path therefore gives the
 * frame's absolute top-left, which is the same number by construction: the
 * origin its contents measure from **is** its corner. Both callers below rely
 * on that, and it is worth saying out loud because it is the one place two
 * meanings coincide rather than merely agree.
 *
 * Cannot loop: paths are a strict hierarchy of prefixes, so the walk is bounded
 * by the number of segments.
 */
export function originOf(
  path: string | undefined,
  frames: ReadonlyMap<string, DashboardGroupBox>,
): Origin {
  if (path === undefined || frames.size === 0) return PAGE_ORIGIN;

  let x = 0;
  let y = 0;
  const parts = segmentsOf(path);
  for (let i = 1; i <= parts.length; i++) {
    const rect = frames.get(parts.slice(0, i).join(SEPARATOR))?.rect;
    if (rect == null) continue;
    x += rect.x;
    y += rect.y;
  }
  return { x, y };
}

/** A rectangle stated in the space of a path, as a page rectangle. */
export function toPage(
  local: DashboardRect,
  path: string | undefined,
  frames: ReadonlyMap<string, DashboardGroupBox>,
): DashboardRect {
  const origin = originOf(path, frames);
  if (origin.x === 0 && origin.y === 0) return local;
  return { ...local, x: local.x + origin.x, y: local.y + origin.y };
}

/** A page rectangle, restated in the space of a path. The inverse of `toPage`. */
export function toLocal(
  page: DashboardRect,
  path: string | undefined,
  frames: ReadonlyMap<string, DashboardGroupBox>,
): DashboardRect {
  const origin = originOf(path, frames);
  if (origin.x === 0 && origin.y === 0) return page;
  return { ...page, x: page.x - origin.x, y: page.y - origin.y };
}

/**
 * Where a frame's box actually sits on the page.
 *
 * Absent for a box that is not a frame — an ordinary group's position is its
 * members' bounding box, which is a different question and not this one.
 */
export function pageRectOf(
  box: DashboardGroupBox,
  frames: ReadonlyMap<string, DashboardGroupBox>,
): DashboardRect | undefined {
  const rect = box.rect;
  if (!isFrame(box) || rect == null) return undefined;
  const origin = originOf(box.path, frames);
  return { x: origin.x, y: origin.y, w: rect.w, h: rect.h };
}

/**
 * The space a *box's own* rectangle is stated in.
 *
 * A frame's rect sits in its parent's space, not its own — the distinction
 * `originOf` calls out, and the one thing about this arithmetic that is easy to
 * get backwards. Hence a named function rather than a `parentOf` at each site.
 */
export function spaceOfBox(path: string): string | undefined {
  return parentOf(path);
}
