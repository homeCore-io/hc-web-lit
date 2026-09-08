import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { isVisible } from '../src/core/visibility.js';

const light = (over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: 'lamp',
  name: 'Lamp',
  plugin_id: 'hue',
  available: true,
  attributes: { on: true },
  last_seen: '2026-09-08T00:00:00Z',
  ...over,
});

describe('isVisible', () => {
  it('draws anything that says nothing about visibility', () => {
    expect(isVisible({}, [light()])).toBe(true);
  });

  it('hides a control aimed at nothing', () => {
    // The SETS controls exist to aim at a light you touched. Before you touch
    // one there is nothing to aim at, and the mockup's own hint says so:
    // "Tap a light above to aim these at it".
    expect(isVisible({ hide_with: '@picked' }, [light()], {})).toBe(false);
    expect(isVisible({ hide_with: '@picked' }, [light()], { picked: 'lamp' })).toBe(true);
  });

  it('hides a control the picked light cannot use', () => {
    // "warmth — the same light, tunable white only". A bulb with no colour
    // temperature has nothing for the strip to do.
    const plain = light({ device_id: 'plain', schema: { attributes: { on: { kind: 'bool' } } } });
    const colour = light({
      device_id: 'colour',
      schema: { attributes: { on: { kind: 'bool' }, color_temp: { kind: 'color_temp' } } },
    });
    const cfg = { hide_with: '@picked', hide_unless: ['color_temp'] };

    expect(isVisible(cfg, [plain, colour], { picked: 'plain' })).toBe(false);
    expect(isVisible(cfg, [plain, colour], { picked: 'colour' })).toBe(true);
  });

  it('believes the schema over what the bulb has published so far', () => {
    // A lamp that can take a colour temperature but has not reported one yet
    // still has the control — the declaration is the capability.
    const declared = light({ schema: { attributes: { color_temp: { kind: 'color_temp' } } } });
    expect(
      isVisible({ hide_with: '@picked', hide_unless: ['color_temp'] }, [declared], {
        picked: 'lamp',
      }),
    ).toBe(true);
  });

  it('falls back to a reported attribute for a device with no schema', () => {
    const reporting = light({ attributes: { on: true, color_temp: 2700 } });
    expect(
      isVisible({ hide_with: '@picked', hide_unless: ['color_temp'] }, [reporting], {
        picked: 'lamp',
      }),
    ).toBe(true);
  });

  it('hides when the picked device is gone', () => {
    expect(isVisible({ hide_with: '@picked' }, [], { picked: 'deleted' })).toBe(false);
  });
});
