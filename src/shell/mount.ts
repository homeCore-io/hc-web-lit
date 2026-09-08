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
};

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
}
