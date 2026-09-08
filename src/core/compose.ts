/**
 * P4 — composition without chrome (§5.5).
 *
 * Widgets nest. A container declares slots, children are widgets like any
 * other, and a nested widget renders **without** a card background, border or
 * padding unless it is the outermost one. That last rule is the whole point:
 * stack-in-card, vertical-stack-in-card and the rest of Home Assistant's
 * "in-card" family exist for no reason except suppressing a double border, and
 * §5.1 counts them among the cards that are really a missing host primitive.
 *
 * **The shape is this client's to define.** Core's vocabulary has 39 widget
 * types and no container among them — no `stack`, no `children`, no `slots` —
 * because the previous client could not hold customised content and so
 * everything a user could author had to be a type core knew. Asking core for a
 * container type now would inherit that constraint. `type` is a plain string
 * core accepts unknown values for (§14.3), so a container round-trips through
 * core untouched, and what a container *means* stays where presentation
 * belongs.
 *
 * **Declarative, because a coded container is web-only by construction**
 * (§5.5). A container whose behaviour is data — slot names, direction, gaps —
 * is expressible as a portable `RenderElement`, so a client that is not a
 * browser can still draw a stack. Every container here is data.
 */
import type { WidgetSpec } from '../shell/mount.js';

/** Whether a widget draws its own surface. */
export type Chrome = 'auto' | 'always' | 'never';

/**
 * The children a container holds.
 *
 * A single `children` array is the common case; a record is how a container
 * with named slots addresses them. Both are read here so a container element
 * never parses config itself.
 */
export function childrenOf(
  config: Record<string, unknown> | undefined,
  slot = 'children',
): WidgetSpec[] {
  const raw = config?.[slot];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is WidgetSpec =>
      typeof c === 'object' && c !== null && typeof (c as WidgetSpec).type === 'string',
  );
}

/** The named slots a container's config carries, in declaration order. */
export function slotsOf(config: Record<string, unknown> | undefined): string[] {
  const declared = config?.['slots'];
  if (!Array.isArray(declared)) return ['children'];
  const names = declared.filter((s): s is string => typeof s === 'string');
  return names.length > 0 ? names : ['children'];
}

/**
 * Whether this widget should draw its own chrome.
 *
 * `auto` is the rule §5.5 states: chrome when outermost, none when nested. The
 * two overrides exist because both cases are real — a card deliberately inside
 * a card wants `always`, and a container that is itself the surface wants its
 * one child to have `never` even at the top.
 */
export function wantsChrome(config: Record<string, unknown> | undefined, nested: boolean): boolean {
  const declared = config?.['chrome'];
  if (declared === 'always') return true;
  if (declared === 'never') return false;
  return !nested;
}

/**
 * How much of a container's own box its children share.
 *
 * A container suppressing its children's chrome takes on the job of separating
 * them, which is what `gap` is for; without it a stack of chrome-less widgets
 * is a single undifferentiated block.
 */
export function gapOf(config: Record<string, unknown> | undefined, fallback = 8): number {
  const gap = config?.['gap'];
  return typeof gap === 'number' && gap >= 0 ? gap : fallback;
}
