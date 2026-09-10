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
import type { DeviceSchema } from './api.js';
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
      return;
    }

    if (event.type === 'device_schema_changed') {
      // The event carries the declared *names*, not the schema, so a client
      // can tell whether it cares before refetching. This is where "whether it
      // cares" is decided; the refetch is the shell's, because it needs the
      // API client (§19.4).
      const e = event as unknown as {
        device_id: string;
        attributes?: string[];
        actions?: string[];
      };
      const existing = this.devices.get(e.device_id);
      if (existing === undefined) return;
      if (!this.schemaMoved(existing, e.attributes ?? [], e.actions ?? [])) return;
      this.stale.add(e.device_id);
      this.onSchemaStale?.(e.device_id);
    }
  }

  /**
   * Devices whose declared schema has moved since it was last fetched.
   *
   * Held so a shell that is offline, or busy, can catch up later rather than
   * losing the fact that a schema changed while it was not listening.
   */
  private readonly stale = new Set<string>();

  /** Told when a device's declaration no longer matches what is held. */
  onSchemaStale: ((deviceId: string) => void) | undefined;

  /** Which devices are waiting for a refetched schema. */
  staleSchemas(): string[] {
    return [...this.stale];
  }

  /**
   * Take a freshly fetched schema, and stop calling that device stale.
   *
   * Separate from `apply` because fetching needs the API client and a store
   * does not have one — the same split every other capability follows.
   */
  setSchema(deviceId: string, schema: DeviceSchema | null): void {
    const existing = this.devices.get(deviceId);
    this.stale.delete(deviceId);
    if (existing === undefined) return;
    this.devices.set(deviceId, { ...existing, schema });
    this.notify(deviceId);
  }

  /**
   * Whether this event describes a schema the store does not already have.
   *
   * **The comparison is why the event carries names.** A Lutron phantom scene
   * republishes its schema about a second after the bridge connects, and
   * hc-ecowitt republishes whenever a sensor's attribute set changes — so a
   * client that refetched on every event would refetch constantly, and one
   * that never refetched would render a scene with no status until somebody
   * reloaded the page. Comparing first is what makes the middle path cheap.
   *
   * Core sorts both lists before sending, precisely so this comparison is a
   * comparison and not a set difference: `attributes` is a `HashMap` in Rust
   * and two events describing one schema would otherwise differ in order.
   */
  private schemaMoved(
    device: DeviceState,
    attributes: readonly string[],
    actions: readonly string[],
  ): boolean {
    const held = device.schema;
    // No schema held at all: anything declared is news.
    if (held === undefined || held === null) return attributes.length > 0 || actions.length > 0;

    const heldAttributes = Object.keys(held.attributes ?? {}).sort();
    const heldActions = (held.actions ?? []).map((a) => a.id).sort();
    return (
      heldAttributes.length !== attributes.length ||
      heldActions.length !== actions.length ||
      heldAttributes.some((k, i) => k !== attributes[i]) ||
      heldActions.some((k, i) => k !== actions[i])
    );
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
