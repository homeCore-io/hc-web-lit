/**
 * Which scenes a `scene_row` shows.
 *
 * Scenes are their own selection problem: `scope` decides the pool, not
 * `selection_mode`. Core's vocabulary declares `scope`, `room`, `device_id`,
 * `scene_ids`, `skip_light_scenes`, `hide_when_empty` and `heading`, and this
 * implements that.
 */
import type { DeviceState } from './device.js';
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

const isScene = (d: DeviceState): boolean => d.device_type === 'scene';

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
 * - `device` — scenes a particular device provides.
 * - explicit `scene_ids` — exactly those, in the order written.
 */
export function scenesInScope(
  config: SceneRowConfig,
  devices: readonly DeviceState[],
  room?: string,
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
      const id = config.device_id;
      chosen = id === undefined ? [] : scenes.filter((d) => d.parent_device_id === id);
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
