import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { scenesInScope } from '../src/core/scenes.js';

const scene = (id: string, over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: id,
  name: id,
  plugin_id: 'lutron',
  device_type: 'scene',
  available: true,
  attributes: {},
  last_seen: '2026-09-07T00:00:00Z',
  ...over,
});

const pool: DeviceState[] = [
  scene('house_a'),
  scene('house_b'),
  scene('garage_1', { area: 'garage' }),
  scene('garage_2', { area: 'Garage' }),
  // A Hue scene: bound to a light group, not to a room's own scene list.
  scene('hue_office', {
    plugin_id: 'hue',
    area: 'office',
    attributes: { active: false, group_kind: 'room', group_rid: 'abc' },
  }),
  scene('office_1', { area: 'office' }),
  { ...scene('lamp'), device_type: 'light' },
];

describe('scenesInScope', () => {
  it('house scope is the scenes that belong to no room', () => {
    // Not every scene in the house — the ones that are about the whole house.
    const got = scenesInScope({ scope: 'house' }, pool);
    expect(got.map((s) => s.device_id)).toEqual(['house_a', 'house_b']);
  });

  it('room scope matches an area however either side spelled it', () => {
    const got = scenesInScope({ scope: 'room', room: '@room' }, pool, 'Garage');
    expect(got.map((s) => s.device_id)).toEqual(['garage_1', 'garage_2']);
  });

  it('room scope with no room selects nothing rather than everything', () => {
    expect(scenesInScope({ scope: 'room', room: '@room' }, pool)).toEqual([]);
  });

  it('skip_light_scenes drops the ones bound to a light group', () => {
    // Hue publishes group_kind/group_rid because a Hue scene IS a state of one
    // light group. A room's scene row wants the scenes somebody made for the
    // room, not forty colour presets belonging to its bulbs.
    const withLight = scenesInScope({ scope: 'room', room: 'office' }, pool);
    expect(withLight.map((s) => s.device_id)).toEqual(['hue_office', 'office_1']);

    const without = scenesInScope({ scope: 'room', room: 'office', skip_light_scenes: true }, pool);
    expect(without.map((s) => s.device_id)).toEqual(['office_1']);
  });

  it('an explicit list wins over the scope, and keeps its order', () => {
    const got = scenesInScope({ scope: 'house', scene_ids: ['garage_2', 'house_a'] }, pool);
    expect(got.map((s) => s.device_id)).toEqual(['garage_2', 'house_a']);
  });

  it('never returns something that is not a scene', () => {
    const got = scenesInScope({ scope: 'all' }, pool);
    expect(got.map((s) => s.device_id)).not.toContain('lamp');
  });

  it('drops an id that no longer exists rather than rendering a hole', () => {
    const got = scenesInScope({ scene_ids: ['house_a', 'deleted'] }, pool);
    expect(got.map((s) => s.device_id)).toEqual(['house_a']);
  });
});
