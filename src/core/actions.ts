/**
 * P9 — the action model (§5.10).
 *
 * One schema for "what happens when the user interacts", shared by every
 * widget, and dispatched by the **host** rather than by the widget. That is
 * what makes the safety policy (§11.3) enforceable in one place: a lock never
 * actuates from a plain tap regardless of what a widget's config says, and a
 * third-party widget cannot opt out by mishandling its own events.
 *
 * **The stored spelling is core's, not §5.10's.** The design record writes
 * `{type: "toggle"}`; every document in the reference house writes
 * `{"do": "page", "target": "…"}`, and the vocabulary declares `on_tap` as a
 * plain object on all 39 widget types. The document wins — a client that
 * reads its own spelling reads nothing. So `do` is the verb, and the extra
 * fields §5.10 names ride alongside it.
 *
 * `hold` defaults to `details` **everywhere** (§5.10), so there is always a
 * non-actuating way to inspect a device. That default lives here rather than
 * in each widget, which is the difference between a guarantee and a habit.
 */

/** What an interaction does. `do` is the verb; the rest depends on it. */
export interface ActionConfig {
  do: string;
  /** A dashboard id for `page`, a url for `url`, a device for `details`. */
  target?: string;
  /** For `service`: what to call, and with what. */
  service?: string;
  payload?: Record<string, unknown>;
  /** For `toggle` and `details`, when the widget is not already bound to one. */
  device_id?: string;
  /** `false` refuses a confirmation the host would otherwise ask for. */
  confirm?: { text?: string } | false;
}

/** The three gestures a placement can carry. */
export interface WidgetActions {
  tap?: ActionConfig;
  hold: ActionConfig;
  doubleTap?: ActionConfig;
}

const KEYS = { tap: 'on_tap', hold: 'on_hold', doubleTap: 'on_double_tap' } as const;

/** The verbs this client performs. An unknown one is said out loud, not ignored. */
export const VERBS = ['none', 'page', 'url', 'toggle', 'service', 'details', 'overlay'] as const;

function parse(raw: unknown): ActionConfig | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const verb = o['do'];
  if (typeof verb !== 'string' || verb === '') return undefined;

  const str = (k: string): string | undefined =>
    typeof o[k] === 'string' ? (o[k] as string) : undefined;
  return {
    do: verb,
    ...(str('target') !== undefined ? { target: str('target')! } : {}),
    ...(str('service') !== undefined ? { service: str('service')! } : {}),
    ...(str('device_id') !== undefined ? { device_id: str('device_id')! } : {}),
    ...(typeof o['payload'] === 'object' && o['payload'] !== null
      ? { payload: o['payload'] as Record<string, unknown> }
      : {}),
    ...(o['confirm'] === false || (typeof o['confirm'] === 'object' && o['confirm'] !== null)
      ? { confirm: o['confirm'] as { text?: string } | false }
      : {}),
  };
}

/** A single action off a config key. Kept for callers that want just the tap. */
export function tapIn(config: Record<string, unknown> | undefined): ActionConfig | undefined {
  return parse(config?.[KEYS.tap]);
}

/**
 * Every gesture a placement carries, with the defaults filled in.
 *
 * `hold` is never absent: §5.10 makes inspecting a device always available,
 * and a widget that declared no hold is a widget that did not think about it,
 * not one that wanted the gesture to do nothing.
 */
export function actionsIn(config: Record<string, unknown> | undefined): WidgetActions {
  const tap = parse(config?.[KEYS.tap]);
  const doubleTap = parse(config?.[KEYS.doubleTap]);
  return {
    ...(tap !== undefined ? { tap } : {}),
    ...(doubleTap !== undefined ? { doubleTap } : {}),
    hold: parse(config?.[KEYS.hold]) ?? { do: 'details' },
  };
}

/**
 * Whether a verb actuates something in the house.
 *
 * The safety policy applies to these and not to the rest: navigating to a page
 * or opening a sheet cannot unlock a door, so asking a person to confirm it
 * would teach them to confirm without reading (§11.3).
 */
export function actuates(a: ActionConfig): boolean {
  return a.do === 'toggle' || a.do === 'service';
}
