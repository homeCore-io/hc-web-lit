/**
 * What a tap does — the beginnings of P9 (§5.10).
 *
 * §5.10's point is that the **host** dispatches, not the widget: one shared
 * schema for "what happens when the user interacts", so the safety policy is
 * enforced in one place and a third-party widget cannot opt out of it by
 * mishandling its own events.
 *
 * This is the part of it the reference house actually uses. Surveyed across all
 * three stored dashboards, the whole tap vocabulary is one entry — a breadcrumb
 * that goes back to the house:
 *
 * ```json
 * { "do": "page", "target": "dashboard_house_designed" }
 * ```
 *
 * So `do` is a plain string and this reads it as one. `ActionConfig`'s wider
 * shape — `service`, `payload`, `confirm`, the tap/hold/double-tap trio — is
 * written when a document carries one, not before: a vocabulary invented ahead
 * of its documents is a second answer to a question core's validator already
 * answers (§4.6).
 */

/** A tap, as a document stores it. */
export interface TapAction {
  do: string;
  /** A dashboard id, for `page`. */
  target?: string;
}

/** The keys a placement can hang an action on. `hold` is spoken for (§5.10). */
const TAP_KEYS = ['on_tap'] as const;

/**
 * The action a config declares, if it declares one.
 *
 * Returns undefined rather than a default: a widget with no `on_tap` is not a
 * widget whose tap does nothing, it is a widget whose tap is its own business.
 */
export function tapIn(config: Record<string, unknown> | undefined): TapAction | undefined {
  for (const key of TAP_KEYS) {
    const raw = config?.[key];
    if (raw === null || typeof raw !== 'object') continue;
    const verb = (raw as Record<string, unknown>)['do'];
    if (typeof verb !== 'string' || verb === '') continue;
    const target = (raw as Record<string, unknown>)['target'];
    return { do: verb, ...(typeof target === 'string' ? { target } : {}) };
  }
  return undefined;
}
