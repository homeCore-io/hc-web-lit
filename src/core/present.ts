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

/** A numeric level (0–100) when the device publishes one. */
export function levelOf(d: DeviceState): number | undefined {
  for (const key of ['brightness', 'level', 'position', 'percentage']) {
    const v = d.attributes[key];
    if (typeof v === 'number') return v;
  }
  return undefined;
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

  const s = a['state'];
  if (typeof s === 'string') {
    const lowered = s.toLowerCase();
    return lowered === 'playing' || lowered === 'running';
  }

  const level = levelOf(d);
  return level !== undefined && level > 0;
}
