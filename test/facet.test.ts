import { describe, expect, it } from 'vitest';
import type { DeviceSchema } from '../src/core/api.js';
import type { DeviceState } from '../src/core/device.js';
import {
  formatReading,
  hasPowerState,
  isHousekeeping,
  readingOf,
  roleOf,
} from '../src/core/facet.js';

const device = (over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: 'd',
  name: 'D',
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-07T00:00:00Z',
  ...over,
});

const schema = (s: DeviceSchema): DeviceSchema => s;

describe('roleOf — derived, never listed', () => {
  it('reads a writable attribute as a device you command', () => {
    const light = device({
      device_type: 'light',
      schema: schema({ attributes: { on: { kind: 'bool', writable: true } } }),
    });
    expect(roleOf(light)).toBe('commandable');
    expect(hasPowerState(light)).toBe(true);
  });

  it('reads a declared action as a device you command', () => {
    // A keypad has zero writable attributes and two actions. The schema is what
    // says it can be pressed remotely.
    const keypad = device({
      device_type: 'keypad',
      schema: schema({
        attributes: { available_buttons: { kind: 'json' } },
        actions: [{ id: 'press_button', label: 'Press a button' }],
      }),
    });
    expect(roleOf(keypad)).toBe('commandable');
  });

  it('reads a schema with neither as a device you only read', () => {
    const thermometer = device({
      device_type: 'temperature_sensor',
      attributes: { temperature: 21.5, temperature_unit: 'C' },
      schema: schema({ attributes: { temperature: { kind: 'float' } } }),
    });
    expect(roleOf(thermometer)).toBe('readable');
    // The whole point: a thermometer has no power state, so nothing asks.
    expect(hasPowerState(thermometer)).toBe(false);
  });

  it('separates a pico from a keypad the way the plugins already do', () => {
    // The case a device_type table gets wrong. Same shape of hardware; a Pico
    // transmits and cannot be pressed remotely, a keypad can — and the schemas
    // say so without anything here knowing what either is.
    const pico = device({
      device_type: 'pico_remote',
      schema: schema({ attributes: { button_2: { kind: 'string' } } }),
    });
    const keypad = device({
      device_type: 'keypad',
      schema: schema({ actions: [{ id: 'press_button', label: 'Press' }] }),
    });
    expect(roleOf(pico)).toBe('readable');
    expect(roleOf(keypad)).toBe('commandable');
  });

  it('says unknown when the plugin declared nothing, rather than guessing', () => {
    // 77 of 184 devices in the reference house — every scene, fan and
    // occupancy sensor among them. A guess here would hide homeCore#28.
    const fan = device({ device_type: 'fan', attributes: { on: true, speed_pct: 50 } });
    expect(roleOf(fan)).toBe('unknown');
    expect(hasPowerState(fan)).toBe(false);
  });
});

describe('readingOf', () => {
  it('finds the reading a sensor came to report', () => {
    const r = readingOf(
      device({
        attributes: { temperature: 21.53, temperature_unit: 'C', battery: 100 },
        schema: schema({
          attributes: { temperature: { kind: 'float', display_name: 'Temperature' } },
        }),
      }),
    );
    expect(r).toMatchObject({ key: 'temperature', unit: 'C', label: 'Temperature' });
    expect(formatReading(r!)).toBe('21.5 C');
  });

  it('steps over battery even though no plugin declares it diagnostic', () => {
    // category exists for this and is set on zero devices in the house, so the
    // stopgap list is what stops a lock leading with its battery.
    const r = readingOf(device({ attributes: { battery: 100, water_detected: false } }));
    expect(r?.key).toBe('water_detected');
  });

  it('prefers a declaration over the stopgap when one exists', () => {
    const r = readingOf(
      device({
        attributes: { pressure: 1013, mystery: 7 },
        schema: schema({
          attributes: { pressure: { kind: 'float', category: 'diagnostic' } },
        }),
      }),
    );
    expect(r?.key).toBe('mystery');
  });

  it('reads a boolean as a condition, not a power state', () => {
    // "Open" is what a contact sensor means. "On" is not — and the negative
    // side is "Closed", which is the word the device already has.
    expect(formatReading({ key: 'open', value: true, label: 'open' })).toBe('Open');
    expect(formatReading({ key: 'open', value: false, label: 'open' })).toBe('Closed');
  });

  it('has nothing to report when everything is housekeeping', () => {
    // battery is still in the fallback list, for the plugins that have not
    // restarted since the upgrade. rssi is not: core's lexicon covers it and
    // plugins declare it, so the declaration is what demotes it now.
    expect(
      readingOf(
        device({
          attributes: { battery: 50, rssi: -60 },
          schema: { attributes: { rssi: { kind: 'integer', category: 'diagnostic' } } },
        }),
      ),
    ).toBeUndefined();
  });

  it('leads with what the schema says the device is for', () => {
    // `primary` is ordered, most important first, and it replaces the
    // device_type stem heuristic. Core sorts what neither its type table nor
    // its significance rank names, which is what makes it stable at all —
    // `attributes` is a HashMap in Rust.
    const r = readingOf(
      device({
        device_type: 'zwave',
        attributes: { humidity: 41, temperature: 68.2, battery: 90 },
        schema: {
          primary: ['temperature', 'humidity'],
          attributes: { battery: { kind: 'integer', category: 'diagnostic' } },
        },
      }),
    );
    expect(r?.key).toBe('temperature');
  });

  it('skips a primary entry the device is not currently reporting', () => {
    const r = readingOf(
      device({
        attributes: { humidity: 41 },
        schema: { primary: ['temperature', 'humidity'] },
      }),
    );
    expect(r?.key).toBe('humidity');
  });

  it('still falls back to the old heuristic when primary is absent', () => {
    // An older core, or a schema that predates the field.
    const r = readingOf(
      device({
        device_type: 'temperature_sensor',
        attributes: { humidity: 53.3, temperature: 72.9 },
      }),
    );
    expect(r?.key).toBe('temperature');
  });
});

describe('the reading a device came to report', () => {
  it('prefers the attribute the device type points at', () => {
    // A thermometer that also reports humidity was showing 53.3% where its
    // temperature belonged, because the first attribute in map order won.
    // device_type is the plugin's own word, so reading it is not a client table.
    const r = readingOf(
      device({
        device_type: 'temperature_sensor',
        attributes: { humidity: 53.3, temperature: 72.9, temperature_unit: 'F' },
      }),
    );
    expect(r?.key).toBe('temperature');
    expect(formatReading(r!)).toBe('72.9 F');
  });

  it('still finds something when the type points at nothing present', () => {
    const r = readingOf(
      device({ device_type: 'water_sensor', attributes: { battery: 90, wet: true } }),
    );
    expect(r?.key).toBe('wet');
  });
});

describe('words for booleans', () => {
  it('uses the device s own words when it declared them', () => {
    const r = readingOf(
      device({
        attributes: { on: true },
        schema: {
          attributes: { on: { kind: 'bool', states: { when_true: { label: 'active' } } } },
        },
      }),
    );
    expect(formatReading(r!)).toBe('Active');
  });

  it('knows the booleans every house has', () => {
    // "No on" is what a fan read before this. A negated attribute name is a
    // bad reading, not a wrong one.
    expect(formatReading({ key: 'on', value: false, label: 'on' })).toBe('Off');
    expect(formatReading({ key: 'open', value: false, label: 'open' })).toBe('Closed');
    expect(formatReading({ key: 'occupancy', value: true, label: 'occupancy' })).toBe('Occupied');
    expect(formatReading({ key: 'locked', value: false, label: 'locked' })).toBe('Unlocked');
    expect(formatReading({ key: 'water_detected', value: false, label: 'water detected' })).toBe(
      'Dry',
    );
  });

  it('falls back visibly rather than inventing a word', () => {
    expect(formatReading({ key: 'flux_capacitor', value: true, label: 'flux capacitor' })).toBe(
      'Flux capacitor',
    );
    expect(formatReading({ key: 'flux_capacitor', value: false, label: 'flux capacitor' })).toBe(
      'Not flux capacitor',
    );
  });
});

describe('capability flags are not readings', () => {
  it('demotes what the integration can do, not what the house is doing', () => {
    // homeCore#34: 69 booleans in the reference house are capability
    // advertisements with no category, and they render as "Not supports
    // gradient" — the synthesised negation `states` exists to stop.
    expect(isHousekeeping('supports_gradient')).toBe(true);
    expect(isHousekeeping('is_tv_input')).toBe(true);
    expect(isHousekeeping('supports_dimming')).toBe(true);
  });

  it('does not catch a reading that happens to start the same way', () => {
    expect(isHousekeeping('isolation')).toBe(false);
    expect(isHousekeeping('supported')).toBe(false);
  });
});
