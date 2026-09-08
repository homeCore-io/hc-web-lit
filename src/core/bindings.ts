/**
 * Live values in a widget's config — `bindings` and `count`.
 *
 * A stored page is full of placeholders: `text: "—"` next to `bindings:
 * [{device_id: "ecowitt_indoor", key: "temperature", property: "text"}]`, and
 * `text: "7"` next to `count: "lights_on"`. The literal is what a client that
 * cannot resolve them draws — an em-dash, honestly blank — and the binding is
 * what a client that can should draw instead.
 *
 * **Resolved at the placement seam**, with `@room` and `@picked` (§14.1), for
 * the same reason: a binding names `@picked` and only the page knows what that
 * is. A widget receives a config with live values already in it and never
 * learns the mechanism.
 *
 * `count` is declared in core's vocabulary (`one_of` devices, lights,
 * lights_on, offline, playing). `bindings` is **not** — it rides in
 * `extra_fields`, so its shape is a convention between whoever wrote the
 * document and whoever reads it. Same family of gap as facet names
 * (homeCore#30); noted rather than guessed at.
 */
import type { DeviceState } from './device.js';
import { isOn } from './present.js';
import { roleOf } from './facet.js';
import { resolveToken, type SelectionContext } from './selection.js';
import { humanise } from './text.js';

/** One live value: take `key` off `device_id` and put it in `property`. */
export interface Binding {
  device_id: string;
  key: string;
  property: string;
  /** Decimal places, when the value is a number. */
  decimals?: number;
}

/** The tallies `count` can name. */
export type Tally = 'devices' | 'lights' | 'lights_on' | 'offline' | 'playing';

/**
 * A house tally.
 *
 * `lights` counts by facet rather than by `device_type`, so a switch hinted as
 * a light counts as one — the alternative is a header that disagrees with the
 * room below it, which is the bug this exact number caused once already.
 */
export function houseTally(metric: string, devices: readonly DeviceState[]): number | undefined {
  const isLight = (d: DeviceState): boolean => (d.ui_hint ?? d.device_type) === 'light';

  switch (metric as Tally) {
    case 'devices':
      return devices.filter((d) => d.device_type !== 'scene').length;
    case 'lights':
      return devices.filter(isLight).length;
    case 'lights_on':
      return devices.filter((d) => isLight(d) && isOn(d) === true).length;
    case 'offline':
      return devices.filter((d) => !d.available).length;
    case 'playing':
      return devices.filter(
        (d) => (d.ui_hint ?? d.device_type) === 'media_player' && isOn(d) === true,
      ).length;
    default:
      // An unknown metric renders the literal the document carried, which is
      // what a client that never heard of counts would have drawn.
      return undefined;
  }
}

function format(value: unknown, decimals: number | undefined): string {
  if (typeof value === 'number') {
    return decimals === undefined ? String(Math.round(value * 10) / 10) : value.toFixed(decimals);
  }
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value === null || value === undefined) return '—';
  return String(value);
}

/**
 * Config keys that hold words for a person rather than a selection.
 *
 * An inclusion list, because the same token means different things either side
 * of it: `scene_row` carries `room: "@room"` and means the slug, `text` carries
 * `"@room"` and means the name. Guessing from the value would get one of them
 * wrong.
 */
const DISPLAY_KEYS = ['text', 'heading', 'label', 'caption'] as const;

/**
 * A room as a person says it.
 *
 * Core's own area names are what the rest of this client shows — `family room`,
 * lower case, spaces — and the slug is that name normalised. Turning the
 * underscores back is enough; inventing a capitalisation here would be this
 * client having an opinion about the house's own words.
 */
function roomLabel(room: string | undefined): string {
  return room === undefined ? '' : humanise(room);
}

/**
 * A widget's config with its live values filled in.
 *
 * Returns the same object when nothing applies, so an unchanged widget is not
 * re-rendered for the sake of a copy.
 */
export function resolveConfig(
  config: Record<string, unknown>,
  devices: readonly DeviceState[],
  ctx: SelectionContext = {},
): Record<string, unknown> {
  const bindings = Array.isArray(config['bindings']) ? (config['bindings'] as Binding[]) : [];
  const count = typeof config['count'] === 'string' ? config['count'] : undefined;
  const named = DISPLAY_KEYS.filter((k) => typeof config[k] === 'string' && config[k] === '@room');
  if (bindings.length === 0 && count === undefined && named.length === 0) return config;

  const out = { ...config };

  // `@room` reads two ways and both are right. In `area_name` it selects, and
  // stays the slug the selection matches on. In a *display* field it is the
  // room's name — a breadcrumb saying `@room` is the token showing through,
  // which is what the room page did until this existed.
  for (const key of named) out[key] = roomLabel(ctx.room);

  if (count !== undefined) {
    const n = houseTally(count, devices);
    if (n !== undefined) out['text'] = String(n);
  }

  for (const b of bindings) {
    if (typeof b?.device_id !== 'string' || typeof b.key !== 'string') continue;
    const id = resolveToken(b.device_id, ctx);
    if (id === undefined) continue;

    const device = devices.find((d) => d.device_id === id);
    if (device === undefined) continue;

    // `name` is the device's, not an attribute of it — the one key that reads
    // off the record rather than out of the map.
    const value =
      b.key === 'name'
        ? (device.name_override ?? device.name)
        : b.key === 'area'
          ? (device.area_override ?? device.area)
          : device.attributes[b.key];

    if (value === undefined) continue;
    out[b.property ?? 'text'] = format(value, b.decimals);
  }

  return out;
}

/** Exported for a test that pins what a tally counts. */
export { roleOf };
