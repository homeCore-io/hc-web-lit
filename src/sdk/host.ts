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
import type { MountEnv, WidgetSpec } from '../shell/mount.js';
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
