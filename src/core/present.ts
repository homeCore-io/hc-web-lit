/**
 * Derived presentation — the host primitive from §1.1.
 *
 * A homeCore device has `available` and an `attributes` map, and nothing that
 * answers "is this on?". That answer is *derived*, per device, from whichever
 * attribute the thing actually publishes, and every widget that got it wrong
 * got it wrong the same way: by inventing its own rule.
 *
 * So this is the only implementation. It reaches widgets through `HcContext`
 * (§4.2) and never gets reimplemented behind it.
 */
import type { DeviceState } from './device.js';

/** The label to show a person: the user's override, else the plugin's name. */
export function effectiveName(d: DeviceState): string {
  return d.name_override ?? d.name;
}

/** The room: the user's override, else what the plugin delivered. */
export function effectiveArea(d: DeviceState): string | undefined {
  return d.area_override ?? d.area;
}

/**
 * An area name reduced to its canonical form — this client's mirror of core's
 * `normalize_name_segment`.
 *
 * "Living Room", "living room" and "LIVING-ROOM" are all `living_room`. Core
 * normalizes on the way in, so stored areas already have this shape; what needs
 * normalizing is everything else — a hand-typed value, a plugin's own spelling,
 * a page exported from a house that spelled it differently.
 */
export function normalizeAreaName(area: string | undefined): string {
  if (area === undefined) return '';
  return area
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * A numeric level, **always 0–100**, when the device publishes one.
 *
 * The `_pct` attributes are checked first and the raw ones are converted,
 * because plugins publish both and they are not in the same units. A Hue light
 * carries `brightness` 0–255 *and* `brightness_pct` 0–100 for the same bulb;
 * half the lights in a real house carry only the `_pct` one. Reading whichever
 * appeared first in a list would give a slider that is right on some fixtures
 * and 2.55× wrong on others — which is the kind of thing that looks like a
 * rendering bug for a week.
 *
 * `on` is a separate question and answered separately: a dimmer that is off
 * still remembers the level it will return to, so a non-zero level here does
 * not mean the device is on (see `isOn`, which only consults this as a last
 * resort).
 */
export function levelOf(d: DeviceState): number | undefined {
  // Already a percentage.
  for (const key of ['brightness_pct', 'speed_pct', 'level_pct', 'position', 'percentage']) {
    const v = d.attributes[key];
    if (typeof v === 'number') return v;
  }
  // 0–255, the raw byte a bulb actually takes.
  const raw = d.attributes['brightness'];
  if (typeof raw === 'number') return (raw / 255) * 100;
  // Unqualified, and assumed already a percentage.
  const level = d.attributes['level'];
  return typeof level === 'number' ? level : undefined;
}

/**
 * Whether the device reads as "doing something" right now.
 *
 * The order matters. A lock is inverted — an *unlocked* lock is the state worth
 * noticing — and occupancy is the same kind of signal as motion, so an occupied
 * room reads active rather than sitting quietly next to an "occupied" subtitle.
 */
export function isOn(d: DeviceState): boolean {
  const a = d.attributes;

  if (typeof a['on'] === 'boolean') return a['on'];
  if (typeof a['locked'] === 'boolean') return !a['locked'];
  if (typeof a['open'] === 'boolean') return a['open'];
  if (typeof a['motion'] === 'boolean') return a['motion'];

  const occupancy = a['occupancy'] ?? a['occupied'];
  if (typeof occupancy === 'boolean') return occupancy;

  // A scene that is currently applied. Hue publishes this; Lutron scenes carry
  // `on`, and some carry nothing at all and are simply never "on".
  if (typeof a['active'] === 'boolean') return a['active'];

  const s = a['state'];
  if (typeof s === 'string') {
    const lowered = s.toLowerCase();
    return lowered === 'playing' || lowered === 'running';
  }

  const level = levelOf(d);
  return level !== undefined && level > 0;
}
