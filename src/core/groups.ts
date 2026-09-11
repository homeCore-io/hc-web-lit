/**
 * Elements you hold as one thing.
 *
 * Multi-select gave this surface hands; a group is **a grip that survives
 * letting go**. Arranging a cluster — a title over three readings, a row of
 * controls under a photograph — otherwise means re-sweeping the same five
 * cards every time you come back to them, and one missed shift-click quietly
 * leaves a card behind when the cluster moves.
 *
 * **A group is a path, and the path is its identity.** `Wall/Lights` is a
 * group `Lights` inside a group `Wall`. There is no registry of groups
 * anywhere: a group exists exactly as long as something is in it, which for a
 * grouping that is a *property of its members* is simply the truth. Nesting
 * costs nothing, orphans cannot happen, and nothing has to be cleaned up when
 * the last member leaves.
 *
 * **It rides in the widget's `config`**, like `layer` does (§14.1), and for the
 * same reason: core stores the object verbatim and validates nothing about it,
 * so absent means ungrouped and every page already saved is byte-identical.
 *
 * **This is not a container.** A real group in a drawing tool is a node in the
 * document tree with its own frame, coordinate space and clipping. This is a
 * tag several elements agree on. It buys the thing people reach for a hundred
 * times a day — hold these as one, name them, keep the grip — and it does not
 * buy a group you can style, clip or give a background to. That needs the
 * document to be a tree, which is what `DashboardLayout.groups` is for and is
 * not this. A path is the shape that survives it: when there are real nodes,
 * `Wall/Lights` is already the address of one.
 *
 * Ported from hc-web-flutter's `groups.dart`, which is a worked example rather
 * than a specification (§1.2) — but the reasoning in it is the design, and the
 * rules below are its rules.
 */

/** Where the path lives inside `config`, and what separates its parts. */
export const GROUP_KEY = 'group';
export const SEPARATOR = '/';

/** The default stem for a group nobody has named yet. */
export const STEM = 'Group';

/**
 * A value read as a path, or `undefined` when there is nothing usable in it.
 *
 * Normalised on the way out rather than trusted. A hand-edited document with
 * `group: "//a//"` or `group: 7` would otherwise produce a path with empty
 * segments that matches nothing, hides its members from every group operation,
 * and cannot be selected in order to be fixed.
 */
export function normalise(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const parts = raw
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return parts.length === 0 ? undefined : parts.join(SEPARATOR);
}

/** The group this config belongs to, or `undefined` when it belongs to none. */
export function groupOf(config: Record<string, unknown> | undefined): string | undefined {
  return normalise(config?.[GROUP_KEY]);
}

/**
 * A config in `path`, or out of every group when it is absent.
 *
 * **The key goes entirely when there is no path**, so grouping and then
 * ungrouping leaves the document exactly as it was found. That is what keeps a
 * page's stored JSON from accumulating a record of every idle click.
 */
export function withGroup(
  config: Record<string, unknown> | undefined,
  path: string | undefined,
): Record<string, unknown> {
  const next = { ...(config ?? {}) };
  const clean = normalise(path);
  if (clean === undefined) delete next[GROUP_KEY];
  else next[GROUP_KEY] = clean;
  return next;
}

export function segmentsOf(path: string): string[] {
  return path.split(SEPARATOR);
}

/** The group this one sits in, or `undefined` when it is at the top. */
export function parentOf(path: string): string | undefined {
  const cut = path.lastIndexOf(SEPARATOR);
  return cut < 0 ? undefined : path.slice(0, cut);
}

/** The last segment — what the group is called, as opposed to where it is. */
export function nameOf(path: string): string {
  return segmentsOf(path).at(-1) ?? path;
}

export function join(parent: string | undefined, name: string): string {
  return parent === undefined ? name : `${parent}${SEPARATOR}${name}`;
}

/**
 * Whether a path is a group itself, or something inside it.
 *
 * Segment-aware on purpose: a plain `startsWith` would say `Wallpaper` is
 * inside `Wall`.
 */
export function isUnder(path: string, group: string): boolean {
  return path === group || path.startsWith(`${group}${SEPARATOR}`);
}

/** What a path is called relative to a group, or absent when it is not in it. */
export function relativeTo(path: string, inside: string | undefined): string | undefined {
  if (inside === undefined) return path;
  if (!isUnder(path, inside)) return undefined;
  if (path.length === inside.length) return undefined;
  return path.slice(inside.length + 1);
}

/** Every element whose path is this group or below it. */
export function membersOf(
  paths: ReadonlyMap<string, string | undefined>,
  group: string,
): Set<string> {
  const found = new Set<string>();
  for (const [id, path] of paths) {
    if (path !== undefined && isUnder(path, group)) found.add(id);
  }
  return found;
}

/**
 * What a click on an element should put in hand, standing inside a group.
 *
 * **This is the whole point of grouping: one click holds the cluster.** Getting
 * at a single member means going in first, which is why entering is a gesture
 * of its own. `undefined` means "the element itself".
 */
export function clickTarget(
  path: string | undefined,
  inside: string | undefined,
): string | undefined {
  if (path === undefined) return undefined;
  // Clicking something that is not in the group you are standing in takes you
  // out of it. The alternative — ignoring the click — is a surface that stops
  // responding for reasons nothing on screen explains.
  const here = inside !== undefined && !isUnder(path, inside) ? undefined : inside;
  const rest = relativeTo(path, here);
  // A direct member of the group you are standing in: you are already as deep
  // as this element goes.
  if (rest === undefined) return undefined;
  return join(here, segmentsOf(rest)[0] ?? rest);
}

/**
 * The deepest group that contains every one of these paths.
 *
 * Absent when any of them is ungrouped, or when they share no group at all —
 * which is exactly when there is no single group in hand to name, ungroup or
 * report.
 */
export function commonGroup(paths: Iterable<string | undefined>): string | undefined {
  let shared: string[] | undefined;
  let any = false;

  for (const path of paths) {
    any = true;
    if (path === undefined) return undefined;
    const parts = segmentsOf(path);
    if (shared === undefined) {
      shared = parts;
      continue;
    }
    let keep = 0;
    while (keep < shared.length && keep < parts.length && shared[keep] === parts[keep]) keep++;
    if (keep === 0) return undefined;
    shared = shared.slice(0, keep);
  }

  return !any || shared === undefined ? undefined : shared.join(SEPARATOR);
}

/** The names of the groups sitting directly inside this one. */
export function namesIn(
  paths: Iterable<string | undefined>,
  inside: string | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const path of paths) {
    if (path === undefined) continue;
    const rest = relativeTo(path, inside);
    if (rest === undefined) continue;
    const first = segmentsOf(rest)[0];
    if (first !== undefined) names.add(first);
  }
  return names;
}

/**
 * A name not already taken, as `Group 1`, `Group 2`, …
 *
 * Numbered from one and skipping what exists, so grouping, ungrouping and
 * grouping again gives `Group 1` back rather than climbing forever.
 */
export function freshName(taken: ReadonlySet<string>, stem = STEM): string {
  for (let n = 1; ; n++) {
    const name = `${stem} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * A desired name if it is free, otherwise the same with a number on the end.
 *
 * Sibling names have to be unique because the name *is* the address. Silently
 * letting two groups share one would merge them, which is a far worse surprise
 * than a `2` appearing after what somebody typed.
 */
export function uniqueName(desired: string, taken: ReadonlySet<string>): string {
  const path = normalise(desired);
  const clean = path === undefined ? STEM : (segmentsOf(path).at(-1) ?? STEM);
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const candidate = `${clean} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Where a path lands when its element is put into a new group.
 *
 * **Anything the element was already in below where you are standing is kept
 * underneath the new group.** Grouping a group with a loose card gives
 * `Group 2/Group 1` and `Group 2` — the cluster you had does not dissolve
 * because you put something beside it.
 */
export function regrouped(
  path: string | undefined,
  newGroup: string,
  inside: string | undefined,
): string {
  const rest = path === undefined ? undefined : relativeTo(path, inside);
  return rest === undefined ? newGroup : `${newGroup}${SEPARATOR}${rest}`;
}

/**
 * A path with one group taken out of it.
 *
 * **The group named is the one that goes, not the innermost**: holding `Wall`
 * and ungrouping must dissolve `Wall` and leave `Lights` standing, or
 * ungrouping the thing you have in hand would take apart something else.
 */
export function ungrouped(path: string | undefined, group: string): string | undefined {
  if (path === undefined || !isUnder(path, group)) return path;
  const rest = relativeTo(path, group);
  const parent = parentOf(group);
  return rest === undefined ? parent : join(parent, rest);
}

/** A path after the group it is in is renamed or moved. */
export function renamedPath(
  path: string | undefined,
  from: string,
  to: string,
): string | undefined {
  if (path === undefined || !isUnder(path, from)) return path;
  const rest = relativeTo(path, from);
  return rest === undefined ? to : `${to}${SEPARATOR}${rest}`;
}

/** Where you end up when you step out of a group. */
export function stepOut(inside: string | undefined): string | undefined {
  return inside === undefined ? undefined : parentOf(inside);
}
