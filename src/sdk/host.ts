/**
 * Building an `HcContext` from what the host has.
 *
 * The adapter, kept apart from the interface so the interface stays the thing
 * an extension author reads. Everything here is a narrowing: the host holds a
 * store, an API client and an overlay stack, and a widget gets functions over
 * them and never the things themselves (§19.4).
 */
import { evaluate, type ExprScope } from '../core/expr.js';
import { runQuery, type DeviceQuery } from '../core/query.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest, EventFetch, HistoryFetch, WidgetSpec } from '../core/widget.js';
import type { ActionConfig } from '../core/actions.js';
import type { DeviceStore } from '../core/store.js';
import type { SelectionContext } from '../core/selection.js';
import type { TemplateStore } from '../core/templates.js';
import type { PluginRunner } from '../core/plugins.js';
import type { IconRule } from '../design/icons.js';
import type { Tokens } from '../design/tokens.js';

/**
 * Everything a widget is given that it cannot reach for itself.
 *
 * The host fills this in and `contextFor` narrows it into an `HcContext`. It
 * lives here rather than in the shell because the SDK is what an extension
 * reads: a package cannot depend on the application that contains it, and this
 * type is half the definition of what a host *is*.
 */
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
  /** Album or channel art, fetched by the host because it needs the bearer. */
  onArt?: (deviceId: string) => Promise<string | undefined>;
  /**
   * What the plugins can be asked to do (§5.11).
   *
   * A capability rather than a client: the widget names an operation a plugin
   * declared and the host performs it, so §19.4 holds here as everywhere —
   * nothing but the host touches the socket or the token.
   */
  plugins?: PluginRunner;
  /**
   * Correct a device's presentation — `ui_hint`, `area`, a name (§1.1).
   *
   * A capability rather than a client: the widget names the change and the
   * host performs it, so §19.4 holds here as everywhere.
   */
  onUpdateDevice?: (deviceId: string, patch: Record<string, unknown>) => Promise<void>;
  /**
   * Save the household's icon rules and put them into force (§11.2).
   *
   * A capability rather than the store itself: the rules are module state by
   * design (`icons.ts`), and what a widget needs is the ability to *change*
   * them, not a reference to where they live.
   */
  onSaveIconRules?: (rules: IconRule[]) => void;
  /**
   * What this session may do, from `/auth/me` (§5.11).
   *
   * So a control gated on `requires_role` is not offered rather than being
   * offered and refused — §5.10's reasoning about actions, one level up.
   */
  scopes?: readonly string[];
  /** Resolved design tokens, so a widget restyles with the house (§15). */
  tokens?: Tokens;
  /** Editing or viewing (§14.2). */
  mode?: 'view' | 'edit';
}
import type { HcContext, QueryResult, Unsubscribe } from './context.js';

/**
 * The context for one widget.
 *
 * Built per widget rather than shared, because `subscribe` and `details` are
 * about *this* widget, and because a context that outlived its element would
 * keep a listener alive after the thing that wanted it was gone.
 */
export function contextFor(env: MountEnv, spec: WidgetSpec): HcContext {
  const store = env.store;

  return {
    subscribe(deviceIds: readonly string[], cb: (states: DeviceState[]) => void): Unsubscribe {
      // Without a store there is nothing to hear from, and returning a
      // no-op teardown is kinder than making every caller check.
      return store?.subscribe(deviceIds, cb) ?? (() => undefined);
    },

    device(deviceId: string): DeviceState | undefined {
      return store?.get(deviceId);
    },

    query(q: DeviceQuery): QueryResult {
      return runQuery(q, store?.list() ?? []);
    },

    expr(source: string, scope: ExprScope = {}): unknown {
      // The bound device is in scope without the widget passing it, because a
      // widget that had to assemble its own scope would assemble it wrongly.
      const named = spec.config?.['device_id'];
      const device = typeof named === 'string' ? store?.get(named) : undefined;
      const devices: Record<string, DeviceState> = {};
      for (const d of store?.list() ?? []) devices[d.device_id] = d;
      return evaluate(source, { devices, ...(device !== undefined ? { device } : {}), ...scope });
    },

    call(request) {
      env.onCommand?.(request);
    },

    action(action) {
      env.onAction?.(action);
    },

    async history(deviceId, opts) {
      return (await env.onFetch?.(deviceId, opts)) ?? [];
    },

    async art(deviceId) {
      return env.onArt?.(deviceId);
    },

    sheet(content) {
      env.onSheet?.(content);
    },

    details(deviceId) {
      env.onDetails?.(deviceId);
    },

    template(id) {
      const found = env.templates?.get(id);
      return found?.widget;
    },

    ...(env.tokens !== undefined ? { tokens: env.tokens } : {}),
    mode: env.mode ?? 'view',
  };
}
