import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { check, checkAction } from '../src/core/safety.js';

const device = (over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: 'd',
  name: 'Front Door',
  plugin_id: 'yolink',
  available: true,
  attributes: {},
  last_seen: '2026-09-07T00:00:00Z',
  ...over,
});

describe('the safety policy', () => {
  it('lets an ordinary device through without ceremony', () => {
    expect(check(device({ device_type: 'light', name: 'Lamp' }), { on: true })).toEqual({
      allow: true,
    });
  });

  it('asks before unlocking', () => {
    const v = check(device({ device_type: 'lock' }), { locked: false });
    expect(v).toEqual({ confirm: 'Unlock Front Door?' });
  });

  it('asks before locking too, but says so differently', () => {
    expect(check(device({ device_type: 'lock' }), { locked: true })).toEqual({
      confirm: 'Lock Front Door?',
    });
  });

  it('guards by attribute even when the device type says nothing', () => {
    // A device whose plugin never set device_type still has a `locked`
    // attribute, and writing it is the guarded act either way.
    expect(check(device({}), { locked: false })).toMatchObject({ confirm: expect.any(String) });
  });

  it('honours ui_hint over device_type', () => {
    // A switch wired to a garage door is a garage door. That is what the field
    // is for (§1.1), and the policy has to read it or the override is cosmetic.
    const garage = device({ device_type: 'switch', ui_hint: 'garage', name: 'Garage' });
    expect(check(garage, { on: true })).toMatchObject({ confirm: expect.any(String) });
  });

  it('uses the name a person chose', () => {
    const d = device({ device_type: 'lock', name: 'YoLink D88B', name_override: 'Back Door' });
    expect(check(d, { locked: false })).toEqual({ confirm: 'Unlock Back Door?' });
  });

  it('guards actions on a guarded device', () => {
    expect(checkAction(device({ device_type: 'lock' }), 'unlock_now')).toEqual({
      confirm: 'Unlock now on Front Door?',
    });
    expect(checkAction(device({ device_type: 'light' }), 'flash')).toEqual({ allow: true });
  });
});
