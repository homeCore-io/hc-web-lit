/**
 * The device store, and the per-device subscription fan-out.
 *
 * **This is the primitive §4.2 is about.** Home Assistant sets a whole `hass`
 * object on every card on every state change, so every card re-renders when any
 * entity moves. A widget here declares the devices it reads and hears about
 * those and nothing else.
 *
 * The fan-out is client-side, and deliberately so for now: core's stream takes
 * one `device_id` filter or none (`core/docs/openapi.yaml`, `streamEvents`), so
 * a scoped subscription cannot yet be pushed to the server. §17 lists that as an
 * API addition. Doing it here first means widgets are written against the final
 * shape and the server-side filter is a later optimisation nobody has to
 * migrate for.
 */
import type { DeviceState } from './device.js';
import type { HcEvent } from './events.js';

export type Unsubscribe = () => void;
type Listener = (devices: DeviceState[]) => void;

export class DeviceStore {
  private readonly devices = new Map<string, DeviceState>();
  /** device_id -> the listeners that asked for it. */
  private readonly watchers = new Map<string, Set<Listener>>();
  /** Listeners that asked for every device — the designer, a query view. */
  private readonly all = new Set<Listener>();

  /** Replace everything, as after `listDevices`. */
  reset(devices: readonly DeviceState[]): void {
    this.devices.clear();
    for (const d of devices) this.devices.set(d.device_id, d);
    this.notifyAll();
  }

  get(deviceId: string): DeviceState | undefined {
    return this.devices.get(deviceId);
  }

  list(): DeviceState[] {
    return [...this.devices.values()];
  }

  get size(): number {
    return this.devices.size;
  }

  /**
   * Hear about these devices, and only these.
   *
   * The callback fires once immediately with what is already known, so a widget
   * renders on connect rather than on the next change — which for a quiet
   * sensor could be an hour away.
   */
  subscribe(deviceIds: readonly string[], cb: Listener): Unsubscribe {
    const ids = [...deviceIds];
    for (const id of ids) {
      let set = this.watchers.get(id);
      if (set === undefined) {
        set = new Set();
        this.watchers.set(id, set);
      }
      set.add(cb);
    }
    cb(this.snapshot(ids));

    return () => {
      for (const id of ids) {
        const set = this.watchers.get(id);
        if (set === undefined) continue;
        set.delete(cb);
        if (set.size === 0) this.watchers.delete(id);
      }
    };
  }

  /** Hear about every device. For views that are about the set, not a device. */
  subscribeAll(cb: Listener): Unsubscribe {
    this.all.add(cb);
    cb(this.list());
    return () => {
      this.all.delete(cb);
    };
  }

  /**
   * Fold one event in.
   *
   * `current` is the whole attribute map afterwards, not a delta, so it
   * replaces rather than merges — a merge would resurrect an attribute the
   * device stopped reporting, and `changed` explicitly includes removals.
   */
  apply(event: HcEvent): void {
    if (event.type === 'device_state_changed') {
      const e = event as {
        device_id: string;
        current: Record<string, unknown>;
        device_name?: string;
      };
      const existing = this.devices.get(e.device_id);
      if (existing === undefined) return; // Unknown device; a reset will bring it.
      this.devices.set(e.device_id, { ...existing, attributes: e.current });
      this.notify(e.device_id);
      return;
    }

    if (event.type === 'device_availability_changed') {
      const e = event as { device_id: string; available: boolean };
      const existing = this.devices.get(e.device_id);
      if (existing === undefined) return;
      this.devices.set(e.device_id, { ...existing, available: e.available });
      this.notify(e.device_id);
    }
  }

  private snapshot(ids: readonly string[]): DeviceState[] {
    const out: DeviceState[] = [];
    for (const id of ids) {
      const d = this.devices.get(id);
      if (d !== undefined) out.push(d);
    }
    return out;
  }

  private notify(deviceId: string): void {
    const set = this.watchers.get(deviceId);
    if (set !== undefined) {
      const d = this.devices.get(deviceId);
      const payload = d === undefined ? [] : [d];
      // Copied before iterating: a listener may unsubscribe from inside its own
      // callback, and mutating a Set while iterating it silently skips entries.
      for (const cb of [...set]) cb(payload);
    }
    this.notifyAll();
  }

  private notifyAll(): void {
    if (this.all.size === 0) return;
    const everything = this.list();
    for (const cb of [...this.all]) cb(everything);
  }
}
