/**
 * Whether an element is on the page at all — `hide_with` and `hide_unless`.
 *
 * The room page's SETS section is a colour wheel, a warmth axis and two
 * sliders, all bound to `@picked`. They exist to aim at whichever light you
 * touched, so before you touch one there is nothing for them to aim at, and a
 * bulb with no colour has nothing for the wheel to do. Both are the same
 * mechanism:
 *
 * - `hide_with: "@picked"` — hide when that token resolves to nothing.
 * - `hide_unless: ["color_temp", …]` — and hide unless the device it resolved
 *   to reports at least one of these.
 *
 * **Resolved at the placement seam** with `@room` and the bindings (§14.1),
 * because only the page knows what `@picked` is, and because an element that
 * is not on the page should not be constructed at all.
 *
 * `hide_with` carries `"@picked"` on every element that uses it in the
 * reference house, and core validates the field as a plain string. Read here as
 * "the token this element depends on", which is the only reading the data
 * supports — noted rather than assumed, in the same family as the facet names
 * (homeCore#30).
 */
import type { DeviceState } from './device.js';
import {
  resolveToken,
  selectDevices,
  type SelectionConfig,
  type SelectionContext,
} from './selection.js';
import { scenesInScope, type SceneRowConfig } from './scenes.js';

export interface VisibilityConfig {
  hide_with?: string;
  hide_unless?: string[];
  /**
   * Hide an element that has nothing to show.
   *
   * `scene_row` has had this since it landed and answered it inside itself,
   * which is as far as it went: the row drew nothing and its heading, its
   * rule and the space it was drawn in all stayed. A section is a heading and
   * a set, and a room with no leak sensor wants neither — so the question has
   * to be answerable from outside the widget, which is here.
   */
  hide_when_empty?: boolean;
  /**
   * The rest of the widget's config.
   *
   * What arrives here is a whole widget config, not a visibility one — and
   * `hide_when_empty` is answered by handing the same object to the selection
   * and scene vocabularies, which read keys this interface has no business
   * naming. Saying so is more honest than a cast at every call site, and the
   * three keys above still carry their types.
   */
  [key: string]: unknown;
}

/**
 * Whether to draw this element.
 *
 * Absent conditions mean draw it, which keeps every element that says nothing
 * about visibility exactly as visible as it was.
 */
export function isVisible(
  config: VisibilityConfig,
  devices: readonly DeviceState[],
  ctx: SelectionContext = {},
  type?: string,
): boolean {
  if (config.hide_when_empty === true && !hasContent(type, config, devices, ctx)) return false;

  const token = config.hide_with;
  const needs = config.hide_unless ?? [];
  if (token === undefined && needs.length === 0) return true;

  // Which device this element depends on. `hide_with` names the token; without
  // one, `hide_unless` is about whatever the element is already bound to, which
  // in every real document is `@picked` as well.
  const id = resolveToken(token ?? '@picked', ctx);
  if (id === undefined || id === '') return false;

  // A control aimed at a device the house no longer has is aimed at nothing,
  // whether or not it also asked for particular attributes.
  const device = devices.find((d) => d.device_id === id);
  if (device === undefined) return false;

  if (needs.length === 0) return true;

  // Reported *or* declared: a bulb that can take a colour temperature but has
  // not published one yet still has the control. The schema is the better
  // source and the attributes are the fallback, which is the same order every
  // other reader here uses.
  const declared = device.schema?.attributes ?? {};
  return needs.some((key) => key in declared || key in device.attributes);
}

/**
 * Whether an element that selects devices has selected any.
 *
 * The type decides *which* question, because two vocabularies answer it: a
 * scene row has a scope (§5.3) and everything else has a selection. Both are
 * core's, and this asks the same module the widget will ask when it draws, so
 * a section cannot disappear while its list would have shown something.
 *
 * An element that selects nothing at all — a heading, a rule — has content by
 * definition; `hide_when_empty` on one of those is a question about a set it
 * does not have, and answering "no" would delete it from the page.
 */
export function hasContent(
  type: string | undefined,
  config: VisibilityConfig,
  devices: readonly DeviceState[],
  ctx: SelectionContext,
): boolean {
  if (type === 'scene_row') {
    return scenesInScope(config as SceneRowConfig, devices, ctx.room, ctx.picked).length > 0;
  }
  const selection = config as SelectionConfig;
  if (selection.selection_mode === undefined && selection.query === undefined) return true;
  return selectDevices(selection, devices, ctx).length > 0;
}

/**
 * Whether an element chooses devices at all.
 *
 * A heading does not, a rule does not, and neither has an empty state to be
 * hidden for. A set and a scene row do, which is what makes "this section has
 * nothing in it" a question with an answer.
 */
export function selectsDevices(type: string | undefined, config: VisibilityConfig): boolean {
  if (type === 'scene_row') return true;
  const selection = config as SelectionConfig;
  return selection.selection_mode !== undefined || selection.query !== undefined;
}
