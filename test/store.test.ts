import { describe, expect, it, vi } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { DeviceStore } from '../src/core/store.js';

function device(id: string, attrs: Record<string, unknown> = {}): DeviceState {
  return {
    device_id: id,
    name: id,
    plugin_id: 'test',
    available: true,
    attributes: attrs,
    last_seen: '2026-09-07T00:00:00Z',
  };
}

const changed = (id: string, current: Record<string, unknown>) => ({
  type: 'device_state_changed' as const,
  timestamp: '2026-09-07T00:00:01Z',
  device_id: id,
  previous: {},
  current,
  changed: Object.keys(current),
});

describe('DeviceStore', () => {
  it('calls back immediately, so a quiet device still renders on connect', () => {
    const store = new DeviceStore();
    store.reset([device('a', { on: true })]);

    const seen = vi.fn();
    store.subscribe(['a'], seen);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]).toEqual([device('a', { on: true })]);
  });

  it('tells a subscriber about its own device and nobody else', () => {
    const store = new DeviceStore();
    store.reset([device('a'), device('b')]);

    const watchingA = vi.fn();
    const watchingB = vi.fn();
    store.subscribe(['a'], watchingA);
    store.subscribe(['b'], watchingB);
    watchingA.mockClear();
    watchingB.mockClear();

    store.apply(changed('a', { on: true }));

    // This is the whole point of the primitive: b's widget does not re-render
    // because a light in another room came on.
    expect(watchingA).toHaveBeenCalledTimes(1);
    expect(watchingB).not.toHaveBeenCalled();
  });

  it('replaces the attribute map rather than merging it', () => {
    const store = new DeviceStore();
    store.reset([device('a', { on: true, brightness_pct: 50 })]);

    // The device stopped reporting brightness. A merge would resurrect it.
    store.apply(changed('a', { on: false }));

    expect(store.get('a')?.attributes).toEqual({ on: false });
  });

  it('keeps everything else about the device', () => {
    const store = new DeviceStore();
    const d = { ...device('a'), area: 'kitchen', device_type: 'light' };
    store.reset([d]);

    store.apply(changed('a', { on: true }));

    const after = store.get('a');
    expect(after?.area).toBe('kitchen');
    expect(after?.device_type).toBe('light');
  });

  it('applies an availability change without touching attributes', () => {
    const store = new DeviceStore();
    store.reset([device('a', { on: true })]);

    store.apply({
      type: 'device_availability_changed',
      timestamp: '2026-09-07T00:00:01Z',
      device_id: 'a',
      available: false,
    });

    expect(store.get('a')?.available).toBe(false);
    expect(store.get('a')?.attributes).toEqual({ on: true });
  });

  it('ignores an event for a device it has never seen', () => {
    const store = new DeviceStore();
    store.reset([device('a')]);
    expect(() => store.apply(changed('ghost', { on: true }))).not.toThrow();
    expect(store.size).toBe(1);
  });

  it('stops calling back after unsubscribe', () => {
    const store = new DeviceStore();
    store.reset([device('a')]);

    const seen = vi.fn();
    const off = store.subscribe(['a'], seen);
    seen.mockClear();
    off();

    store.apply(changed('a', { on: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it('survives a listener unsubscribing from inside its own callback', () => {
    // Mutating a Set while iterating it silently skips entries, and a widget
    // that tears itself down on first state is a perfectly ordinary thing.
    const store = new DeviceStore();
    store.reset([device('a')]);

    const second = vi.fn();
    let off: (() => void) | undefined;
    off = store.subscribe(['a'], () => off?.());
    store.subscribe(['a'], second);
    second.mockClear();

    expect(() => store.apply(changed('a', { on: true }))).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('notifies an all-devices subscriber on any change', () => {
    const store = new DeviceStore();
    store.reset([device('a'), device('b')]);

    const everything = vi.fn();
    store.subscribeAll(everything);
    everything.mockClear();

    store.apply(changed('b', { on: true }));
    expect(everything).toHaveBeenCalledTimes(1);
    expect(everything.mock.calls[0]?.[0]).toHaveLength(2);
  });
});
