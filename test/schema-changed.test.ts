/**
 * A schema changing is an event (core v0.1.69).
 *
 * Schemas are not static, which is the whole reason it exists: a Lutron
 * phantom scene upgrades its own about a second after the bridge connects,
 * once its LED query answers; hc-ecowitt republishes when a sensor's attribute
 * set changes; hc-hue when an aux device gains a facet; hc-zwave on rescan.
 * A client that renders controls from the schema — which is the point of
 * publishing one — would otherwise show that scene with no status until
 * somebody reloaded the page.
 *
 * The event carries the declared **names**, sorted, not the schema. So the
 * decision this client has to get right is *whether it cares*, and these pin
 * that: refetch when the declaration moved, and never when it did not.
 */
import { describe, expect, it, vi } from 'vitest';
import { DeviceStore } from '../src/core/store.js';
import type { DeviceState } from '../src/core/device.js';
import type { HcEvent } from '../src/core/events.js';

/** A Lutron phantom scene, before its LED query has answered. */
const scene = (over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: 'lutron_scene_deck_on',
  name: 'Deck On',
  plugin_id: 'plugin.lutron',
  available: true,
  attributes: {},
  last_seen: '2026-09-09T00:00:00Z',
  device_type: 'scene',
  schema: { attributes: {}, actions: [{ id: 'activate', label: 'Activate' }] },
  ...over,
});

const changed = (deviceId: string, attributes: string[], actions: string[]): HcEvent =>
  ({
    type: 'device_schema_changed',
    timestamp: '2026-09-09T00:00:01Z',
    device_id: deviceId,
    attributes,
    actions,
  }) as unknown as HcEvent;

describe('deciding whether a schema moved', () => {
  it('marks a device stale when it declares something new', () => {
    // The case the event exists for: the scene gains `on`, so it can finally
    // say whether it is applied.
    const store = new DeviceStore();
    store.reset([scene()]);
    const told = vi.fn();
    store.onSchemaStale = told;

    store.apply(changed('lutron_scene_deck_on', ['on', 'phantom_button'], ['activate']));

    expect(told).toHaveBeenCalledWith('lutron_scene_deck_on');
    expect(store.staleSchemas()).toEqual(['lutron_scene_deck_on']);
  });

  it('says nothing when the declaration is the one already held', () => {
    // hc-ecowitt republishes whenever a sensor's attribute set changes, and a
    // client that refetched on every event would refetch constantly.
    const store = new DeviceStore();
    store.reset([
      scene({
        schema: {
          attributes: { on: { kind: 'bool' } },
          actions: [{ id: 'activate', label: 'Activate' }],
        },
      }),
    ]);
    const told = vi.fn();
    store.onSchemaStale = told;

    store.apply(changed('lutron_scene_deck_on', ['on'], ['activate']));

    expect(told).not.toHaveBeenCalled();
    expect(store.staleSchemas()).toEqual([]);
  });

  it('notices an action appearing or disappearing, not only an attribute', () => {
    const store = new DeviceStore();
    store.reset([scene({ schema: { attributes: {}, actions: [] } })]);
    const told = vi.fn();
    store.onSchemaStale = told;

    store.apply(changed('lutron_scene_deck_on', [], ['activate']));
    expect(told).toHaveBeenCalled();
  });

  it('treats a device that had no schema at all as news', () => {
    // 184 of 184 declare one now, but a plugin that has not restarted since a
    // release publishes none — and gaining one is exactly what to notice.
    const store = new DeviceStore();
    store.reset([scene({ schema: null })]);
    const told = vi.fn();
    store.onSchemaStale = told;

    store.apply(changed('lutron_scene_deck_on', ['on'], ['activate']));
    expect(told).toHaveBeenCalled();
  });

  it('compares in order, because core sorts for exactly that reason', () => {
    // `attributes` is a HashMap in Rust, so two events describing one schema
    // would differ in order if core did not sort. It does; this relies on it,
    // and would be a set difference otherwise.
    const store = new DeviceStore();
    store.reset([
      scene({
        schema: {
          attributes: { phantom_button: { kind: 'integer' }, on: { kind: 'bool' } },
          actions: [{ id: 'activate', label: 'Activate' }],
        },
      }),
    ]);
    const told = vi.fn();
    store.onSchemaStale = told;

    // Object key order is insertion order; the comparison sorts both sides.
    store.apply(changed('lutron_scene_deck_on', ['on', 'phantom_button'], ['activate']));
    expect(told).not.toHaveBeenCalled();
  });

  it('ignores a device it has never heard of', () => {
    const store = new DeviceStore();
    const told = vi.fn();
    store.onSchemaStale = told;
    store.apply(changed('never_seen', ['on'], []));
    expect(told).not.toHaveBeenCalled();
  });
});

describe('taking the refetched schema', () => {
  it('puts it where every widget already reads it, and tells subscribers', () => {
    const store = new DeviceStore();
    store.reset([scene()]);
    const heard: DeviceState[][] = [];
    store.subscribe(['lutron_scene_deck_on'], (d) => heard.push(d));

    store.apply(changed('lutron_scene_deck_on', ['on'], ['activate']));
    store.setSchema('lutron_scene_deck_on', {
      attributes: { on: { kind: 'bool' } },
      actions: [{ id: 'activate', label: 'Activate' }],
    });

    const after = store.get('lutron_scene_deck_on');
    expect(after?.schema?.attributes?.['on']?.kind).toBe('bool');
    // A card renders from the schema, so it has to be told to redraw.
    expect(heard.length).toBeGreaterThan(1);
    expect(store.staleSchemas()).toEqual([]);
  });

  it('stops calling it stale even for a device that has gone', () => {
    // The refetch and the removal race; leaving the id in the set would mean
    // sweeping it forever.
    const store = new DeviceStore();
    store.reset([]);
    expect(() => store.setSchema('gone', null)).not.toThrow();
    expect(store.staleSchemas()).toEqual([]);
  });
});
