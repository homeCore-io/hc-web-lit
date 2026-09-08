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
import type { BoolStates } from './api.js';
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
  /** The device's own words for a boolean's two sides, when it declared them. */
  states?: BoolStates;
}

/**
 * Words for the booleans every house has, **because no plugin declares them.**
 *
 * `AttributeSchema.states` exists for exactly this — core's comment says a
 * contact sensor's single `open` attribute otherwise renders as "open, but
 * Not", a logic gate standing in for a word the device already has — and it is
 * set on no device in the reference house (homeCore#29).
 *
 * So this covers the handful that appear everywhere and nothing else: a
 * negated label is a bad reading, not a wrong one, and inventing words for
 * attributes nobody has seen would be worse.
 */
const BOOLEAN_WORDS: Record<string, [string, string]> = {
  on: ['On', 'Off'],
  open: ['Open', 'Closed'],
  locked: ['Locked', 'Unlocked'],
  motion: ['Motion', 'Clear'],
  occupancy: ['Occupied', 'Clear'],
  occupied: ['Occupied', 'Clear'],
  water_detected: ['Water detected', 'Dry'],
  vibration: ['Vibration', 'Still'],
  enabled: ['Enabled', 'Disabled'],
  available: ['Available', 'Unavailable'],
  active: ['Active', 'Inactive'],
};

/**
 * Attribute keys to demote **where nothing declares them yet**.
 *
 * `AttributeCategory` is set by plugins now — core's `for_name` lexicon covers
 * battery in all its spellings, rssi, lqi, signal_strength, firmware,
 * sw_version, uptime, ip, mac, model, manufacturer, serial, name, area,
 * location, kind, bridge_id, resource_id, node_id and any `*_unit` sibling, and
 * hc-zwave, hc-ecowitt, hc-yolink and hc-isy call it. 117 attributes in the
 * reference house carry a category where none did.
 *
 * So this is a fallback rather than a policy, and it stays for two cases that
 * will not clear up on their own (`SCHEMA_CONTRACT_2026-09.md` §3):
 *
 * - a plugin that has not restarted since the upgrade is still silent, because
 *   schemas are retained MQTT topics published at registration;
 * - a Hue facet compacted onto a light leaves that light's extra attributes
 *   undeclared, since only aux devices published in their own right got
 *   schemas.
 *
 * Trimmed to what those two cases actually produce. The `_unit` and
 * `customserver.` rules stay because they are shape rules rather than names.
 */
const UNDECLARED_HOUSEKEEPING = new Set([
  'battery',
  'battery_pct',
  'battery_state',
  'bridge_id',
  'resource_id',
  'kind',
  'name',
  'area',
  'group_kind',
  'group_name',
  'group_rid',
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

  const candidates = Object.entries(d.attributes).filter(([key, value]) => {
    if (isHousekeeping(key, attrs?.[key])) return false;
    return value !== null && typeof value !== 'object';
  });
  if (candidates.length === 0) return undefined;

  // **The declaration first.** `primary` is an ordered list of the readings a
  // device is *for*, most important first — core derives it at serve time from
  // the device's own type, ranks by significance where the type says nothing
  // (every Z-Wave node, since they are all `device_type: "zwave"`), and sorts
  // whatever neither table names. A plugin that declares its own keeps it.
  //
  // The ordering also fixes something this client could not have solved alone:
  // `attributes` is a HashMap in Rust, so "the first attribute" was never
  // stable between reads.
  const named = (d.schema?.primary ?? [])
    .map((key) => candidates.find(([k]) => k === key))
    .find((entry) => entry !== undefined);

  // Older core, or a schema that predates the field. This is the heuristic
  // `primary` replaces: a `temperature_sensor` reports `temperature`, whatever
  // else it also reports.
  const stem = (d.device_type ?? '').replace(/_sensor$/, '');
  const guessed =
    stem === ''
      ? undefined
      : candidates.find(([key]) => key === stem || key.startsWith(`${stem}_`));

  const [key, value] = named ?? guessed ?? candidates[0]!;
  const declared = attrs?.[key];
  const unit =
    declared?.unit ??
    (typeof d.attributes[`${key}_unit`] === 'string'
      ? (d.attributes[`${key}_unit`] as string)
      : undefined);

  return {
    key,
    value,
    ...(unit !== undefined ? { unit } : {}),
    ...(declared?.states !== undefined ? { states: declared.states } : {}),
    label: declared?.display_name ?? key.replace(/_/g, ' '),
  };
}

/** A reading as a person reads it: `21.5 °C`, `Open`, `No water detected`. */
export function formatReading(r: Reading): string {
  if (typeof r.value === 'boolean') {
    // The device's own word first. Then a word for the booleans every house
    // has. Then the attribute's name, which is where "No on" came from — a
    // negation is a bad reading rather than a wrong one, and the fallback
    // should be visibly last.
    const declared = r.value ? r.states?.when_true?.label : r.states?.when_false?.label;
    if (declared !== undefined) return declared.replace(/^./, (c) => c.toUpperCase());

    const known = BOOLEAN_WORDS[r.key];
    if (known !== undefined) return r.value ? known[0] : known[1];

    const positive = r.label.replace(/^./, (c) => c.toUpperCase());
    return r.value ? positive : `Not ${r.label}`;
  }
  if (typeof r.value === 'number') {
    const rounded = Math.abs(r.value) >= 100 ? Math.round(r.value) : Math.round(r.value * 10) / 10;
    const unit = r.unit === undefined ? '' : r.unit === '%' ? '%' : ` ${r.unit}`;
    return `${rounded}${unit}`;
  }
  return String(r.value);
}
