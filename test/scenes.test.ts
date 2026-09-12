import { describe, expect, it } from 'vitest';
import { orbFor, paletteFor } from '../src/design/scene-palette.js';
import type { DeviceState } from '../src/core/device.js';
import { scenesInScope, isLightScene } from '../src/core/scenes.js';

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

describe('the scenes that drive one device', () => {
  const scene = (over: Partial<DeviceState> & { device_id: string }): DeviceState => ({
    name: over.device_id,
    plugin_id: 'plugin.hue',
    available: true,
    attributes: {},
    last_seen: '2026-09-11T00:00:00Z',
    schema: { actions: [{ id: 'activate', label: 'Activate' }] },
    ...over,
  });

  const lamp = scene({
    device_id: 'lamp',
    name: 'Office Desk Lamp',
    area: 'office',
    device_type: 'light',
    attributes: { on: true },
    schema: {},
  });
  const officeScene = scene({
    device_id: 's1',
    name: 'Concentrate',
    area: 'office',
    attributes: { group_rid: 'g-office', group_kind: 'room' },
  });
  const elsewhere = scene({
    device_id: 's2',
    name: 'Relax',
    area: 'living_room',
    attributes: { group_rid: 'g-living', group_kind: 'room' },
  });
  const lutron = scene({
    device_id: 's3',
    name: 'Movie',
    area: 'office',
    plugin_id: 'plugin.lutron',
    attributes: { on: true },
  });

  const house = [lamp, officeScene, elsewhere, lutron];

  it('finds the light scenes of the room the device is in', () => {
    // **A scene is bound to a light group, not to a bulb.** This asked for
    // `parent_device_id` and nothing else, and not one of the 58 scenes in the
    // reference house carries one — so the row rendered "No scenes here."
    // beside ten scenes that drive the very lamp that was selected.
    const got = scenesInScope({ scope: 'device', device_id: 'lamp' }, house);
    expect(got.map((d) => d.name)).toEqual(['Concentrate']);
  });

  it('leaves out a room scene that is not a light scene', () => {
    // A Lutron room scene is the room's, not this lamp's — which is the same
    // line `skip_light_scenes` draws from the other side.
    const got = scenesInScope({ scope: 'device', device_id: 'lamp' }, house);
    expect(got.map((d) => d.name)).not.toContain('Movie');
  });

  it('leaves out a scene from another integration in the same room', () => {
    // **A room holds whatever the household put in it.** This office has Hue
    // bulbs, a Lutron dimmer and a Z-Wave plug, and matching on the area alone
    // offered all twelve of the room's *Hue* scenes as the scenes for the
    // Lutron overhead — twelve buttons that would each have driven some other
    // light. A scene is a command to the bridge that owns it.
    const overhead = scene({
      device_id: 'overhead',
      device_type: 'light',
      plugin_id: 'plugin.lutron',
      attributes: { on: true, brightness_pct: 25 },
      schema: {},
    });
    const got = scenesInScope({ scope: 'device', device_id: 'overhead' }, [...house, overhead]);
    expect(got.map((d) => d.name)).toEqual([]);
  });

  it('keeps a scene whose integration nobody declared', () => {
    // A plugin that stays quiet is not evidence of a mismatch, and excluding
    // on missing data would empty the row for every integration that does.
    const quiet = scene({
      device_id: 's9',
      name: 'Unsigned',
      area: 'office',
      attributes: { group_rid: 'g-office', group_kind: 'room' },
    });
    const got = scenesInScope({ scope: 'device', device_id: 'lamp' }, [...house, quiet]);
    expect(got.map((d) => d.name)).toContain('Unsigned');
  });

  it('believes a plugin that does declare a parent', () => {
    // A plugin that says so means it exactly and should not be second-guessed.
    const owned = scene({
      device_id: 's4',
      name: 'Only mine',
      parent_device_id: 'lamp',
      attributes: {},
    });
    const got = scenesInScope({ scope: 'device', device_id: 'lamp' }, [...house, owned]);
    expect(got.map((d) => d.name)).toEqual(['Only mine']);
  });

  it('is nothing for a device with no area to match on', () => {
    const loose = scene({ device_id: 'loose', device_type: 'light', attributes: {}, schema: {} });
    expect(scenesInScope({ scope: 'device', device_id: 'loose' }, [loose, officeScene])).toEqual(
      [],
    );
  });

  it('is nothing when the device is not in the house at all', () => {
    expect(scenesInScope({ scope: 'device', device_id: 'gone' }, house)).toEqual([]);
  });

  it('is still nothing without a device to ask about', () => {
    expect(scenesInScope({ scope: 'device' }, house)).toEqual([]);
  });

  it('resolves @picked against what the surface has selected', () => {
    // The placement seam hands a widget the token and the surface's answer to
    // it. This branch read the token straight through, so it looked for a
    // device literally called "@picked" and reported no scenes however many
    // the selected lamp had.
    const got = scenesInScope({ scope: 'device', device_id: '@picked' }, house, undefined, 'lamp');
    expect(got.map((d) => d.name)).toEqual(['Concentrate']);
  });

  it('is nothing when nothing is picked', () => {
    expect(scenesInScope({ scope: 'device', device_id: '@picked' }, house)).toEqual([]);
  });
});

describe('the colour a scene is recognised by', () => {
  // The bridge tells us nothing: a Hue scene arrives with a name, an area,
  // whether it is active and three resource ids. Checked against the reference
  // house's 58 scenes — not one carries a colour, so the name is the only
  // evidence there is.
  it('knows the names the household actually has', () => {
    // The twelve in the office, which is the row this was built for.
    const office = [
      'Tropical twilight',
      'Dimmed',
      'Energize',
      'Nightlight',
      'On Air',
      'Relax',
      'Savanna sunset',
      'Read',
      'Concentrate',
      'Spring blossom',
      'Bright',
      'Arctic aurora',
    ];
    const dots = office.map((n) => paletteFor(n).dot);
    // Every one from the written table rather than derived, which is what
    // makes them the colours somebody recognises.
    expect(new Set(dots).size, 'twelve scenes, twelve colours').toBe(12);
    expect(paletteFor('Relax').dot).toBe('#ffb661');
    expect(paletteFor('Spring blossom').dot).toBe('#ff9ec4');
  });

  it('does not let a word inside a name claim it', () => {
    // "nightlight" contains no other key, but "night light" would find
    // "light" if the table were scanned shortest-first — and the longest key
    // winning is the only thing keeping the two apart.
    expect(paletteFor('Nightlight').dot).toBe('#c25a3a');
  });

  it('gives a colour to a scene nobody wrote a palette for', () => {
    // Flutter's version returns nothing here, which leaves one chip with no
    // dot beside eleven that have one — and the odd one out reads as broken
    // rather than as unknown.
    const made = paletteFor('Gerald');
    expect(made.dot).toMatch(/^hsl\(/);
    expect(made.gradient.length).toBeGreaterThan(0);
  });

  it('gives the same scene the same colour every time', () => {
    // A scene that changed colour between rooms or between reloads would be
    // worse than no colour at all.
    expect(paletteFor('Gerald').dot).toBe(paletteFor('gerald').dot);
    expect(paletteFor('Gerald').dot).not.toBe(paletteFor('Mildred').dot);
  });

  it('makes an orb the scene is recognised by, not one the shadow takes over', () => {
    // Running the three stops evenly let the last one take the rim, which is
    // most of what the eye sees, so twilight and blossom both came out pink.
    const orb = orbFor('Tropical twilight');
    expect(orb).toContain('#b98bff 58%');
  });
});

describe('matching a scene name to a palette', () => {
  it('does not let a key match inside a longer word', () => {
    // The Flutter version this came from tests `name.contains(key)`, so "off"
    // matches *Office* — and a scene called "Office evening" came out the grey
    // of one that turns things off.
    expect(paletteFor('Office evening').dot).not.toBe(paletteFor('Deck Off').dot);
    expect(paletteFor('Deck Off').dot).toBe('#5d6675');
  });

  it('still matches a key that is a whole word in a longer name', () => {
    expect(paletteFor('Deck On').dot).not.toBe(paletteFor('Deck Off').dot);
    expect(paletteFor('Savanna sunset').dot).toBe('#ff6b4a');
  });

  it('matches a key that is a phrase', () => {
    expect(paletteFor('On Air').dot).toBe('#ff5b5b');
  });
});

describe('which scenes get a colour', () => {
  it('tells a light scene from one that is not', () => {
    // **A colour orb on a scene that is not about light means nothing.** The
    // palette answers "what does this scene do to the room", which a Hue scene
    // can be asked and "Deck Off" cannot — so the house page's row of door and
    // deck scenes wore six arbitrary swatches, each implying a light it would
    // set. The test is the one `skip_light_scenes` already draws its line
    // with: a Hue scene publishes the light group it belongs to.
    const made = (id: string, name: string, attributes: Record<string, unknown>): DeviceState =>
      ({
        device_id: id,
        name,
        device_type: 'scene',
        available: true,
        attributes,
        last_seen: '2026-09-12T00:00:00Z',
        schema: { actions: { activate: {} } },
      }) as never;
    const hue = made('h1', 'Concentrate', { group_rid: 'g-office', group_kind: 'room' });
    const door = made('l1', 'OH Door 01', { area: 'garage' });
    expect(isLightScene(hue)).toBe(true);
    expect(isLightScene(door)).toBe(false);
  });
});
