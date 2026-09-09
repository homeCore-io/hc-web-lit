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
import type { CommandRequest } from '../widgets/hc-controls.js';
import type { HistoryFetch } from '../widgets/hc-history-chart.js';
import type { EventFetch } from '../widgets/hc-event-feed.js';
import { resolveConfig } from '../core/bindings.js';
import type { SelectionContext } from '../core/selection.js';
import type { DeviceStore } from '../core/store.js';
import { actionsIn, type ActionConfig } from '../core/actions.js';
import { resolveInstance, type TemplateStore } from '../core/templates.js';
import { tagFor } from '../widgets/registry.js';
import type { Tokens } from '../design/tokens.js';
import type { HcContext } from '../sdk/context.js';
import { contextFor } from '../sdk/host.js';

/** A widget instance as the document stores it. */
export interface WidgetSpec {
  type: string;
  config?: Record<string, unknown>;
}

/** Everything a widget is given that it cannot reach for itself. */
export interface MountEnv {
  store: DeviceStore | undefined;
  context: SelectionContext;
  onCommand?: (r: CommandRequest) => void;
  onFetch?: HistoryFetch;
  onEvents?: EventFetch;
  /** A widget saying what was touched; the host owns what `@picked` means. */
  onPick?: (deviceId: string) => void;
  onOpenRoom?: (room: string, page: string | undefined) => void;
  /** The non-actuating way to inspect a device (§5.10) — hold, everywhere. */
  onDetails?: (deviceId: string) => void;
  /** What a placement's `on_tap` does. The host dispatches it (§5.10). */
  onAction?: (a: ActionConfig) => void;
  /** Where widget templates come from (§5.4). Absent means none are defined. */
  templates?: TemplateStore;
  /** Open a sheet on a widget spec (§5.6). */
  onSheet?: (content: WidgetSpec) => void;
  /** Resolved design tokens, so a widget restyles with the house (§15). */
  tokens?: Tokens;
  /** Editing or viewing (§14.2). */
  mode?: 'view' | 'edit';
}

/** The properties a mounted widget may be given. */
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

export function mountWidget(el: MountTarget, w: WidgetSpec, env: MountEnv): void {
  // Live values in, at the seam — `bindings` and `count` (§14.1). A widget gets
  // a config with the house already in it and never learns the mechanism,
  // exactly as it never learns what `@room` means.
  el.config = resolveConfig(w.config ?? {}, env.store?.list() ?? [], env.context);

  // A widget that names one device gets it resolved; one that selects a set
  // gets the whole store and does its own selecting, because the selection is
  // live — a device appearing in a room has to appear in the list.
  const deviceId = w.config?.['device_id'];
  if (typeof deviceId === 'string') {
    el.device = env.store?.get(
      deviceId === '@picked' ? (env.context.picked ?? deviceId) : deviceId,
    );
  }
  if (env.store !== undefined) el.devices = env.store.list();

  el.context = env.context;
  if (env.onPick !== undefined) el.onPick = env.onPick;
  if (env.onOpenRoom !== undefined) el.onOpenRoom = env.onOpenRoom;
  if (env.onDetails !== undefined) el.onDetails = env.onDetails;
  if (env.onCommand !== undefined) el.onCommand = env.onCommand;
  if (env.onFetch !== undefined) el.onFetch = env.onFetch;
  if (env.onEvents !== undefined) el.onEvents = env.onEvents;

  // A container mounts its own children and needs what the page had.
  el.env = env;
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
