/**
 * What a device *is for*, derived from what its plugin declared.
 *
 * **Nothing here maps a `device_type` name to a behaviour.** A table like
 * `temperature_sensor → sensor` is a client deciding what a plugin's word
 * means, closed against the next plugin that invents one, and silently wrong
 * rather than visibly missing. The declaration is `DeviceSchema`, and where it
 * cannot answer, the answer is *"unknown"* — which is a gap to file, not a
 * blank to fill in (homeCore#28).
 *
 * ## What the schema genuinely settles
 *
 * A device with a writable attribute or a declared action is one you **command**.
 * One with a schema and neither is one you **read**. Measured across 184 real
 * devices that is right every time, including the case a type table would have
 * got wrong: a `pico_remote` declares no writable attribute and no action —
 * it transmits, and cannot be pressed remotely — while a `keypad` declares
 * `press_button`. Same shape of hardware, opposite answers, and the plugins
 * already said so.
 */
import type { DeviceState } from './device.js';

/**
 * `commandable` — writable attributes or actions; the device takes orders.
 * `readable`    — a schema, and neither; the device reports.
 * `unknown`     — no schema. Not a third kind of device: a missing declaration.
 */
export type Role = 'commandable' | 'readable' | 'unknown';

/**
 * The device's role, from its own declaration.
 *
 * 107 of 184 devices in the reference house answer; the other 77 are `unknown`
 * because their plugins publish no schema. That number is the point — it is
 * visible here rather than hidden behind a guess.
 */
export function roleOf(d: DeviceState): Role {
  const schema = d.schema;
  if (schema == null) return 'unknown';

  const attrs = schema.attributes ?? {};
  if (Object.values(attrs).some((a) => a.writable === true)) return 'commandable';
  if ((schema.actions ?? []).length > 0) return 'commandable';
  if (Object.keys(attrs).length > 0) return 'readable';

  return 'unknown';
}

/**
 * Whether on-ness is a question worth asking of this device.
 *
 * A temperature sensor is not off. It reports a value and cannot be turned off,
 * so "is it on?" is not an unanswered question about it — it is the wrong
 * question, and a card that renders "Off" beside a thermometer has invented a
 * fact rather than admitted ignorance.
 *
 * Derived, not listed: a device you cannot command has no power state to
 * report. A `readable` device that happens to publish `open` or `motion` is
 * still reporting a *reading*, and `readingOf` is what presents it.
 */
export function hasPowerState(d: DeviceState): boolean {
  return roleOf(d) === 'commandable';
}

/** One reading, ready to draw. */
export interface Reading {
  key: string;
  value: unknown;
  unit?: string;
  label: string;
}

/**
 * Attribute keys a client has to demote **because nothing declares them**.
 *
 * `AttributeSchema.category` exists for exactly this — `diagnostic` for
 * battery, signal and firmware, `config` for settings — and **no device in the
 * reference house sets it, on any plugin**. So a lock's battery is declared
 * exactly as primary as whether it is locked, and a client that trusted the
 * declaration would lead with the battery.
 *
 * This list is therefore a **stopgap for a gap that is filed** (homeCore#28),
 * and it is deliberately short: enough to stop the obvious burials, not an
 * attempt to out-guess the plugins on every attribute they publish.
 */
const UNDECLARED_HOUSEKEEPING = new Set([
  'battery',
  'battery_pct',
  'battery_kind',
  'battery_low',
  'battery_state',
  'rssi',
  'lqi',
  'firmware',
  'sw_version',
  'uptime',
  'bridge_id',
  'resource_id',
  'kind',
  'name',
  'area',
  'group_kind',
  'group_name',
  'group_rid',
  'ip',
  'mac',
  'model',
]);

export function isHousekeeping(key: string, declared?: { category?: string }): boolean {
  // A declaration always wins. This is the branch that should be doing the work.
  if (declared?.category === 'diagnostic' || declared?.category === 'config') return true;
  return (
    UNDECLARED_HOUSEKEEPING.has(key) || key.endsWith('_unit') || key.startsWith('customserver.')
  );
}

/**
 * What a device is actually telling you — its first non-housekeeping reading.
 *
 * The `_unit` sibling is attached by convention: `temperature` and
 * `temperature_unit` is how every ecowitt and yolink sensor publishes, and the
 * pairing is a naming habit rather than a declared relationship. A schema that
 * carried `unit` on the attribute would say it properly, and some do.
 *
 * "First" is the device's own attribute order, which is not a declaration
 * either. That is the second half of the same gap: **nothing says which reading
 * is the point of the device**, only which ones are not.
 */
export function readingOf(d: DeviceState): Reading | undefined {
  const attrs = d.schema?.attributes;

  for (const [key, value] of Object.entries(d.attributes)) {
    const declared = attrs?.[key];
    if (isHousekeeping(key, declared)) continue;
    if (value === null || typeof value === 'object') continue;

    const unit =
      declared?.unit ??
      (typeof d.attributes[`${key}_unit`] === 'string'
        ? (d.attributes[`${key}_unit`] as string)
        : undefined);

    return {
      key,
      value,
      ...(unit !== undefined ? { unit } : {}),
      label: declared?.display_name ?? key.replace(/_/g, ' '),
    };
  }
  return undefined;
}

/** A reading as a person reads it: `21.5 °C`, `Open`, `No water detected`. */
export function formatReading(r: Reading): string {
  if (typeof r.value === 'boolean') {
    // A boolean reading reports a condition, not a power state. "Open" is what
    // a contact sensor means; "On" is not.
    const positive = r.label.replace(/^./, (c) => c.toUpperCase());
    return r.value ? positive : `No ${r.label}`;
  }
  if (typeof r.value === 'number') {
    const rounded = Math.abs(r.value) >= 100 ? Math.round(r.value) : Math.round(r.value * 10) / 10;
    const unit = r.unit === undefined ? '' : r.unit === '%' ? '%' : ` ${r.unit}`;
    return `${rounded}${unit}`;
  }
  return String(r.value);
}
