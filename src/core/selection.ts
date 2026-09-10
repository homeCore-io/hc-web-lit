/**
 * Which devices a widget shows — `selection_mode` and friends.
 *
 * The vocabulary is core's, served at `GET /dashboards/vocabulary` and enforced
 * by its validator: `selection_mode` is one of `manual | area | query | facet`,
 * and the fields each mode reads are declared alongside it. This implements
 * that table; it does not invent one.
 *
 * **Facet names are the exception, and they are a gap.** Core validates that
 * `facet` is a string and says nothing about *which* strings — so `"lights"`
 * and `"doors_windows"` are names a document references and nothing defines.
 * Two clients that group differently show different devices for the same saved
 * page, which is the failure `dashboard_vocabulary` exists to prevent. The
 * membership tests below read declared data (`device_type`, `ui_hint`) rather
 * than guessing, but the *names* remain a convention.
 */
import { isScene } from './capability.js';
import type { DeviceState } from './device.js';
import { parseQuery, runQuery } from './query.js';
import { effectiveArea, effectiveName, isOn, normalizeAreaName } from './present.js';

export interface SelectionConfig {
  selection_mode?: string;
  device_ids?: string[];
  area_name?: string;
  facet?: string | string[];
  except?: string[];
  query?: string;
  /** Hand-made adjustments on top of whichever mode chose the set. */
  add?: string[];
  remove?: string[];
  order?: string[];
  sort?: string;
  limit?: number;
  show_offline?: boolean;
}

/** What `@room` and `@picked` resolve to, supplied at the placement seam. */
export interface SelectionContext {
  room?: string;
  picked?: string;
}

/**
 * A facet's membership test, over declared data only.
 *
 * `ui_hint` is consulted first everywhere, because that is the field's purpose:
 * a switch a person hinted as a light *is* a light, and a facet that ignored
 * the hint would make the override cosmetic (§1.1).
 */
const FACETS: Record<string, (d: DeviceState) => boolean> = {
  lights: (d) => hint(d) === 'light' || (d.ui_hint === undefined && d.device_type === 'light'),
  switches: (d) => hint(d) === 'switch',
  outlets: (d) => hint(d) === 'outlet',
  fans: (d) => hint(d) === 'fan',
  media: (d) => hint(d) === 'media_player',
  locks: (d) => hint(d) === 'lock',
  scenes: (d) => hint(d) === 'scene',
  covers: (d) => hint(d) === 'cover',
  climate: (d) => hint(d) === 'thermostat' || hint(d) === 'temperature_sensor',
  sensors: (d) => (d.device_type ?? '').endsWith('_sensor'),
  doors_windows: (d) =>
    ['door', 'window', 'garage', 'gate'].includes(d.ui_hint ?? '') ||
    d.device_type === 'contact_sensor',
  power: (d) => 'power' in d.attributes || 'energy' in d.attributes || 'watts' in d.attributes,
};

const hint = (d: DeviceState): string => d.ui_hint ?? d.device_type ?? '';

/** The facet names this client understands. Exported so a test can pin them. */
export function knownFacets(): string[] {
  return Object.keys(FACETS).sort();
}

function matchesFacet(d: DeviceState, facets: readonly string[]): boolean {
  return facets.some((f) => FACETS[f]?.(d) ?? false);
}

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** `@room` / `@picked` resolved against the placement's context. */
export function resolveToken(value: string | undefined, ctx: SelectionContext): string | undefined {
  if (value === '@room') return ctx.room;
  if (value === '@picked') return ctx.picked;
  return value;
}

/**
 * The devices a widget should show, in the order it should show them.
 *
 * The base filter excludes scenes and system glue *unless* they were asked for
 * by hand or carry a room — a timer or a virtual switch with an area assignment
 * is something a person put in a room on purpose, and hiding it there is the
 * bug users report.
 */
export function selectDevices(
  config: SelectionConfig,
  devices: readonly DeviceState[],
  ctx: SelectionContext = {},
): DeviceState[] {
  const mode = config.selection_mode ?? 'manual';
  const byHand = new Set(config.device_ids ?? []);

  let chosen: DeviceState[];

  switch (mode) {
    case 'manual': {
      // Manual keeps the document's order — somebody chose it.
      const byId = new Map(devices.map((d) => [d.device_id, d]));
      chosen = (config.device_ids ?? []).flatMap((id) => {
        const d = byId.get(id);
        return d === undefined ? [] : [d];
      });
      break;
    }

    case 'area': {
      const named = resolveToken(config.area_name, ctx);
      // An unresolved `@room` is not "the devices with no area" — it is a page
      // that does not yet know which room it is. Matching the empty area would
      // fill a room page with every unassigned device in the house, which
      // looks like an answer and is not one. Same reasoning as `query` below.
      if (config.area_name !== undefined && named === undefined) {
        chosen = [];
        break;
      }
      const want = normalizeAreaName(named);
      chosen = devices.filter((d) => normalizeAreaName(effectiveArea(d)) === want);
      break;
    }

    case 'facet': {
      const facets = asList(config.facet);
      const named = resolveToken(config.area_name, ctx);
      if (config.area_name !== undefined && named === undefined) {
        chosen = [];
        break;
      }
      const want = normalizeAreaName(named);
      chosen = devices.filter(
        (d) =>
          matchesFacet(d, facets) &&
          // A facet may be scoped to a room as well; an absent area_name means
          // the whole house.
          (want === '' || normalizeAreaName(effectiveArea(d)) === want),
      );
      break;
    }

    case 'query': {
      // P2 (§5.3). Core stores `query` as a string and defines no syntax for
      // it, so an unparseable one selects nothing: a widget showing the wrong
      // devices confidently is worse than one showing none and being visibly
      // empty. An *empty* string is not that case — it is no predicate at all,
      // which the working client settles by rendering "showing 12 of 119" for
      // exactly this config.
      const q = parseQuery(config.query);
      chosen = q === undefined ? [] : runQuery(q, devices).devices;
      break;
    }

    default:
      chosen = [];
  }

  // `except` subtracts facets from whatever the mode chose.
  const except = config.except ?? [];
  if (except.length > 0) chosen = chosen.filter((d) => !matchesFacet(d, except));

  chosen = chosen.filter((d) => keepable(d, byHand));

  if (config.show_offline === false) chosen = chosen.filter((d) => d.available);

  // Hand adjustments ride on top of the mode's answer, so a query stays live
  // and a person can still pin one device into it or take one out.
  const removed = new Set(config.remove ?? []);
  if (removed.size > 0) chosen = chosen.filter((d) => !removed.has(d.device_id));

  const have = new Set(chosen.map((d) => d.device_id));
  for (const id of config.add ?? []) {
    if (have.has(id)) continue;
    const d = devices.find((x) => x.device_id === id);
    if (d !== undefined) chosen.push(d);
  }

  chosen = applyOrder(chosen, config.order, config.sort, config.area_name, ctx);

  return config.limit !== undefined && config.limit > 0 ? chosen.slice(0, config.limit) : chosen;
}

/**
 * Whether a device belongs in an ordinary list at all.
 *
 * Scenes are not devices in a device list. System glue — timers, virtual
 * switches — is hidden by default *and shown when it has a room*, because a
 * person who assigned one to the garage put it there on purpose and its absence
 * is the bug they report.
 */
function keepable(d: DeviceState, byHand: ReadonlySet<string>): boolean {
  if (byHand.has(d.device_id)) return true;
  // Declared rather than named: every scene in the reference house declares
  // `activate` and nothing else does (§ capability.ts).
  if (isScene(d)) return false;
  return true;
}

/** An explicit order first, then a sort, then the order they arrived in. */
function applyOrder(
  devices: DeviceState[],
  order: string[] | undefined,
  sort: string | undefined,
  areaName: string | undefined,
  ctx: SelectionContext,
): DeviceState[] {
  if (order !== undefined && order.length > 0) {
    const rank = new Map(order.map((id, i) => [id, i]));
    // Anything not named keeps its place after everything that was.
    return [...devices].sort(
      (a, b) =>
        (rank.get(a.device_id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.device_id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  if (sort === undefined) return devices;

  const room = normalizeAreaName(resolveToken(areaName, ctx));
  const label = (d: DeviceState): string => labelInRoom(d, room);

  const out = [...devices];
  switch (sort) {
    case 'name':
      // By the label actually drawn, not by the raw name. Sorting on something
      // the page does not show puts "Garage Lamp" before "Ceiling" on the
      // garage page, which reads as no sort at all.
      out.sort((a, b) => label(a).localeCompare(label(b)));
      break;
    case 'room':
      out.sort(
        (a, b) =>
          (effectiveArea(a) ?? '').localeCompare(effectiveArea(b) ?? '') ||
          label(a).localeCompare(label(b)),
      );
      break;
    case 'kind':
      out.sort(
        (a, b) =>
          (a.device_type ?? '').localeCompare(b.device_type ?? '') ||
          label(a).localeCompare(label(b)),
      );
      break;
    case 'on':
      out.sort(
        (a, b) =>
          Number(isOn(b) === true) - Number(isOn(a) === true) || label(a).localeCompare(label(b)),
      );
      break;
  }
  return out;
}

/**
 * The name to show inside a room, with the room's own name stripped.
 *
 * On the garage page every device is called "Garage something", and repeating
 * the room in every row is noise that also breaks an alphabetical sort into
 * one bucket.
 */
export function labelInRoom(d: DeviceState, room: string): string {
  const name = effectiveName(d);
  if (room === '') return name;
  const words = room.split('_').filter((w) => w.length > 0);
  const prefix = words.join(' ');
  const lowered = name.toLowerCase();
  if (prefix !== '' && lowered.startsWith(`${prefix} `)) {
    return name.slice(prefix.length + 1);
  }
  return name;
}
