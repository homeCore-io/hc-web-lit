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
import { resolveToken, type SelectionContext } from './selection.js';

export interface VisibilityConfig {
  hide_with?: string;
  hide_unless?: string[];
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
): boolean {
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
