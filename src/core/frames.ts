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

/**
 * The frames that render as real containers rather than as backdrops.
 *
 * A positioned frame can be drawn *behind* its members, because they know
 * where they are. A **stacked** frame cannot: it decides where its members
 * are, and a member that grows has to push the ones below it down, which only
 * happens if they are really its children in the DOM.
 *
 * That property is inherited downward, and this is the function that says so.
 * A frame nested inside a container is itself a container — a block in its
 * parent's column, holding its own members — because the alternative is a
 * frame whose *position* comes from the flow and whose *contents* are
 * absolutely positioned somewhere else on the page. That was the state of
 * things before this: `stacks()` collected member widgets and knew nothing
 * about member frames, so a column could hold a list of cards and could not
 * hold a band of four controls with a colour wheel in it. The household's Room
 * page is exactly that shape, which is how the gap was found.
 *
 * Note what is *not* inherited: `stack`. A container that does not stack lays
 * its members out at their stored rectangles, which are already stated in its
 * own space (`originOf`), so nothing has to be translated — it is the same
 * arithmetic the page does, one level in.
 *
 * The house's footer is the case that is neither: a modes block beside a
 * scenes block, so not a column, and not nested in anything — but it asks to
 * be as tall as what is in it, and that is a measurement of its members. A box
 * whose members are drawn somewhere else on the page has none to measure.
 */
export function flowFrames(
  boxes: readonly DashboardGroupBox[] | undefined,
): Map<string, DashboardGroupBox> {
  const frames = framesByPath(boxes);
  const flow = new Map<string, DashboardGroupBox>();
  // Shallowest first, so a box's parent is already decided when it is asked
  // about. Sorting by depth rather than by document order, because a document
  // is free to list a child before its parent and this must not depend on it.
  const ordered = [...frames.values()].sort(
    (a, b) => segmentsOf(a.path).length - segmentsOf(b.path).length,
  );
  for (const box of ordered) {
    // A column, anything nested in a container, and **anything that asks to be
    // as tall as its contents** — because that is a measurement of its
    // members, and a box whose members are drawn somewhere else on the page
    // has no members to measure. The frame model puts them at the right place
    // either way; holding them is what makes the height answerable.
    if (
      box.stack === true ||
      box.fit === 'content' ||
      nearestIn(parentOf(box.path), flow) !== undefined
    ) {
      flow.set(box.path, box);
    }
  }
  return flow;
}

/** The nearest ancestor-or-self of a path that is in a set of boxes. */
function nearestIn(
  path: string | undefined,
  boxes: ReadonlyMap<string, DashboardGroupBox>,
): string | undefined {
  if (path === undefined) return undefined;
  const parts = segmentsOf(path);
  for (let i = parts.length; i >= 1; i--) {
    const at = parts.slice(0, i).join(SEPARATOR);
    if (boxes.has(at)) return at;
  }
  return undefined;
}

/**
 * The container that lays out whatever sits at this path, if any.
 *
 * Ancestor-*or-self*: a frame is laid out by the container it is in, and a
 * widget whose own group is a container is laid out by that container. Both
 * callers want the same walk, and separating them produced an off-by-one the
 * first time round.
 */
export function containerOf(
  path: string | undefined,
  flow: ReadonlyMap<string, DashboardGroupBox>,
): string | undefined {
  return nearestIn(path, flow);
}

/** The container a frame's own box sits in — its parent's, never its own. */
export function containerOfBox(
  box: DashboardGroupBox,
  flow: ReadonlyMap<string, DashboardGroupBox>,
): string | undefined {
  return nearestIn(parentOf(box.path), flow);
}

/**
 * The containers held directly by one container, `undefined` meaning the page.
 *
 * Ordered by where their author drew them — top to bottom — because a stacked
 * container's column order is the order the page reads in, and a document's
 * array order is whatever an editor happened to append in.
 */
export function framesIn(
  path: string | undefined,
  flow: ReadonlyMap<string, DashboardGroupBox>,
): DashboardGroupBox[] {
  return [...flow.values()]
    .filter((b) => containerOfBox(b, flow) === path)
    .sort((a, b) => (a.rect?.y ?? 0) - (b.rect?.y ?? 0));
}
