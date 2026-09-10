/**
 * The house as it was, for a panel that came back before the network did
 * (§16, `last-known.ts`).
 *
 * The failure this defends against is narrow and bad: a wall tablet reboots
 * during an outage, the service worker serves the shell from cache, the first
 * request fails, and a dashboard somebody relies on is an error message. What
 * these pin is that the restored view is *honest* — old, and saying so.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pagesToShow, LastKnown, ageOf, type Snapshot } from '../src/core/last-known.js';
import type { DeviceState } from '../src/core/device.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';

const device = (id: string): DeviceState => ({
  device_id: id,
  name: id,
  plugin_id: 'p',
  available: true,
  attributes: { on: true },
  last_seen: '2026-09-09T00:00:00Z',
});

const dashboard: DashboardDefinition = {
  id: 'd',
  name: 'D',
  icon: 'home',
  owner_user_id: 'u',
};

beforeEach(() => globalThis.localStorage?.clear());
afterEach(() => globalThis.localStorage?.clear());

describe('keeping what the house looked like', () => {
  it('round-trips devices and dashboards', () => {
    const store = new LastKnown({ now: () => 1000 });
    expect(store.saveNow([device('lamp')], [dashboard])).toBe(true);

    const got = store.load();
    expect(got?.at).toBe(1000);
    expect(got?.devices.map((d) => d.device_id)).toEqual(['lamp']);
    expect(got?.dashboards.map((d) => d.id)).toEqual(['d']);
  });

  it('keeps the schema, because a house without one looks broken differently', () => {
    // 287KB with schemas against 118KB without, and both fit the budget many
    // times over. The smaller one restores lights with no brightness control.
    const withSchema = {
      ...device('lamp'),
      schema: {
        primary: ['on'],
        attributes: { on: { kind: 'bool', writable: true } },
        actions: [],
      },
    } as DeviceState;

    new LastKnown({ now: () => 1 }).saveNow([withSchema], [dashboard]);
    expect(new LastKnown().load()?.devices[0]?.schema?.attributes?.['on']?.writable).toBe(true);
  });

  it('has nothing to say before anything is saved', () => {
    expect(new LastKnown().load()).toBeUndefined();
  });
});

describe('how often it writes', () => {
  it('refuses one that comes too soon', () => {
    // A panel persisting 300KB on every device event would write hundreds of
    // megabytes a day to a tablet's flash against an outage that may not come.
    let now = 0;
    const store = new LastKnown({ everyMs: 60_000, now: () => now });

    expect(store.save([device('a')], [dashboard])).toBe(true);
    now = 30_000;
    expect(store.save([device('b')], [dashboard])).toBe(false);
    now = 61_000;
    expect(store.save([device('c')], [dashboard])).toBe(true);
    expect(store.load()?.devices[0]?.device_id).toBe('c');
  });

  it('writes anyway when the page is going away', () => {
    // `pagehide` is the last chance to record what this panel knew, and the
    // interval must not be the thing that loses it.
    let now = 0;
    const store = new LastKnown({ everyMs: 60_000, now: () => now });
    store.save([device('a')], [dashboard]);

    now = 1_000;
    expect(store.saveNow([device('b')], [dashboard])).toBe(true);
    expect(store.load()?.devices[0]?.device_id).toBe('b');
  });
});

describe('how old the restored view is', () => {
  it('is measured from when it was true, not from when it was read', () => {
    // The whole honesty of the feature: a view restored from four hours ago
    // must say four hours. A panel that looks live and is not is the single
    // worst thing this client could do.
    const snapshot: Snapshot = { at: 1_000_000, devices: [], dashboards: [] };
    expect(ageOf(snapshot, 1_000_000 + 4 * 3_600_000)).toBe(4 * 3_600_000);
  });

  it('never reports a negative age from a clock that moved backwards', () => {
    expect(ageOf({ at: 2_000, devices: [], dashboards: [] }, 1_000)).toBe(0);
  });
});

describe('storage that will not cooperate', () => {
  it('reads nothing rather than throwing', () => {
    globalThis.localStorage?.setItem('hc.last-known', 'not json');
    expect(new LastKnown().load()).toBeUndefined();

    globalThis.localStorage?.setItem('hc.last-known', JSON.stringify({ at: 'soon' }));
    expect(new LastKnown().load()).toBeUndefined();
  });

  it('survives a store that throws on every call', () => {
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem() {
          throw new Error('denied');
        },
        setItem() {
          throw new Error('quota');
        },
        removeItem() {
          throw new Error('denied');
        },
      },
      configurable: true,
    });
    try {
      const store = new LastKnown();
      // A panel with no snapshot is the situation this exists to improve, not
      // one to fail over.
      expect(store.saveNow([device('a')], [dashboard])).toBe(false);
      expect(store.load()).toBeUndefined();
      expect(() => store.forget()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
  });

  it('does not retry a full disk on every event', () => {
    // A failed write still counts as an attempt, or a quota error turns into
    // 300KB of serialisation per device update.
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem() {
          throw new Error('quota');
        },
        removeItem: () => undefined,
      },
      configurable: true,
    });
    try {
      let now = 0;
      const store = new LastKnown({ everyMs: 60_000, now: () => now });
      expect(store.save([device('a')], [dashboard])).toBe(false);
      now = 1_000;
      expect(store.save([device('a')], [dashboard])).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
  });
});

describe('which pages a restored panel draws', () => {
  it('prefers the stored document to the snapshot’s copy of it', () => {
    // A snapshot is a photograph taken every few minutes; a page is a
    // document somebody edited, possibly since. Restoring the photograph over
    // the document would quietly undo yesterday's edit, and the panel would
    // look fine while doing it.
    expect(pagesToShow(['edited'], ['old'])).toEqual(['edited']);
  });

  it('falls back to the snapshot when this client’s store is unreachable too', () => {
    // Which on a static deployment is the same outage.
    expect(pagesToShow([], ['old'])).toEqual(['old']);
  });

  it('has nothing to draw when neither has anything', () => {
    expect(pagesToShow([], [])).toEqual([]);
  });
});
