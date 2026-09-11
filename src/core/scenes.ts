/**
 * Which scenes a `scene_row` shows.
 *
 * Scenes are their own selection problem: `scope` decides the pool, not
 * `selection_mode`. Core's vocabulary declares `scope`, `room`, `device_id`,
 * `scene_ids`, `skip_light_scenes`, `hide_when_empty` and `heading`, and this
 * implements that.
 */
import type { DeviceState } from './device.js';
import { isScene } from './capability.js';
import type { CommandRequest } from './widget.js';
import { effectiveArea, normalizeAreaName, sceneKind } from './present.js';

export interface SceneRowConfig {
  scope?: string;
  room?: string;
  device_id?: string;
  scene_ids?: string[];
  skip_light_scenes?: boolean;
  order?: string[];
  heading?: string;
  hide_when_empty?: boolean;
}

/**
 * A scene bound to a light group, rather than to a room.
 *
 * Hue publishes `group_kind` / `group_rid` on every scene, because a Hue scene
 * *is* a state of one light group — "Tropical twilight" for the office lamps.
 * Lutron room scenes carry no such binding. That is what `skip_light_scenes`
 * separates: a room's scene row wants the scenes somebody made for the room,
 * not forty colour presets belonging to its bulbs.
 *
 * **Inferred, not declared.** Nothing in the schema says a scene belongs to a
 * light group; this reads the attribute the plugin happens to publish. Filed
 * with the rest of the scene modelling (homeCore#28).
 */
function isLightScene(d: DeviceState): boolean {
  return 'group_rid' in d.attributes || 'group_kind' in d.attributes;
}

/**
 * The scenes in scope, in the order to show them.
 *
 * - `house` — scenes that belong to no room. A house row is the ones that are
 *   about the whole house, not every scene in it.
 * - `room` — scenes whose area matches, once both sides are normalised. 41 of
 *   58 scenes in the reference house carry an area.
 * - `device` — the scenes that drive this device, with `@picked` resolved
 *   against the surface's selection. A scene is bound to a light
 *   *group* rather than to a bulb, so this is the light scenes of the room it
 *   is in, unless a plugin declared `parent_device_id` and meant it.
 * - explicit `scene_ids` — exactly those, in the order written.
 */
export function scenesInScope(
  config: SceneRowConfig,
  devices: readonly DeviceState[],
  room?: string,
  picked?: string,
): DeviceState[] {
  const scenes = devices.filter(isScene);

  // An explicit list wins over any scope: somebody chose these, and chose the
  // order too.
  if (config.scene_ids !== undefined && config.scene_ids.length > 0) {
    const byId = new Map(scenes.map((d) => [d.device_id, d]));
    return config.scene_ids.flatMap((id) => {
      const d = byId.get(id);
      return d === undefined ? [] : [d];
    });
  }

  const scope = config.scope ?? 'house';
  const want = normalizeAreaName(config.room === '@room' ? room : (config.room ?? room));

  let chosen: DeviceState[];
  switch (scope) {
    case 'house':
      chosen = scenes.filter((d) => normalizeAreaName(effectiveArea(d)) === '');
      break;
    case 'room':
      chosen =
        want === '' ? [] : scenes.filter((d) => normalizeAreaName(effectiveArea(d)) === want);
      break;
    case 'device': {
      // **A scene is bound to a light *group*, not to a bulb.** This asked for
      // `parent_device_id` and nothing else, and not one of the 58 scenes in
      // the reference house carries one — so a device row rendered "No scenes
      // here." beside ten scenes that drive the very lamp that was selected.
      // It was not a house without the data; it was a lookup on the wrong
      // field.
      //
      // What the data does have is the group: a Hue scene publishes
      // `group_rid`, `group_kind` and the area the group is in, and a light
      // publishes its area. So a light scene belongs to a device when they
      // are in the same room — which is what "this lamp's scenes" means to a
      // person, and the closest relation the plugins actually give.
      //
      // `parent_device_id` is still honoured first, because a plugin that does
      // declare one means it exactly and should not be second-guessed.
      // **`@picked` is resolved here, like `@room` is.** The placement seam
      // hands a widget the token and the surface's answer to it (§14.1), and
      // this branch read the token straight through — so it looked for a
      // device literally called "@picked", found none, and reported no scenes
      // however many the selected lamp had.
      const id = config.device_id === '@picked' ? picked : config.device_id;
      if (id === undefined) {
        chosen = [];
        break;
      }
      const declared = scenes.filter((d) => d.parent_device_id === id);
      if (declared.length > 0) {
        chosen = declared;
        break;
      }
      const device = devices.find((d) => d.device_id === id);
      const area = device === undefined ? '' : normalizeAreaName(effectiveArea(device));
      chosen =
        area === ''
          ? []
          : scenes.filter((d) => isLightScene(d) && normalizeAreaName(effectiveArea(d)) === area);
      break;
    }
    default:
      chosen = scenes;
  }

  if (config.skip_light_scenes === true) chosen = chosen.filter((d) => !isLightScene(d));

  if (config.order !== undefined && config.order.length > 0) {
    const rank = new Map(config.order.map((id, i) => [id, i]));
    chosen = [...chosen].sort(
      (a, b) =>
        (rank.get(a.device_id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.device_id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return chosen;
}

/** Re-exported so a widget asks one module about scenes. */
export { sceneKind };

/**
 * How to apply a scene: **the action it declares.**
 *
 * Every scene in the reference house now declares `activate`, which is the
 * model — applying a scene is a thing you do, and a scene does not
 * meaningfully turn off. The `on: true` write is kept only for a plugin that
 * has not restarted since the upgrade and still declares nothing.
 */
export function activation(scene: DeviceState): CommandRequest {
  const declared = (scene.schema?.actions ?? []).find((a) => a.id === 'activate');
  if (declared !== undefined) {
    return { deviceId: scene.device_id, action: { id: declared.id, params: {} } };
  }
  return typeof scene.attributes['on'] === 'boolean'
    ? { deviceId: scene.device_id, patch: { on: true } }
    : { deviceId: scene.device_id, action: { id: 'activate', params: {} } };
}
