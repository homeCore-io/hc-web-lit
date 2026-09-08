import { describe, expect, it } from 'vitest';
import type { DeviceSchema } from '../src/core/api.js';
import type { DeviceState } from '../src/core/device.js';
import { formatReading, hasPowerState, readingOf, roleOf } from '../src/core/facet.js';

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
    // "Open" is what a contact sensor means. "On" is not.
    expect(formatReading({ key: 'open', value: true, label: 'open' })).toBe('Open');
    expect(formatReading({ key: 'open', value: false, label: 'open' })).toBe('No open');
  });

  it('has nothing to report when everything is housekeeping', () => {
    expect(readingOf(device({ attributes: { battery: 50, rssi: -60 } }))).toBeUndefined();
  });
});
