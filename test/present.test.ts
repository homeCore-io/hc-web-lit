import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { effectiveArea, effectiveName, isOn, normalizeAreaName } from '../src/core/present.js';

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

  it('is false when the device publishes nothing it understands', () => {
    expect(isOn(device({ attributes: { temperature: 21.5 } }))).toBe(false);
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
