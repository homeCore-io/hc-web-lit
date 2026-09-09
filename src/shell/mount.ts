/**
 * Wiring a widget to the house — the one implementation (§5.6, §14.1).
 *
 * `hc-page` draws widgets into a layout and the overlay draws one into a sheet,
 * and both have to hand it the same things: a config with `@room` and
 * `bindings` already resolved, the device or the store, and the host callbacks
 * a widget uses instead of holding an API client (§19.4). Two copies of that
 * list would drift, and the drift would be a widget that works on a page and
 * not in a sheet — which is the kind of bug nobody finds until a user does.
 */
import type { CommandRequest } from '../core/widget.js';
import type { WidgetSpec } from '../core/widget.js';
import type { MountEnv } from '../sdk/host.js';
import type { HistoryFetch } from '../widgets/hc-history-chart.js';
import type { EventFetch } from '../widgets/hc-event-feed.js';
import { resolveConfig } from '../core/bindings.js';
import type { SelectionContext } from '../core/selection.js';
import { actionsIn, type ActionConfig } from '../core/actions.js';
import { resolveInstance } from '../core/templates.js';
import { tagFor } from '../core/registry.js';
import type { HcContext } from '../sdk/context.js';
import { contextFor } from '../sdk/host.js';

/** The properties a mounted widget may be given. */
export type { MountEnv, WidgetSpec };

export type MountTarget = HTMLElement & {
  config?: Record<string, unknown>;
  device?: unknown;
  devices?: readonly unknown[];
  context?: SelectionContext;
  onCommand?: (r: CommandRequest) => void;
  onFetch?: HistoryFetch;
  onEvents?: EventFetch;
  onPick?: (deviceId: string) => void;
  onOpenRoom?: (room: string, page: string | undefined) => void;
  onDetails?: (deviceId: string) => void;
  /** Album or channel art, fetched by the host because it needs the bearer. */
  onArt?: (deviceId: string) => Promise<string | undefined>;
  /**
   * Everything the host gives a widget, handed over whole.
   *
   * A container has to mount its own children, and it cannot do that from the
   * individual callbacks — it needs the same env the page used. This is
   * §4.2's `HcContext` arriving where it was always going to be needed, shaped
   * by what real widgets ask for rather than by a guess ahead of them.
   */
  env?: MountEnv;
  /** Set on a child: it is inside something, so it draws no chrome (§5.5). */
  nested?: boolean;
  /**
   * The capability object (§4.2).
   *
   * Set on every widget alongside the individual properties, which are the
   * same capabilities handed over one at a time. The properties came first and
   * are what the shape was learned from; this is that shape named, and what a
   * widget written against the SDK will use.
   */
  ctx?: HcContext;
};

/** Elements already carrying a tap, so a re-render does not stack listeners. */
const tapped = new WeakSet<HTMLElement>();

/**
 * The widget a placement actually means.
 *
 * A template instance holds a reference and is resolved here, at render, which
 * is what makes it a reference: editing the template lands on every instance
 * on the next frame with nothing to migrate (§5.4).
 */
export function specFor(w: WidgetSpec, env: MountEnv): WidgetSpec {
  const got = resolveInstance(w, env.templates);
  if (got === undefined) return w;
  if ('missing' in got) {
    // Said out loud rather than drawn as nothing: a page quietly missing a
    // widget is how a broken reference hides for months.
    return { type: 'unknown', config: { text: `No template "${got.missing}"` } };
  }
  return got.spec;
}

/**
 * Set a property, unless the widget computes it.
 *
 * The host hands a widget its capabilities by assignment, which is fine for a
 * widget that declares them as reactive properties and wrong as an assumption
 * about every widget that will ever exist. An SDK widget takes `config` and
 * `ctx` and quite reasonably *derives* the rest — `hc-button` has
 * `get device() { … }` reading `config.device_id`, which is exactly what §4.2
 * intends — and assigning over a getter throws `TypeError` in a module.
 *
 * That throw happened inside `hc-page`'s render, so it did not break one
 * widget: it aborted the whole page and left the previous frame's DOM on
 * screen, with the new document already installed. The symptom was a page
 * that had silently stopped updating. Found by loading the acceptance-gate
 * extension for real (§7.4), which is what that gate is for.
 *
 * So: a widget that computes a value keeps its own, and is not overwritten by
 * a host that assumed it would not.
 */
function give<K extends keyof MountTarget>(el: MountTarget, key: K, value: MountTarget[K]): void {
  for (let o: object | null = el; o !== null; o = Object.getPrototypeOf(o) as object | null) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d === undefined) continue;
    // An accessor with no setter is a deliberate computation, not a slot.
    if (d.get !== undefined && d.set === undefined) return;
    break;
  }
  el[key] = value;
}

export function mountWidget(el: MountTarget, w: WidgetSpec, env: MountEnv): void {
  // Live values in, at the seam — `bindings` and `count` (§14.1). A widget gets
  // a config with the house already in it and never learns the mechanism,
  // exactly as it never learns what `@room` means.
  give(el, 'config', resolveConfig(w.config ?? {}, env.store?.list() ?? [], env.context));

  // A widget that names one device gets it resolved; one that selects a set
  // gets the whole store and does its own selecting, because the selection is
  // live — a device appearing in a room has to appear in the list.
  const deviceId = w.config?.['device_id'];
  if (typeof deviceId === 'string') {
    give(
      el,
      'device',
      env.store?.get(deviceId === '@picked' ? (env.context.picked ?? deviceId) : deviceId),
    );
  }
  if (env.store !== undefined) give(el, 'devices', env.store.list());

  give(el, 'context', env.context);
  if (env.onPick !== undefined) give(el, 'onPick', env.onPick);
  if (env.onOpenRoom !== undefined) give(el, 'onOpenRoom', env.onOpenRoom);
  if (env.onDetails !== undefined) give(el, 'onDetails', env.onDetails);
  if (env.onCommand !== undefined) give(el, 'onCommand', env.onCommand);
  if (env.onFetch !== undefined) give(el, 'onFetch', env.onFetch);
  if (env.onEvents !== undefined) give(el, 'onEvents', env.onEvents);
  if (env.onArt !== undefined) give(el, 'onArt', env.onArt);

  // A container mounts its own children and needs what the page had.
  give(el, 'env', env);
  el.ctx = contextFor(env, w);

  attachActions(el, w, env);
}

/**
 * Build and wire one child of a container.
 *
 * The child is a widget like any other — same registry, same wiring, same
 * template resolution — except that it knows it is nested, which is what
 * suppresses its chrome (§5.5).
 */
export function mountChild(spec: WidgetSpec, env: MountEnv): HTMLElement | undefined {
  const resolved = specFor(spec, env);
  const tag = tagFor(resolved.type);
  if (tag === undefined) return undefined;
  const el = document.createElement(tag) as MountTarget;
  el.nested = true;
  mountWidget(el, resolved, env);
  return el;
}

/**
 * A container's children, reused across renders.
 *
 * `mountChild` builds a fresh element every time, which is right for a one-off
 * and wrong for a container: a page re-renders on every device change, and the
 * reference house streams 184 devices. Rebuilding then destroys and recreates
 * every child several times a second — a visible flicker, a history chart that
 * re-fetches six hours of readings each time, and any state a child holds
 * (a scroll position, an expanded section) thrown away before anyone can use
 * it. `hc-page` solved this for placements with a cache keyed by widget id;
 * containers had no equivalent.
 *
 * **Keyed by position and type**, because a child spec carries no id of its
 * own — it is a `WidgetSpec` inside a config, not a `DashboardWidget`. That is
 * stable while the list is, and a reordered list rebuilds, which is correct
 * rather than merely acceptable: position is the only identity the document
 * gives these, so two children swapping places really are different children
 * as far as anything here can tell.
 *
 * The cache belongs to the container and is passed in, so a container that is
 * removed takes its children with it.
 */
export function mountChildren(
  specs: readonly WidgetSpec[],
  env: MountEnv,
  cache: Map<string, HTMLElement>,
): (HTMLElement | undefined)[] {
  const live = new Set<string>();

  const out = specs.map((spec, i) => {
    const resolved = specFor(spec, env);
    const key = `${i}:${resolved.type}`;
    live.add(key);

    const cached = cache.get(key);
    if (cached !== undefined) {
      mountWidget(cached as MountTarget, resolved, env);
      return cached;
    }

    const el = mountChild(spec, env);
    if (el !== undefined) cache.set(key, el);
    return el;
  });

  // A child that is no longer in the config is not coming back, and a cache
  // that only ever grows is a leak on a panel that runs for months.
  for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key);

  return out;
}

/**
 * A placement's gestures, dispatched by the host.
 *
 * Here rather than in each widget, for the reason §5.10 gives: the widget does
 * not decide what its gestures mean, so it cannot decline the safety policy,
 * and a decorative text somebody else wrote gets them without knowing the
 * words. `hold` is always wired, because §5.10 makes inspecting a device
 * always available — a guarantee, not a habit each widget keeps.
 *
 * Attached once. `mountWidget` runs on every render — 184 devices on a stream
 * is continuous — and a listener per render is a page that navigates four
 * times for one press.
 */
function attachActions(el: MountTarget, w: WidgetSpec, env: MountEnv): void {
  if (env.onAction === undefined || tapped.has(el)) return;
  tapped.add(el);

  // Read at press time, so a re-render with a different target is honoured.
  const now = (): ReturnType<typeof actionsIn> => actionsIn(w.config);
  const run = (a: ActionConfig | undefined): void => {
    if (a === undefined || a.do === 'none') return;
    env.onAction?.(a);
  };

  const declared = now();
  if (declared.tap !== undefined) {
    el.style.cursor = 'pointer';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
  }

  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let held = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    timer = globalThis.setTimeout(() => {
      timer = 0;
      held = true;
      run(now().hold);
    }, HOLD_MS);
  });

  const cancel = (): void => {
    if (timer !== 0) globalThis.clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);

  el.addEventListener('click', (e) => {
    // A hold that fired has already done the thing; letting the click through
    // would also toggle the light it was held to inspect, which is the one
    // outcome a non-actuating gesture must never have.
    if (held) {
      held = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    run(now().tap);
  });

  el.addEventListener('dblclick', () => run(now().doubleTap));

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    run(now().tap);
  });

  // On touch the platform's own long-press lands here, and the sheet is what
  // the gesture is for on a wall panel rather than a selection menu.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** How long is a hold — the same 500ms the platform waits before a menu. */
const HOLD_MS = 500;
