import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { knownFacets, labelInRoom, resolveToken, selectDevices } from '../src/core/selection.js';

const d = (over: Partial<DeviceState> & { device_id: string }): DeviceState => ({
  name: over.device_id,
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-07T00:00:00Z',
  ...over,
});

const house: DeviceState[] = [
  d({ device_id: 'lamp', name: 'Garage Lamp', device_type: 'light', area: 'garage' }),
  d({ device_id: 'ceiling', name: 'Ceiling', device_type: 'light', area: 'garage' }),
  d({ device_id: 'sw', name: 'Bench', device_type: 'switch', area: 'garage' }),
  d({
    device_id: 'hinted',
    name: 'Strip',
    device_type: 'switch',
    ui_hint: 'light',
    area: 'garage',
  }),
  d({ device_id: 'door', name: 'Side Door', device_type: 'contact_sensor', area: 'garage' }),
  d({ device_id: 'kitchen', name: 'Kitchen', device_type: 'light', area: 'kitchen' }),
  d({ device_id: 'scene1', name: 'Evening', device_type: 'scene', area: 'garage' }),
  d({ device_id: 'timer', name: 'Deck timer', device_type: 'timer', area: 'garage' }),
  d({ device_id: 'gone', name: 'Offline', device_type: 'light', area: 'garage', available: false }),
];

describe('selection modes', () => {
  it('manual keeps the order somebody chose', () => {
    const got = selectDevices({ selection_mode: 'manual', device_ids: ['sw', 'lamp'] }, house);
    expect(got.map((x) => x.device_id)).toEqual(['sw', 'lamp']);
  });

  it('manual shows a scene if it was asked for by hand', () => {
    // Scenes are excluded from device lists, but naming one is asking for it.
    const got = selectDevices({ selection_mode: 'manual', device_ids: ['scene1'] }, house);
    expect(got.map((x) => x.device_id)).toEqual(['scene1']);
  });

  it('area takes everything in a room, glue included', () => {
    // A timer assigned to the garage was put there on purpose; hiding it is
    // the bug users report.
    const got = selectDevices({ selection_mode: 'area', area_name: 'garage' }, house);
    expect(got.map((x) => x.device_id)).toContain('timer');
    expect(got.map((x) => x.device_id)).not.toContain('kitchen');
    // But a scene is still not a device.
    expect(got.map((x) => x.device_id)).not.toContain('scene1');
  });

  it('resolves @room at the placement seam, not in the widget', () => {
    const got = selectDevices({ selection_mode: 'area', area_name: '@room' }, house, {
      room: 'kitchen',
    });
    expect(got.map((x) => x.device_id)).toEqual(['kitchen']);
    expect(resolveToken('@room', { room: 'kitchen' })).toBe('kitchen');
    expect(resolveToken('bathroom_2', {})).toBe('bathroom_2');
  });

  it('counts a hinted switch as a light, because that is what ui_hint is for', () => {
    const got = selectDevices(
      { selection_mode: 'facet', facet: ['lights'], area_name: 'garage' },
      house,
    );
    expect(got.map((x) => x.device_id).sort()).toEqual(['ceiling', 'gone', 'hinted', 'lamp']);
    // And it is no longer a switch.
    const switches = selectDevices(
      { selection_mode: 'facet', facet: ['switches'], area_name: 'garage' },
      house,
    );
    expect(switches.map((x) => x.device_id)).toEqual(['sw']);
  });

  it('subtracts facets with except', () => {
    // The real "everything else" card: a room, minus the things that have
    // their own sections.
    const got = selectDevices(
      {
        selection_mode: 'area',
        area_name: 'garage',
        except: ['lights', 'switches'],
        sort: 'name',
      },
      house,
    );
    expect(got.map((x) => x.device_id).sort()).toEqual(['door', 'timer']);
  });

  it('selects nothing for a query rather than falling back to everything', () => {
    // P2 is not built. A widget showing the whole house because its query was
    // ignored is worse than one showing nothing.
    expect(selectDevices({ selection_mode: 'query', query: 'area:garage' }, house)).toEqual([]);
  });
});

describe('shaping the result', () => {
  it('drops offline devices only when asked', () => {
    const shown = selectDevices({ selection_mode: 'area', area_name: 'garage' }, house);
    expect(shown.map((x) => x.device_id)).toContain('gone');
    const hidden = selectDevices(
      { selection_mode: 'area', area_name: 'garage', show_offline: false },
      house,
    );
    expect(hidden.map((x) => x.device_id)).not.toContain('gone');
  });

  it('lets a person pin one in and take one out of a live selection', () => {
    // add/remove ride on top of the mode, so the selection stays live.
    const got = selectDevices(
      { selection_mode: 'area', area_name: 'garage', remove: ['timer'], add: ['kitchen'] },
      house,
    );
    const ids = got.map((x) => x.device_id);
    expect(ids).not.toContain('timer');
    expect(ids).toContain('kitchen');
  });

  it('sorts by the label it actually draws, not the raw name', () => {
    // On the garage page everything is called "Garage something". Sorting the
    // raw name buckets them all under G and reads as no sort at all.
    const got = selectDevices(
      { selection_mode: 'facet', facet: ['lights'], area_name: 'garage', sort: 'name' },
      house,
    );
    // "Lamp" (Garage Lamp, stripped) before "Ceiling"? No — Ceiling first.
    expect(got.map((x) => x.name)).toEqual(['Ceiling', 'Garage Lamp', 'Offline', 'Strip']);
  });

  it('an explicit order beats a sort', () => {
    const got = selectDevices(
      { selection_mode: 'area', area_name: 'garage', sort: 'name', order: ['sw', 'lamp'] },
      house,
    );
    expect(got.slice(0, 2).map((x) => x.device_id)).toEqual(['sw', 'lamp']);
  });

  it('limits after ordering, not before', () => {
    const got = selectDevices(
      { selection_mode: 'area', area_name: 'garage', sort: 'name', limit: 2 },
      house,
    );
    expect(got).toHaveLength(2);
    expect(got[0]?.name).toBe('Bench');
  });
});

describe('labelInRoom', () => {
  it('strips the room from a name that repeats it', () => {
    expect(labelInRoom(d({ device_id: 'x', name: 'Garage Lamp' }), 'garage')).toBe('Lamp');
    expect(labelInRoom(d({ device_id: 'x', name: 'Ceiling' }), 'garage')).toBe('Ceiling');
  });

  it('handles a multi-word room', () => {
    expect(labelInRoom(d({ device_id: 'x', name: 'Living Room Lamp' }), 'living_room')).toBe(
      'Lamp',
    );
  });

  it('leaves the name alone outside a room', () => {
    expect(labelInRoom(d({ device_id: 'x', name: 'Garage Lamp' }), '')).toBe('Garage Lamp');
  });
});

describe('facet names', () => {
  it('covers the names the real dashboards actually use', () => {
    // Core validates that `facet` is a string and says nothing about which
    // strings — so these names are a client convention, and a document
    // referencing one this client does not know selects nothing.
    for (const used of ['lights', 'switches', 'outlets', 'fans', 'power', 'media', 'doors_windows'])
      expect(knownFacets()).toContain(used);
  });
});

describe('the facets a room page sorts its sensors by', () => {
  // The household's garage: three door sensors, a leak sensor, a mouse-trap
  // vibration sensor, an occupancy sensor, two thermometers, two timers, a
  // Pico and a VCRX — twenty-two devices in one undifferentiated list, which
  // is a list you read rather than scan.
  const garage: DeviceState[] = [
    d({ device_id: 'oh1', name: 'OH1 Door', device_type: 'contact_sensor', area: 'garage' }),
    d({ device_id: 'wet', name: 'Leak Sensor', device_type: 'water_sensor', area: 'garage' }),
    d({ device_id: 'rain', name: 'Rain', device_type: 'rain_sensor', area: 'garage' }),
    d({ device_id: 'occ', name: 'Occupancy', device_type: 'occupancy_sensor', area: 'garage' }),
    d({ device_id: 'pir', name: 'Motion', device_type: 'motion_sensor', area: 'garage' }),
    d({ device_id: 'close', name: 'Auto-close', device_type: 'timer', area: 'garage' }),
    d({ device_id: 'pico', name: 'Overhead', device_type: 'pico_remote', area: 'garage' }),
    d({ device_id: 'vcrx', name: 'Garage VCRX', device_type: 'vcrx', area: 'garage' }),
    d({ device_id: 'mouse', name: 'Mouse Trap', device_type: 'vibration_sensor', area: 'garage' }),
    d({ device_id: 'freeze', name: 'Freezer', device_type: 'temperature_sensor', area: 'garage' }),
  ];

  const chosen = (facet: string): string[] =>
    selectDevices(
      { selection_mode: 'facet', facet: [facet], area_name: 'garage', sort: 'name' },
      garage,
    ).map((x) => x.device_id);

  it('separates water from the rest of the weather', () => {
    expect(chosen('leaks').sort()).toEqual(['rain', 'wet']);
  });

  it('counts occupancy as motion, because a person asking means both', () => {
    expect(chosen('motion').sort()).toEqual(['occ', 'pir']);
  });

  it('gathers the timers', () => {
    expect(chosen('timers')).toEqual(['close']);
  });

  it('gathers the things with buttons on them', () => {
    // A wall keypad, a Pico, a VCRX. They stay on the page — a room that shows
    // none of what presses it is a room you cannot debug — but at the foot of
    // it rather than through the middle of a sensor list.
    expect(chosen('keypads').sort()).toEqual(['pico', 'vcrx']);
  });

  it('leaves the catch-all catching what nothing else claimed', () => {
    // The remainder is the point of it: a mouse-trap vibration sensor belongs
    // to no section anybody would name, and inventing one for it would be
    // inventing a vocabulary rather than reading the house's.
    const rest = selectDevices(
      {
        selection_mode: 'area',
        area_name: 'garage',
        except: ['doors_windows', 'locks', 'motion', 'leaks', 'climate', 'timers', 'keypads'],
      },
      garage,
    ).map((x) => x.device_id);
    expect(rest).toEqual(['mouse']);
  });

  it('is a name the house knows, so a document can reference it', () => {
    for (const name of ['leaks', 'motion', 'timers', 'keypads']) {
      expect(knownFacets(), name).toContain(name);
    }
  });
});
