import { describe, expect, it } from 'vitest';
import { knownWatches, noticesFor, severityOf } from '../src/core/attention.js';
import type { DeviceState } from '../src/core/device.js';

const d = (over: Partial<DeviceState> & { device_id: string }): DeviceState => ({
  name: over.device_id,
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-08T00:00:00Z',
  ...over,
});

describe('noticesFor', () => {
  it('says nothing when there is nothing to say', () => {
    // The good case, and the widget renders it as reassurance rather than as
    // an empty list.
    expect(noticesFor({}, [d({ device_id: 'a', attributes: { battery: 95 } })])).toEqual([]);
  });

  it('notices a battery under the threshold the document set', () => {
    const house = [
      d({ device_id: 'low', name: 'Hall Lock', attributes: { battery: 12 } }),
      d({ device_id: 'fine', attributes: { battery: 80 } }),
    ];
    expect(noticesFor({ watch: ['batteries'] }, house).map((n) => n.deviceId)).toEqual(['low']);
    // The document can move the line, and moving it is the point of the field.
    expect(noticesFor({ watch: ['batteries'], low_battery: 5 }, house)).toEqual([]);
  });

  it('ignores a battery reported as zero on a device that is plainly alive', () => {
    // A plugin that has not learned to read the cell reports 0. Saying "0%"
    // about a working sensor is worse than saying nothing.
    expect(
      noticesFor({ watch: ['batteries'] }, [d({ device_id: 'a', attributes: { battery: 0 } })]),
    ).toEqual([]);
  });

  it('takes battery_low from a device that reports no number', () => {
    const got = noticesFor({ watch: ['batteries'] }, [
      d({ device_id: 'a', attributes: { battery_low: true } }),
    ]);
    expect(got[0]?.detail).toBe('battery low');
  });

  it('believes the device s own verdict over its number', () => {
    // Ecowitt publishes `battery` as 0/1 on a WH31 (1 means low) and 0-5 on a
    // lightning detector (higher is better), and declares unit: "%" for both.
    // Read as a percentage a healthy detector reporting 2 is a false alarm;
    // read as battery_low it is fine and says so.
    const detector = d({
      device_id: 'lightning',
      attributes: { battery: 2, battery_kind: 'level', battery_low: false },
    });
    expect(noticesFor({ watch: ['batteries'] }, [detector])).toEqual([]);

    const wh31 = d({
      device_id: 'ch1',
      attributes: { battery: 1, battery_kind: 'binary', battery_low: true },
    });
    expect(noticesFor({ watch: ['batteries'] }, [wh31])[0]?.detail).toBe('battery low');
  });

  it('falls back to a percentage when the device offers no verdict', () => {
    const got = noticesFor({ watch: ['batteries'] }, [
      d({ device_id: 'zwave', attributes: { battery: 12 } }),
    ]);
    expect(got[0]?.detail).toBe('battery 12%');
  });

  it('puts a flood above a chore', () => {
    const house = [
      d({ device_id: 'battery', name: 'Sensor', attributes: { battery: 5 } }),
      d({ device_id: 'wet', name: 'Basement', attributes: { water_detected: true } }),
      d({ device_id: 'lock', name: 'Door', attributes: { locked: false } }),
    ];
    expect(
      noticesFor({ watch: ['batteries', 'water', 'locks'] }, house).map((n) => n.deviceId),
    ).toEqual(['wet', 'lock', 'battery']);
  });

  it('says one thing per device — the most urgent one', () => {
    // A lock that is unlocked and low on battery is a lock that is unlocked.
    const got = noticesFor({ watch: ['water', 'locks', 'batteries'] }, [
      d({ device_id: 'lock', name: 'Door', attributes: { locked: false, battery: 4 } }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]?.kind).toBe('locks');
  });

  it('notices what the house cannot reach', () => {
    const got = noticesFor({ watch: ['offline'] }, [
      d({ device_id: 'gone', name: 'Bulb', available: false }),
    ]);
    expect(got[0]?.detail).toBe('offline');
  });

  it('lets the device name its own fault rather than deciding what counts', () => {
    const got = noticesFor({ watch: ['faults'] }, [
      d({ device_id: 'x', attributes: { error: 'Lost mesh route' } }),
    ]);
    expect(got[0]?.detail).toBe('Lost mesh route');
  });

  it('scopes to a room, and shows nothing for a room it does not know', () => {
    const house = [
      d({ device_id: 'here', area: 'garage', attributes: { battery: 3 } }),
      d({ device_id: 'elsewhere', area: 'kitchen', attributes: { battery: 3 } }),
    ];
    expect(
      noticesFor({ watch: ['batteries'], area_name: '@room' }, house, 'Garage').map(
        (n) => n.deviceId,
      ),
    ).toEqual(['here']);
    // Unresolved: nothing, rather than the whole house.
    expect(noticesFor({ watch: ['batteries'], area_name: '@room' }, house)).toEqual([]);
  });

  it('honours the limit after ordering', () => {
    const house = [
      d({ device_id: 'battery', attributes: { battery: 5 } }),
      d({ device_id: 'wet', attributes: { water_detected: true } }),
    ];
    const got = noticesFor({ watch: ['batteries', 'water'], limit: 1 }, house);
    expect(got.map((n) => n.deviceId)).toEqual(['wet']);
  });

  it('ignores a watch name it does not know rather than throwing', () => {
    expect(() => noticesFor({ watch: ['sunspots'] }, [d({ device_id: 'a' })])).not.toThrow();
    expect(knownWatches()).toContain('batteries');
  });
});

describe('how loudly one device is asking to be looked at', () => {
  const dev = (attributes: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    ({
      device_id: 'd1',
      name: 'Thing',
      available: true,
      attributes,
      last_seen: '2026-09-12T00:00:00Z',
      ...over,
    }) as never;

  it('calls water and a declared fault critical', () => {
    // **The most important state in a house was drawn in the same grey as the
    // good case.** A water sensor is drawn by the generic row, which had no
    // notion of severity, so "Wet" and "Dry" were the same colour with the
    // same grey droplet beside them.
    expect(severityOf(dev({ water_detected: true }))).toBe('critical');
    expect(severityOf(dev({ fault: true }))).toBe('critical');
    expect(severityOf(dev({ error: 'jammed' }))).toBe('critical');
  });

  it('calls a lock or a door left open a warning, not an alarm', () => {
    expect(severityOf(dev({ locked: false }))).toBe('warn');
    expect(severityOf(dev({ open: true }))).toBe('warn');
  });

  it('says offline for a device the house cannot reach', () => {
    expect(severityOf(dev({}, { available: false }))).toBe('offline');
  });

  it('is quiet about a house that is fine', () => {
    expect(severityOf(dev({ water_detected: false, locked: true, open: false }))).toBeUndefined();
    expect(severityOf(dev({ on: true, brightness_pct: 40 }))).toBeUndefined();
  });

  it('leaves batteries to whoever chose the threshold', () => {
    // A battery needs a number somebody picked, which is a `worth_knowing`
    // configuration rather than a property of the device — and a page of
    // sensors each a shade of amber because one is at 19% is a page where the
    // colour has stopped meaning anything.
    expect(severityOf(dev({ battery_pct: 4 }))).toBeUndefined();
    expect(severityOf(dev({ battery_low: true }))).toBeUndefined();
  });

  it('reports the worst of several at once', () => {
    expect(severityOf(dev({ water_detected: true, open: true }))).toBe('critical');
  });
});
