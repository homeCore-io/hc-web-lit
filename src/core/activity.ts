/**
 * What just happened — the derivation behind `event_feed`.
 *
 * `GET /events` returns the log newest-first: `{seq, event_type, device_id,
 * event}`, where `event` is the typed payload. Core's vocabulary lets the
 * widget narrow by `types`, `device_ids`, `area_name` and `group_by`.
 *
 * **Most of the log is not news.** Of 300 consecutive events on the reference
 * house, 158 are one Roku republishing `device_info` — a field that ticks
 * because it contains a clock — and many of the rest are the same reading
 * arriving five ways at once (`temperature`, `temperature_f`, `temperature_c`,
 * `temperature_valid`, `temperature_unit`). A feed that prints all of it is a
 * feed nobody reads, so this decides what counts as news, and says how.
 */
import type { AttributeSchema } from './api.js';
import type { DeviceState } from './device.js';
import { isHousekeeping } from './facet.js';
import { effectiveArea, effectiveName, normalizeAreaName } from './present.js';
import { words } from './text.js';

export interface LogEntry {
  seq: number;
  event_type: string;
  device_id?: string;
  event?: Record<string, unknown>;
}

export interface Activity {
  seq: number;
  at: string | undefined;
  kind: string;
  /** The device's name, or its id when the house no longer has it. */
  who: string;
  area: string | undefined;
  /** What happened, in as few words as it takes. */
  what: string;
}

export interface ActivityConfig {
  limit?: number;
  types?: string[];
  device_ids?: string[];
  area_name?: string;
}

/**
 * Attributes that change constantly and mean nothing to a person.
 *
 * Beyond `isHousekeeping`, which is about what a *card* leads with. This is
 * about what is worth waking somebody for, and the two differ: a battery
 * percentage belongs on a card's detail line and never in a feed.
 */
const NOT_NEWS = new Set([
  'device_info',
  'available_apps',
  'ui_enrichments',
  'supported_actions',
  'media_position',
  'position_secs',
  'last_seen',
  'seq',
  'arch',
  'ip',
  'mac',
  'datetime',
  'device_time',
  'connectivity_status',
]);

/**
 * How many changed readings a feed line names before it says "and more".
 *
 * **A cap on the line, not a verdict on the event.** The first version of this
 * dropped an event past a threshold as "a device dumping its state", which was
 * measured and wrong: across 300 consecutive events on the reference house,
 * once the name rules above have run, exactly one exceeds five readings — and
 * it is the weather station honestly reporting thirteen measurements at once.
 * Relabelling that as noise would have been the only case the rule ever fired
 * on, and it would have been wrong.
 *
 * The genuine dumps — a WLED republishing wifi signal, led count, uptime and
 * architecture — are already gone, dropped by name rather than by count.
 */
const NAMED_IN_A_LINE = 4;

/**
 * Readings that are the same reading.
 *
 * A Hue motion sensor publishes `temperature`, `temperature_f`,
 * `temperature_c`, `temperature_valid` and `temperature_unit` in one change.
 * Listing five is listing one thing five times, so a suffix collapses onto its
 * stem and the stem is what gets reported.
 */
function stem(key: string): string {
  return key.replace(/_(f|c|k|lux|raw|pct|valid|unit|state|kind)$/, '');
}

function isNews(key: string, declared?: AttributeSchema): boolean {
  if (NOT_NEWS.has(key)) return false;
  if (isHousekeeping(key, declared)) return false;
  // A dotted name is a nested subsystem reporting on itself — `wifi.rssi`,
  // `led.count`, `peers.count`. A person cares that the strip changed colour,
  // not that its Wi-Fi channel is still 6.
  if (key.includes('.')) return false;
  // Anything counted or measured about the device rather than the world.
  if (/^(uptime|free_heap|peers|presets|palettes|effects)/.test(key)) return false;
  // A `_valid` or `_unit` sibling is metadata about a reading, not the reading.
  return !/_(valid|unit|raw|kind|state|secs|ms)$/.test(key);
}

/**
 * The attributes worth naming in one state change, deduplicated by stem.
 *
 * `declared` is the device's own schema, and it is what does the work now that
 * plugins set `AttributeCategory` (homeCore#29): 296 attributes in the
 * reference house carry one, so a battery or an RSSI is kept out of the feed
 * because the plugin said what it was, not because this client recognised its
 * name. The name lists below are the floor for what nothing declares.
 */
export function newsIn(
  changed: readonly string[],
  declared?: Record<string, AttributeSchema>,
): string[] {
  const stems = new Map<string, string>();
  for (const key of changed) {
    if (!isNews(key, declared?.[key])) continue;
    const s = stem(key);
    // Prefer the bare stem when it is present; it is the canonical spelling.
    if (!stems.has(s) || key === s) stems.set(s, key);
  }
  return [...stems.values()];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function describe(entry: LogEntry, keys: readonly string[]): string {
  const e = entry.event ?? {};
  const current = (e['current'] ?? {}) as Record<string, unknown>;

  switch (entry.event_type) {
    case 'device_state_changed': {
      // Name the value where there is one worth saying, so a feed reads
      // "Office Motion — motion" rather than "Office Motion changed", and stop
      // at a readable number rather than truncating mid-word.
      const shown = keys.slice(0, NAMED_IN_A_LINE);
      const rest = keys.length - shown.length;
      const said = shown
        .map((k) => {
          const v = current[k];
          if (typeof v === 'boolean') return v ? words(k) : `no ${words(k)}`;
          if (typeof v === 'number') return `${words(k)} ${Math.round(v * 10) / 10}`;
          if (typeof v === 'string' && v !== '') return `${words(k)} ${v}`;
          return words(k);
        })
        .join(', ');
      return rest > 0 ? `${said}, and ${rest} more` : said;
    }
    case 'device_availability_changed':
      return e['available'] === true ? 'came back' : 'went offline';
    case 'device_command_sent':
      return 'commanded';
    case 'rule_fired':
      return `rule ${str(e['rule_name']) ?? str(e['rule_id']) ?? 'fired'}`;
    case 'scene_activated':
      return `scene ${str(e['scene_name']) ?? str(e['scene_id']) ?? 'activated'}`;
    case 'timer_state_changed':
      return `timer ${str(e['state']) ?? 'changed'}`;
    default:
      return words(entry.event_type);
  }
}

/**
 * The feed, newest first, with the noise taken out.
 *
 * An entry whose only changes were housekeeping is dropped entirely rather than
 * printed as "changed" — a line that says a thing happened without saying what
 * is worse than no line, because it costs a reader the same attention.
 */
export function activityFrom(
  config: ActivityConfig,
  entries: readonly LogEntry[],
  devices: readonly DeviceState[],
  room?: string,
): Activity[] {
  const byId = new Map(devices.map((d) => [d.device_id, d]));

  const named = config.area_name === '@room' ? room : config.area_name;
  if (config.area_name !== undefined && named === undefined) return [];
  const want = normalizeAreaName(named);

  const wantTypes = new Set(config.types ?? []);
  const wantDevices = new Set(config.device_ids ?? []);

  const out: Activity[] = [];
  for (const entry of entries) {
    if (wantTypes.size > 0 && !wantTypes.has(entry.event_type)) continue;
    if (
      wantDevices.size > 0 &&
      (entry.device_id === undefined || !wantDevices.has(entry.device_id))
    )
      continue;

    const device = entry.device_id !== undefined ? byId.get(entry.device_id) : undefined;
    if (want !== '' && normalizeAreaName(device && effectiveArea(device)) !== want) continue;

    let keys: string[] = [];
    if (entry.event_type === 'device_state_changed') {
      const changed = (entry.event?.['changed'] ?? []) as string[];
      keys = newsIn(Array.isArray(changed) ? changed : [], device?.schema?.attributes ?? undefined);
      if (keys.length === 0) continue;
    }

    const change = entry.event?.['change'] as { changed_at?: string } | undefined;

    out.push({
      seq: entry.seq,
      at: change?.changed_at ?? str(entry.event?.['timestamp']),
      kind: entry.event_type,
      who: device !== undefined ? effectiveName(device) : (entry.device_id ?? 'the house'),
      area: device !== undefined ? effectiveArea(device) : undefined,
      what: describe(entry, keys),
    });
  }

  return config.limit !== undefined && config.limit > 0 ? out.slice(0, config.limit) : out;
}
