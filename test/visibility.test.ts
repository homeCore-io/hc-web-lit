import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { isVisible, selectsDevices } from '../src/core/visibility.js';

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

describe('an element with nothing to show', () => {
  const garage: DeviceState[] = [
    {
      ...light({ device_id: 'door', name: 'Side Door' }),
      device_type: 'contact_sensor',
      area: 'garage',
    },
  ];
  const set = (facet: string) => ({
    selection_mode: 'facet',
    facet: [facet],
    area_name: '@room',
    hide_when_empty: true,
  });

  it('is on the page when its selection found something', () => {
    expect(isVisible(set('doors_windows'), garage, { room: 'garage' }, 'device_list')).toBe(true);
  });

  it('is not, when it found nothing', () => {
    // A room with no leak sensor wants no LEAKS section, and the widget
    // drawing an empty box is only half of that — the heading, the rule and
    // the space they were drawn in all stayed.
    expect(isVisible(set('leaks'), garage, { room: 'garage' }, 'device_list')).toBe(false);
  });

  it('stays on the page without the flag, however empty it is', () => {
    // An empty set is usually a selection that matched nothing rather than a
    // house with nothing in it, and saying so is the default for a reason.
    const { hide_when_empty: _drop, ...loud } = set('leaks');
    expect(isVisible(loud, garage, { room: 'garage' }, 'device_list')).toBe(true);
  });

  it('asks the scene vocabulary for a scene row, which is a different one', () => {
    // `scope` decides a scene row's pool, not `selection_mode` (§5.3), so one
    // question with two answers rather than a selection test that would find
    // nothing and hide a row that has scenes.
    const scenes: DeviceState[] = [
      {
        ...light({ device_id: 'evening', name: 'Evening' }),
        device_type: 'scene',
        area: 'garage',
        schema: { actions: [{ id: 'activate', label: 'Activate' }] },
      },
    ];
    const row = { scope: 'room', room: '@room', hide_when_empty: true };
    expect(isVisible(row, scenes, { room: 'garage' }, 'scene_row')).toBe(true);
    expect(isVisible(row, scenes, { room: 'attic' }, 'scene_row')).toBe(false);
  });

  it('never hides something that selects nothing in the first place', () => {
    // A heading has no devices to be empty of, and answering "no" for one
    // would delete it from the page.
    expect(isVisible({ hide_when_empty: true }, [], {}, 'text')).toBe(true);
  });
});

describe('what counts as choosing devices', () => {
  it('is a selection or a scene row, and not a label', () => {
    expect(selectsDevices('device_list', { selection_mode: 'facet' })).toBe(true);
    expect(selectsDevices('device_grid', { query: 'lights' })).toBe(true);
    expect(selectsDevices('scene_row', { scope: 'room' })).toBe(true);
    expect(selectsDevices('text', { text: 'LEAKS' })).toBe(false);
    expect(selectsDevices('line', {})).toBe(false);
  });
});
