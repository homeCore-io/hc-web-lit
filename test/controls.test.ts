import { describe, expect, it } from 'vitest';
import type { DeviceSchema } from '../src/core/api.js';
import { controlsFor, optionsForParam } from '../src/core/controls.js';
import type { DeviceState } from '../src/core/device.js';

function device(attrs: Record<string, unknown>, schema?: DeviceSchema | null): DeviceState {
  return {
    device_id: 'd',
    name: 'D',
    plugin_id: 'p',
    available: true,
    attributes: attrs,
    last_seen: '2026-09-07T00:00:00Z',
    ...(schema !== undefined ? { schema } : {}),
  };
}

/** A Hue bulb's real writable set, as the live API returns it. */
const light: DeviceSchema = {
  attributes: {
    on: {
      kind: 'bool',
      writable: true,
      display_name: 'Power',
      states: { when_true: { label: 'on' }, when_false: { label: 'off' } },
    },
    brightness_pct: {
      kind: 'integer',
      writable: true,
      display_name: 'Brightness',
      min: 0,
      max: 100,
      unit: '%',
    },
    color_temp: {
      kind: 'color_temp',
      writable: true,
      display_name: 'Colour Temperature',
      min: 2000,
      max: 6535,
      step: 100,
      unit: 'K',
    },
    color_xy: { kind: 'color_xy', writable: true, display_name: 'Colour' },
    reachable: { kind: 'bool', writable: false, display_name: 'Reachable' },
  },
};

describe('controlsFor', () => {
  it('builds a light s controls from what the plugin declared', () => {
    const controls = controlsFor(device({ on: true, brightness_pct: 40, color_temp: 2890 }, light));

    expect(controls.map((c) => c.form)).toEqual(['toggle', 'slider', 'colorTemp', 'color']);

    const toggle = controls[0];
    expect(toggle).toMatchObject({ form: 'toggle', key: 'on', label: 'Power', value: true });
    // The device's own words for its states, not "true"/"false".
    expect(toggle).toMatchObject({ onLabel: 'on', offLabel: 'off' });

    const slider = controls.find((c) => c.key === 'brightness_pct');
    expect(slider).toMatchObject({
      form: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      value: 40,
    });

    const temp = controls.find((c) => c.key === 'color_temp');
    expect(temp).toMatchObject({ form: 'colorTemp', min: 2000, max: 6535, unit: 'K', value: 2890 });
  });

  it('offers nothing for an attribute the plugin did not mark writable', () => {
    // A plugin declaring an attribute writable is promising it accepts a write
    // of it. Offering a control for one it did not is offering a control that
    // fails.
    const controls = controlsFor(device({ reachable: true }, light));
    expect(controls.some((c) => c.key === 'reachable')).toBe(false);
  });

  it('leaves diagnostics and settings out of the control row', () => {
    // A lock reports whether it is locked; it also reports battery and
    // firmware. Rendering all three the same way buries the one an operator
    // came for.
    const controls = controlsFor(
      device(
        { locked: true, battery: 50, report_interval: 60 },
        {
          attributes: {
            locked: { kind: 'bool', writable: true },
            battery: { kind: 'integer', writable: true, category: 'diagnostic' },
            report_interval: { kind: 'integer', writable: true, category: 'config' },
          },
        },
      ),
    );
    expect(controls.map((c) => c.key)).toEqual(['locked']);
  });

  it('puts power first and is otherwise stable', () => {
    // A control that moves between renders is a control somebody mis-taps.
    const s: DeviceSchema = {
      attributes: {
        zebra: { kind: 'integer', writable: true },
        alpha: { kind: 'integer', writable: true },
        on: { kind: 'bool', writable: true },
        muted: { kind: 'bool', writable: true },
      },
    };
    expect(controlsFor(device({}, s)).map((c) => c.key)).toEqual(['on', 'muted', 'alpha', 'zebra']);
  });

  it('renders no control for an opaque json attribute', () => {
    // Core's own word for `json` is "opaque, no dedicated control". A textarea
    // here invites hand-editing something the plugin never promised to parse.
    const controls = controlsFor(
      device({ raw: {} }, { attributes: { raw: { kind: 'json', writable: true } } }),
    );
    expect(controls).toEqual([]);
  });

  it('offers actions after attributes', () => {
    const controls = controlsFor(
      device(
        { on: false },
        {
          attributes: { on: { kind: 'bool', writable: true } },
          actions: [{ id: 'press_button', label: 'Press a button' }],
        },
      ),
    );
    expect(controls.map((c) => c.form)).toEqual(['toggle', 'action']);
  });

  it('offers nothing at all for a device with no schema', () => {
    // 77 of 184 devices in the reference house. Ordinary, not an error.
    expect(controlsFor(device({ on: true }, null))).toEqual([]);
    expect(controlsFor(device({ on: true }))).toEqual([]);
  });

  it('never lets a step be zero, which would freeze the control', () => {
    const c = controlsFor(
      device({ v: 1 }, { attributes: { v: { kind: 'integer', writable: true, step: 0 } } }),
    );
    expect(c[0]).toMatchObject({ step: 1 });
  });
});

describe('optionsForParam — options_from', () => {
  const param = {
    options_from: {
      attribute: { attribute: 'available_buttons', label_key: 'name', value_key: 'number' },
    },
  };

  it('reads the Lutron shape, keeping the engraving off the wall', () => {
    const d = device({
      available_buttons: [
        { name: 'OH Door 1', number: 1 },
        { name: 'Lights', number: 3 },
      ],
    });
    expect(optionsForParam(d, param)).toEqual([
      { label: 'OH Door 1', value: '1' },
      { label: 'Lights', value: '3' },
    ]);
  });

  it('reads the Caseta shape, which is a bare list of numbers', () => {
    // Same field, same param, two plugins. Nothing here knows what either is.
    const d = device({ available_buttons: [2, 3, 4] });
    expect(optionsForParam(d, param)).toEqual([
      { label: 'Button 2', value: '2' },
      { label: 'Button 3', value: '3' },
      { label: 'Button 4', value: '4' },
    ]);
  });

  it('prefers a fixed option list when the param carries one', () => {
    const fixed = { options: [{ label: 'Off', value: '0' }], ...param };
    expect(optionsForParam(device({}), fixed)).toEqual([{ label: 'Off', value: '0' }]);
  });

  it('is empty when the attribute is missing rather than throwing', () => {
    expect(optionsForParam(device({}), param)).toEqual([]);
  });
});
