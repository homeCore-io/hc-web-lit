import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import {
  effectiveArea,
  effectiveName,
  isOn,
  levelOf,
  normalizeAreaName,
  sceneKind,
} from '../src/core/present.js';

function device(over: Partial<DeviceState> = {}): DeviceState {
  return {
    device_id: 'd1',
    name: 'Lamp',
    plugin_id: 'test',
    available: true,
    attributes: {},
    last_seen: '2026-09-07T00:00:00Z',
    ...over,
  };
}

describe('isOn', () => {
  it('reads a plain on attribute', () => {
    expect(isOn(device({ attributes: { on: true } }))).toBe(true);
    expect(isOn(device({ attributes: { on: false } }))).toBe(false);
  });

  it('inverts a lock — unlocked is the state worth noticing', () => {
    expect(isOn(device({ attributes: { locked: false } }))).toBe(true);
    expect(isOn(device({ attributes: { locked: true } }))).toBe(false);
  });

  it('treats occupancy like motion', () => {
    expect(isOn(device({ attributes: { occupancy: true } }))).toBe(true);
    expect(isOn(device({ attributes: { occupied: true } }))).toBe(true);
  });

  it('reads transport state for media and timers', () => {
    expect(isOn(device({ attributes: { state: 'playing' } }))).toBe(true);
    expect(isOn(device({ attributes: { state: 'running' } }))).toBe(true);
    expect(isOn(device({ attributes: { state: 'idle' } }))).toBe(false);
  });

  it('falls back to a non-zero level', () => {
    expect(isOn(device({ attributes: { brightness: 40 } }))).toBe(true);
    expect(isOn(device({ attributes: { brightness: 0 } }))).toBe(false);
  });

  it('has no answer when the device publishes nothing it understands', () => {
    // Not false. A thermometer is not off, and saying so is an invented fact.
    expect(isOn(device({ attributes: { temperature: 21.5 } }))).toBeUndefined();
  });
});

describe('overrides', () => {
  it('prefers the user override over the plugin value', () => {
    const d = device({
      name: 'Hue 3',
      name_override: 'Reading Lamp',
      area: 'den',
      area_override: 'study',
    });
    expect(effectiveName(d)).toBe('Reading Lamp');
    expect(effectiveArea(d)).toBe('study');
  });

  it('falls back to what the plugin delivered', () => {
    const d = device({ area: 'den' });
    expect(effectiveName(d)).toBe('Lamp');
    expect(effectiveArea(d)).toBe('den');
  });
});

describe('normalizeAreaName', () => {
  it('canonicalises the spellings core would have stored', () => {
    for (const spelling of ['Living Room', 'living room', 'LIVING-ROOM', '  living_room  ']) {
      expect(normalizeAreaName(spelling)).toBe('living_room');
    }
  });

  it('is empty for an absent area', () => {
    expect(normalizeAreaName(undefined)).toBe('');
  });
});

/**
 * Shapes taken from a real house, not invented.
 *
 * Every case below reproduces something the live API actually publishes. They
 * are here because the hand-written cases above all passed while `levelOf` was
 * wrong for half the lights in the building — a fixture you made up agrees with
 * the code you made up.
 */
describe('shapes a real deployment publishes', () => {
  it('reads a percentage from a light that only publishes brightness_pct', () => {
    // Eight of sixteen lights in the reference house carry brightness_pct and
    // no raw brightness at all.
    expect(levelOf(device({ attributes: { on: true, brightness_pct: 100 } }))).toBe(100);
    expect(levelOf(device({ attributes: { on: true, brightness_pct: 43.1 } }))).toBeCloseTo(43.1);
  });

  it('converts raw brightness out of 0-255, and prefers the percentage', () => {
    // The same bulb publishes both, in different units. Reading whichever came
    // first would be 2.55x wrong on the fixtures that only have the raw one.
    expect(levelOf(device({ attributes: { brightness: 255 } }))).toBe(100);
    expect(levelOf(device({ attributes: { brightness: 64 } }))).toBeCloseTo(25.1, 1);
    expect(levelOf(device({ attributes: { brightness: 64, brightness_pct: 25 } }))).toBe(25);
  });

  it('reads a fan speed as a percentage', () => {
    expect(
      levelOf(device({ attributes: { on: true, speed: 'medium', speed_pct: 50.6 } })),
    ).toBeCloseTo(50.6);
  });

  it('does not confuse a remembered level with being on', () => {
    // A dimmer that is off still reports the level it will return to.
    const off = device({ attributes: { on: false, brightness: 110, brightness_pct: 43.1 } });
    expect(isOn(off)).toBe(false);
    expect(levelOf(off)).toBeCloseTo(43.1);
  });

  it('reads an applied scene, and knows when a scene cannot say', () => {
    // Lutron marks some scenes on so you can tell when they are off; Hue
    // publishes `active`. Others report nothing at all — activating one of
    // those is a thing you do, with no state afterwards.
    expect(isOn(device({ attributes: { active: true, area: 'office' } }))).toBe(true);
    expect(isOn(device({ attributes: { active: false, area: 'office' } }))).toBe(false);
    expect(isOn(device({ attributes: { on: true } }))).toBe(true);
    expect(isOn(device({ attributes: {} }))).toBeUndefined();
  });

  it('tells a stateful scene from a momentary one', () => {
    expect(sceneKind(device({ attributes: { active: false } }))).toBe('stateful');
    expect(sceneKind(device({ attributes: { on: true } }))).toBe('stateful');
    // 45 of 58 scenes in the reference house are this kind.
    expect(sceneKind(device({ attributes: {} }))).toBe('momentary');
    expect(sceneKind(device({ attributes: { area: 'office', name: 'Relax' } }))).toBe('momentary');
  });

  it('gives no answer for the device types that have no on-ness at all', () => {
    // A temperature sensor is not "on" and it is not off either. About forty
    // devices in the reference house are in this position — sensors, Pico
    // remotes, keypads, bridges — and `undefined` is what lets a card show
    // nothing rather than assert something.
    expect(
      isOn(device({ attributes: { temperature: 21.5, temperature_unit: 'C' } })),
    ).toBeUndefined();
    expect(isOn(device({ attributes: { battery: 100 } }))).toBeUndefined();
  });

  it('reads a lock and a contact sensor the way the plugins publish them', () => {
    expect(isOn(device({ attributes: { locked: false, door_open: false, battery: 50 } }))).toBe(
      true,
    );
    expect(isOn(device({ attributes: { locked: true, battery: 100 } }))).toBe(false);
    expect(isOn(device({ attributes: { open: false, battery: 100 } }))).toBe(false);
  });

  it('reads a timer by its state string', () => {
    expect(isOn(device({ attributes: { state: 'running', remaining_secs: 300 } }))).toBe(true);
    expect(isOn(device({ attributes: { state: 'finished', remaining_secs: 0 } }))).toBe(false);
  });
});

describe('area arrives as null, not absent', () => {
  it('treats a null area as no area', () => {
    // 73 of 184 devices in the reference house send `"area": null`. Core's
    // `area` has no skip_serializing_if while `area_override` does, so the two
    // halves of the same override pair are asymmetric on the wire.
    const d = { ...device(), area: null } as DeviceState;
    expect(effectiveArea(d)).toBeUndefined();
    expect(normalizeAreaName(effectiveArea(d))).toBe('');
  });

  it('lets an override win over a null plugin area', () => {
    const d = { ...device(), area: null, area_override: 'study' } as DeviceState;
    expect(effectiveArea(d)).toBe('study');
  });

  it('normalizes null without throwing', () => {
    expect(normalizeAreaName(null)).toBe('');
  });
});
