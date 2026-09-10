/**
 * What a device can do, from what it declared (§ capability.ts).
 *
 * Every fixture here is a shape the reference house actually publishes, and
 * every predicate was measured against the `device_type` check it replaces
 * across all 184 devices before anything was deleted. These pin the cases
 * where the two disagree — because those are the ones that matter, and in
 * every one of them the type was wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  canWrite,
  declaresAction,
  isDimmable,
  isLockable,
  isReadable,
  isScene,
  isSwitchable,
  writableAttributes,
} from '../src/core/capability.js';
import { checkAction } from '../src/core/safety.js';
import { tagForDevice } from '../src/core/registry.js';
import '../src/widgets/hc-lock.js';
import '../src/widgets/hc-scene-button.js';
import type { DeviceState } from '../src/core/device.js';
import type { DeviceSchema } from '../src/core/api.js';

const device = (over: Partial<DeviceState> & { schema?: DeviceSchema | null }): DeviceState => ({
  device_id: 'd',
  name: 'Device',
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-10T00:00:00Z',
  ...over,
});

/** A Hue scene: `activate`, and one readable attribute saying if it applied. */
const hueScene = device({
  device_id: 'hue_scene_1',
  device_type: 'scene',
  schema: { attributes: { active: { kind: 'bool' } }, actions: [{ id: 'activate', label: 'Go' }] },
});

/**
 * The front door as it was reported before a rescan corrected it: typed
 * `zwave` like every other node, and declaring a writable `locked` throughout.
 */
const zwaveLock = device({
  device_id: 'zwave_23',
  device_type: 'zwave',
  schema: {
    attributes: { locked: { kind: 'bool', writable: true }, battery: { kind: 'integer' } },
    actions: [],
  },
});

/** A Lutron switch hinted as a light. It is a light, and it cannot dim. */
const hintedSwitch = device({
  device_id: 'lutron_50',
  device_type: 'switch',
  ui_hint: 'light',
  schema: { attributes: { on: { kind: 'bool', writable: true } }, actions: [] },
});

/** A Pico remote: it transmits, and cannot be pressed remotely (§1.1). */
const pico = device({
  device_id: 'caseta_6',
  device_type: 'pico_remote',
  schema: {
    attributes: { last_button: { kind: 'string' }, battery: { kind: 'integer' } },
    actions: [],
  },
});

describe('a scene', () => {
  it('is one because it declares activate', () => {
    // 58 of 58 scenes in the house declare it, and nothing else does.
    expect(isScene(hueScene)).toBe(true);
    expect(isScene(zwaveLock)).toBe(false);
  });

  it('is still one when it reports whether it applied', () => {
    // The first attempt was "activate *and nothing readable*", which was wrong
    // on 52 of 58: a Hue scene declares `active` and a Lutron one declares
    // `on` and `led_component` once its LED query answers. Those readings are
    // how a scene says it is applied (§7.3), so requiring their absence
    // excluded exactly the scenes that work best.
    expect(isScene(hueScene)).toBe(true);
    const lutron = device({
      device_type: 'scene',
      schema: {
        attributes: { on: { kind: 'bool' }, led_component: { kind: 'integer' } },
        actions: [{ id: 'activate', label: 'Go' }],
      },
    });
    expect(isScene(lutron)).toBe(true);
  });
});

describe('what a device can be told to do', () => {
  it('finds a lock whose name does not say so', () => {
    // The house reported the front door this way until a `rescan_nodes`
    // re-registered it as `lock`. The name was wrong for however long that
    // was; the declaration was right throughout, which is the argument.
    expect(isLockable(zwaveLock)).toBe(true);
    expect(zwaveLock.device_type).toBe('zwave');
  });

  it('separates being a light from being dimmable', () => {
    // Both true of the same device: `ui_hint` says a person calls it a light,
    // and the schema says all it can do is turn on. Offering brightness would
    // draw a control the hardware does not have.
    expect(hintedSwitch.ui_hint).toBe('light');
    expect(isSwitchable(hintedSwitch)).toBe(true);
    expect(isDimmable(hintedSwitch)).toBe(false);
  });

  it('accepts either spelling of brightness', () => {
    // A Hue bulb publishes `brightness` (0–255) and `brightness_pct` (0–100);
    // half the lights in the house publish only the percentage (§1.1).
    const pct = device({
      schema: { attributes: { brightness_pct: { kind: 'integer', writable: true } }, actions: [] },
    });
    const raw = device({
      schema: { attributes: { brightness: { kind: 'integer', writable: true } }, actions: [] },
    });
    expect(isDimmable(pct)).toBe(true);
    expect(isDimmable(raw)).toBe(true);
  });

  it('reads a device that takes no orders as readable', () => {
    // §1.1's worked example: a Pico transmits and cannot be pressed remotely,
    // while a keypad declares `press_button`. Same hardware shape, opposite
    // answers, and the plugins already said so.
    expect(isReadable(pico)).toBe(true);
    expect(writableAttributes(pico)).toEqual([]);
  });

  it('does not call a scene readable, though it writes nothing', () => {
    // The clause that separates the two: a scene has an action, and a scene is
    // emphatically something you command.
    expect(isReadable(hueScene)).toBe(false);
  });
});

describe('a device that declared nothing', () => {
  it('still answers what *kind* of thing it is, from its name', () => {
    // `device_type` demotes to a hint; it is not deleted. A plugin that has
    // not restarted since schemas became universal publishes none, and a scene
    // that stops being a scene is a worse answer than a name-based one — which
    // is what the first attempt did, and what five scene tests caught.
    expect(isLockable(device({ device_type: 'lock', schema: null }))).toBe(true);
    expect(isScene(device({ device_type: 'scene', schema: null }))).toBe(true);
    expect(isReadable(device({ device_type: 'water_sensor', schema: null }))).toBe(true);
  });

  it('answers no about what it can physically do', () => {
    // The other kind of question, and the reason the two are separated: a name
    // is not evidence of a capability. Falling back here would reintroduce the
    // exact wrong answer these replaced — two Lutron switches hinted `light`
    // that cannot dim.
    const bare = device({ device_type: 'light', ui_hint: 'light', schema: null });
    expect(isDimmable(bare)).toBe(false);
    expect(isSwitchable(bare)).toBe(false);
    expect(canWrite(bare, 'locked')).toBe(false);
    expect(declaresAction(bare, 'activate')).toBe(false);
  });
});

describe('which widget draws it', () => {
  it('lets a person’s hint win over what the device declares', () => {
    // `ui_hint` exists so a person can correct a plugin. A capability check
    // that overrode it would make the override cosmetic (§1.1).
    expect(tagForDevice({ ui_hint: 'lock', device_type: 'switch' })).toBe('hc-lock');
  });

  it('falls back to the declaration when no name reaches it', () => {
    // A door drawn as a generic card, with a plain toggle in its control row.
    expect(tagForDevice(zwaveLock)).toBe('hc-lock');
    expect(tagForDevice(hueScene)).toBe('hc-scene-button');
  });

  it('answers nothing for a bare type nobody registered', () => {
    // Several callers ask "what would this type draw as" with no device.
    expect(tagForDevice({ device_type: 'sankey_from_the_future' })).toBeUndefined();
  });
});

describe('the safety policy', () => {
  it('asks about an action on a device that declares itself lockable', () => {
    // `check` has always had a second test on the attribute; `checkAction` had
    // only the type, so a lock that does not say "lock" was unguarded.
    const verdict = checkAction(zwaveLock, 'unlock');
    expect(verdict).toHaveProperty('confirm');
  });

  it('still lets an ordinary action through', () => {
    expect(checkAction(pico, 'identify')).toEqual({ allow: true });
  });
});

describe('the power facet', () => {
  it('reads the declared unit, not the attribute’s spelling', async () => {
    const { selectDevices } = await import('../src/core/selection.js');
    // The house publishes `power_w`, `energy_kwh`, `current_a`, `voltage` —
    // none of which are the words the old test asked for, so a facet the real
    // dashboards reference selected nothing at all (homeCore#30).
    const meter = device({
      device_id: 'plug',
      device_type: 'switch',
      attributes: { power_w: 12.4 },
      schema: {
        attributes: { power_w: { kind: 'float', unit: 'W' }, on: { kind: 'bool', writable: true } },
        actions: [],
      },
    });
    const plain = device({
      device_id: 'lamp',
      device_type: 'switch',
      schema: { attributes: { on: { kind: 'bool', writable: true } }, actions: [] },
    });

    const got = selectDevices({ selection_mode: 'facet', facet: ['power'] }, [meter, plain], {});
    expect(got.map((d) => d.device_id)).toEqual(['plug']);
  });

  it('leaves out a power-ish name that declares no unit', async () => {
    const { selectDevices } = await import('../src/core/selection.js');
    // `power_mode` is a string with no unit. Any name-prefix match sweeps it
    // in; the declaration says plainly that it is not a measurement.
    const roku = device({
      device_id: 'roku',
      schema: { attributes: { power_mode: { kind: 'string' } }, actions: [] },
    });
    expect(selectDevices({ selection_mode: 'facet', facet: ['power'] }, [roku], {})).toEqual([]);
  });
});
