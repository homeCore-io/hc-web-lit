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
import { humanise, lowerFirst } from './text.js';

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

/**
 * The unit for one attribute, from the two places a device can say it.
 *
 * **The published sibling wins over the declaration**, which is the opposite
 * of the usual rule here and is a deliberate exception. A schema describes an
 * attribute in general; `<key>_unit` is published beside the value and
 * describes *this reading*. When they disagree the live one is the one to
 * trust, and they do disagree in the reference house: a Hue motion sensor
 * declares `temperature` as `unit: "°C"` and publishes
 *
 *     temperature: 71.33   temperature_unit: "F"
 *     temperature_f: 71.33  temperature_c: 21.85
 *
 * so the value is plainly Fahrenheit and the declaration is wrong
 * (homeCore#40). Preferring the declaration renders "71.3 °C", which is not a
 * rounding error or a cosmetic slip — it is a house on fire, drawn calmly.
 *
 * Where only one of the two exists, that one is used and nothing is inferred.
 */
function unitFor(d: DeviceState, key: string, declared?: { unit?: string }): string | undefined {
  const published = d.attributes[`${key}_unit`];
  if (typeof published === 'string' && published !== '') return degrees(published);
  return declared?.unit;
}

/**
 * `F` and `C` are how a plugin publishes a temperature unit; `°F` is how a
 * person reads one. Bare letters only — a plugin that already sent `°F`, or
 * sent `lux` or `ppm`, is left exactly as it wrote it.
 */
function degrees(unit: string): string {
  return /^[FCK]$/.test(unit) ? `\u00b0${unit}` : unit;
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
 * `AttributeCategory` is set by plugins now — 296 attributes in the reference
 * house carry one, against zero when homeCore#29 was filed — and the effect on
 * this list is worth stating precisely, because it is the difference between a
 * stopgap and a policy.
 *
 * **It no longer decides a single headline.** Simulating `readingOf` across all
 * 184 devices with and without this list changes nothing: `primary` names the
 * right attribute every time, so the lock leads with `locked` rather than with
 * its battery because the plugin said so, not because this client recognised
 * the word "battery". That is the whole point of homeCore#29 and it is closed.
 *
 * What is left is the second job — filtering the attributes a card *lists* —
 * and there the undeclared names are still real, all from one cause the
 * September contract predicted: a Hue facet compacted onto a light leaves that
 * light's glue undeclared, because only aux devices published in their own
 * right got schemas. `bridge_id` ×48, `kind` ×50, `resource_id` ×47, `name`
 * ×40, `area` and the `group_*` trio ×39.
 *
 * So: a floor under a detail list, not an opinion about what a device is for.
 * The `_unit` and `customserver.` rules stay because they are shape rules
 * rather than names.
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
    UNDECLARED_HOUSEKEEPING.has(key) ||
    key.endsWith('_unit') ||
    key.startsWith('customserver.') ||
    // What the *integration* can do, not what the house is doing (homeCore#34).
    // 69 booleans in the reference house are `supports_gradient`, `is_tv`,
    // `ecp_control_enabled` and their kin, none carrying a category, so a detail
    // list renders them as state — and since nothing declares `states` for them
    // either, they come out as "Not supports gradient", which is the synthesised
    // negation the whole `states` field exists to stop. A shape rule like
    // `_unit` above, not a list of names, and it should stop mattering once
    // `for_name` grows the same prefixes.
    /^(supports|is)_/.test(key)
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
  const unit = unitFor(d, key, declared);

  return {
    key,
    value,
    ...(unit !== undefined ? { unit } : {}),
    ...(declared?.states !== undefined ? { states: declared.states } : {}),
    label: declared?.display_name ?? humanise(key),
  };
}

/**
 * A reading for one named attribute, rather than the device's headline.
 *
 * `readingOf` answers "what is this device *for*", which is the right question
 * almost everywhere. A few devices are more than one instrument in a housing —
 * a Hue motion sensor declares `motion`, `illuminance` and `temperature`, and
 * all three are real — so a widget that has decided which attribute it wants
 * needs the same unit and label resolution without the ranking.
 *
 * Shared rather than reimplemented, because the fiddly part is not the value:
 * it is that a unit may be declared on the schema *or* published beside the
 * attribute as `<key>_unit`, and only one of those is obvious.
 */
export function readingAt(d: DeviceState, key: string): Reading | undefined {
  const value = d.attributes[key];
  if (value === undefined || value === null || typeof value === 'object') return undefined;

  const declared = d.schema?.attributes?.[key];
  const unit = unitFor(d, key, declared);

  return {
    key,
    value,
    ...(unit !== undefined ? { unit } : {}),
    ...(declared?.states !== undefined ? { states: declared.states } : {}),
    label: declared?.display_name ?? humanise(key),
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

    return r.value ? r.label : `Not ${lowerFirst(r.label)}`;
  }
  if (typeof r.value === 'number') {
    const rounded = Math.abs(r.value) >= 100 ? Math.round(r.value) : Math.round(r.value * 10) / 10;
    const unit = r.unit === undefined ? '' : r.unit === '%' ? '%' : ` ${r.unit}`;
    return `${rounded}${unit}`;
  }
  return String(r.value);
}
