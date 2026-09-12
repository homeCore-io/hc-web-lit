/**
 * What is worth knowing about the house right now.
 *
 * `worth_knowing` declares `watch` — which kinds of thing to notice —
 * `low_battery` (the threshold), `faults_only`, `limit` and `area_name`. This
 * is the derivation behind it.
 *
 * **A notice is a fact plus a reason to care.** "Battery 12%" is a reading; "Hall
 * Lock, battery 12%" on a list titled *worth knowing* is a notice, and the
 * difference is that somebody chose the threshold. Nothing here invents
 * urgency: every kind below is either a declared attribute crossing a declared
 * line, or a device the house says it cannot reach.
 */
import type { DeviceState } from './device.js';
import { isHousekeeping } from './facet.js';
import { effectiveArea, effectiveName, normalizeAreaName } from './present.js';

/** The kinds `watch` can name. */
export type Watch = 'batteries' | 'water' | 'locks' | 'offline' | 'faults' | 'open';

export interface Notice {
  deviceId: string;
  name: string;
  area: string | undefined;
  kind: Watch;
  detail: string;
  /** Higher sorts first. A wet floor outranks a tired battery. */
  weight: number;
}

export interface AttentionConfig {
  watch?: string[];
  limit?: number;
  area_name?: string;
  /** Percent below which a battery is worth mentioning. */
  low_battery?: number;
  faults_only?: boolean;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/**
 * Whether a battery needs attention, in the order the device can be trusted.
 *
 * **A device that says `battery_low` has already answered.** That boolean needs
 * no threshold and holds whatever scale the hardware uses, which matters more
 * than it sounds: Ecowitt sensors publish `battery` as 0/1 on a WH31
 * (`battery_kind: "binary"`, where 1 means *low*) and 0–5 on a lightning
 * detector (`battery_kind: "level"`, where higher is better) — and the plugin
 * declares `unit: "%"` for both. Read as a percentage, a healthy detector
 * reporting 2 becomes "battery 2%" and a false alarm; read as `battery_low`, it
 * is fine and says so. Filed as a plugin bug; correct here regardless, because
 * the boolean is the better source even when the unit is right.
 *
 * A percentage is the fallback, for devices that report a level and no verdict.
 */
function batteryConcern(d: DeviceState, threshold: number): string | undefined {
  const low = bool(d.attributes['battery_low']);
  if (low !== undefined) return low ? 'battery low' : undefined;

  const level = num(d.attributes['battery_pct']) ?? num(d.attributes['battery']);
  if (level === undefined) return undefined;
  // Zero on a device that is plainly alive is a plugin that has not learned to
  // read the cell, not a dead one. Saying "0%" about a working sensor is worse
  // than saying nothing.
  if (level <= 0 || level > threshold) return undefined;
  return `battery ${Math.round(level)}%`;
}

const CHECKS: Record<Watch, (d: DeviceState, cfg: AttentionConfig) => Notice | undefined> = {
  batteries: (d, cfg) => {
    const detail = batteryConcern(d, cfg.low_battery ?? 20);
    if (detail === undefined) return undefined;
    // A percentage sorts by how low it is; a bare "low" sits with the worst of
    // them, because the device declined to say more and that is not a reason to
    // rank it below one that did.
    const level = num(d.attributes['battery_pct']) ?? num(d.attributes['battery']);
    return notice(
      d,
      'batteries',
      detail,
      level !== undefined && detail.endsWith('%') ? 100 - level : 95,
    );
  },

  water: (d) =>
    bool(d.attributes['water_detected']) === true || bool(d.attributes['water']) === true
      ? notice(d, 'water', 'water detected', 1000)
      : undefined,

  locks: (d) =>
    bool(d.attributes['locked']) === false ? notice(d, 'locks', 'unlocked', 500) : undefined,

  open: (d) => (bool(d.attributes['open']) === true ? notice(d, 'open', 'open', 300) : undefined),

  offline: (d) => (d.available ? undefined : notice(d, 'offline', 'offline', 400)),

  faults: (d) => {
    // A fault is whatever the device itself calls one. Nothing here decides
    // what counts — a plugin that reports `fault: true` or an `error` string
    // is making the claim.
    if (bool(d.attributes['fault']) === true) return notice(d, 'faults', 'fault', 600);
    const err = d.attributes['error'];
    return typeof err === 'string' && err !== '' ? notice(d, 'faults', err, 600) : undefined;
  },
};

function notice(d: DeviceState, kind: Watch, detail: string, weight: number): Notice {
  return {
    deviceId: d.device_id,
    name: effectiveName(d),
    area: effectiveArea(d),
    kind,
    detail,
    weight,
  };
}

/** How loudly one device is asking to be looked at. */
export type Severity = 'critical' | 'warn' | 'offline';

/**
 * The severity of one device's own state, for a row to draw it with.
 *
 * **The house already knew, and the rows did not show it.** `worth_knowing`
 * derives exactly this and puts it in a panel; meanwhile a wet leak sensor
 * drew "Wet" in the same grey as "Dry", with the same grey droplet beside it,
 * because the generic row is what draws a water sensor and the generic row had
 * no notion of severity. The single most important state in a house was
 * indistinguishable from the good case at a glance.
 *
 * Same checks, so there is one definition of what is worth noticing and no
 * second opinion to drift from it. Nothing here invents urgency either: every
 * kind is a declared attribute or a device the house says it cannot reach.
 *
 * **Batteries are left out on purpose.** A battery needs a threshold somebody
 * chose, which is a `worth_knowing` configuration rather than a property of
 * the device — and a page of sensors each a shade of amber because one is at
 * 19% is a page where the colour has stopped meaning anything.
 */
export function severityOf(d: DeviceState): Severity | undefined {
  let worst: Notice | undefined;
  for (const kind of ['water', 'faults', 'locks', 'offline', 'open'] as Watch[]) {
    const found = CHECKS[kind](d, {});
    if (found !== undefined && (worst === undefined || found.weight > worst.weight)) worst = found;
  }
  if (worst === undefined) return undefined;
  if (worst.kind === 'offline') return 'offline';
  // Water and a declared fault are the two the house cannot wait on; a lock
  // left open and a door left open are worth seeing, not worth alarming about.
  return worst.weight >= 600 ? 'critical' : 'warn';
}

/** Every `watch` name this client understands. */
export function knownWatches(): Watch[] {
  return Object.keys(CHECKS) as Watch[];
}

/**
 * The notices, most urgent first.
 *
 * An empty result is the good case and the widget should say so — a list that
 * renders nothing looks broken, and "nothing worth knowing" is the single most
 * reassuring thing a house dashboard can say.
 */
export function noticesFor(
  config: AttentionConfig,
  devices: readonly DeviceState[],
  room?: string,
): Notice[] {
  const watch = (config.watch ?? ['batteries', 'water', 'locks', 'offline']).filter(
    (w): w is Watch => w in CHECKS,
  );

  const named = config.area_name === '@room' ? room : config.area_name;
  // An unresolved room shows nothing rather than the whole house, for the same
  // reason a selection does (§14.1).
  if (config.area_name !== undefined && named === undefined) return [];
  const want = normalizeAreaName(named);

  const out: Notice[] = [];
  for (const d of devices) {
    if (want !== '' && normalizeAreaName(effectiveArea(d)) !== want) continue;
    for (const kind of watch) {
      if (config.faults_only === true && kind !== 'faults') continue;
      const n = CHECKS[kind](d, config);
      // One notice per device: the most urgent thing about it is the thing to
      // say. A lock that is unlocked *and* low on battery is a lock that is
      // unlocked.
      if (n !== undefined) {
        out.push(n);
        break;
      }
    }
  }

  out.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  return config.limit !== undefined && config.limit > 0 ? out.slice(0, config.limit) : out;
}

/** Re-exported so a widget asks one module. */
export { isHousekeeping };
