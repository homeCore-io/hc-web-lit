/**
 * P2 — device queries (§5.3).
 *
 * Any field that takes a device list also takes a **query**: a live set that
 * updates as devices appear, disappear or change, rather than a hand-written
 * list that goes stale the day somebody adds a lamp. That is what
 * auto-entities exists to add to Home Assistant, and §5.1 counts it among the
 * cards that are really missing host primitives.
 *
 * **Core stores `query` as a string and defines nothing about it.** The
 * vocabulary says `{"name": "query", "type": "string", "allow_empty": true}` —
 * validated as a string and no more, so its *syntax* is a convention between
 * whoever wrote the document and whoever reads it. Same family of gap as facet
 * names (homeCore#30), and filed rather than guessed at.
 *
 * What is not guesswork is the empty case, because the working client answers
 * it on a real page: a `device_grid` with `selection_mode: "query"`, `query:
 * ""` and `limit: 12` renders "showing 12 of 119". An empty query is **no
 * predicate** — every device, then the limit — not an unanswerable question.
 *
 * Resolved client-side against the store, so it is live by construction. §5.3
 * also describes `POST /api/query` for the initial set; that endpoint is in
 * §17's list of things hc-api does not have yet, and nothing here needs it
 * while the whole house fits in the store.
 */
import type { DeviceState } from './device.js';
import { roleOf } from './facet.js';
import { effectiveArea, effectiveName, isOn, normalizeAreaName } from './present.js';

/** Comparisons an attribute test can make. */
export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'has';

export interface AttributeTest {
  key: string;
  op: Op;
  value?: unknown;
}

/** §5.3's shape, in homeCore's nouns. */
export interface DeviceQuery {
  /** `device_type`, or a `ui_hint` that overrides it. */
  deviceType?: string[];
  /** Area slugs — the same word a floorplan room binds to (§12.1). */
  area?: string[];
  namePattern?: string;
  attribute?: AttributeTest[];
  /** Derived on-ness (§1.1), never a state string. */
  on?: boolean;
  available?: boolean;
  /** What this device is for, from its own schema (§5.11). */
  role?: ('commandable' | 'readable' | 'unknown')[];
  not?: DeviceQuery;
  sort?: { by: 'name' | 'area' | 'type' | 'state'; dir?: 'asc' | 'desc' };
  limit?: number;
}

/**
 * The query a stored string means.
 *
 * Empty is every device. JSON is the structured form. Anything else is a
 * syntax nobody has defined, and this returns undefined rather than inventing
 * one — a widget selecting the wrong devices confidently is worse than one
 * selecting none and being visibly empty.
 */
export function parseQuery(raw: unknown): DeviceQuery | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object') return raw as DeviceQuery;
  if (typeof raw !== 'string') return undefined;

  const text = raw.trim();
  if (text === '') return {};
  if (!text.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as DeviceQuery) : undefined;
  } catch {
    return undefined;
  }
}

/** `ui_hint` first, because refining the type is what that field is for. */
const kindOf = (d: DeviceState): string | undefined => d.ui_hint ?? d.device_type;

function testAttribute(d: DeviceState, t: AttributeTest): boolean {
  const v = d.attributes[t.key];
  switch (t.op) {
    case 'has':
      return v !== undefined && v !== null;
    case 'eq':
      return v === t.value;
    case 'ne':
      return v !== t.value;
    default: {
      if (typeof v !== 'number' || typeof t.value !== 'number') return false;
      if (t.op === 'gt') return v > t.value;
      if (t.op === 'gte') return v >= t.value;
      if (t.op === 'lt') return v < t.value;
      return v <= t.value;
    }
  }
}

/** Whether one device answers a query. Every clause is an AND. */
export function matches(d: DeviceState, q: DeviceQuery): boolean {
  if (q.deviceType !== undefined) {
    const k = kindOf(d);
    if (k === undefined || !q.deviceType.includes(k)) return false;
  }
  if (q.area !== undefined) {
    const area = normalizeAreaName(effectiveArea(d));
    if (!q.area.map((a) => normalizeAreaName(a)).includes(area)) return false;
  }
  if (q.namePattern !== undefined) {
    // A bad pattern matches nothing rather than throwing into a render.
    try {
      if (!new RegExp(q.namePattern, 'i').test(effectiveName(d))) return false;
    } catch {
      return false;
    }
  }
  if (q.on !== undefined && isOn(d) !== q.on) return false;
  if (q.available !== undefined && d.available !== q.available) return false;
  if (q.role !== undefined && !q.role.includes(roleOf(d))) return false;
  if (q.attribute !== undefined && !q.attribute.every((t) => testAttribute(d, t))) return false;
  if (q.not !== undefined && matches(d, q.not)) return false;
  return true;
}

const compare = (d: DeviceState, by: string): string =>
  by === 'area'
    ? (effectiveArea(d) ?? '')
    : by === 'type'
      ? (kindOf(d) ?? '')
      : by === 'state'
        ? String(isOn(d))
        : effectiveName(d);

/**
 * Resolve a query to a live set.
 *
 * `total` is what matched before the limit, because a widget showing twelve of
 * a hundred and nineteen should be able to say so — the working client does,
 * and a list that silently stops is a list somebody mistrusts.
 */
export function runQuery(
  q: DeviceQuery,
  devices: readonly DeviceState[],
): { devices: DeviceState[]; total: number } {
  const hit = devices.filter((d) => matches(d, q));

  const by = q.sort?.by ?? 'name';
  const dir = q.sort?.dir === 'desc' ? -1 : 1;
  hit.sort((a, b) => compare(a, by).localeCompare(compare(b, by)) * dir);

  const total = hit.length;
  return { devices: q.limit !== undefined ? hit.slice(0, q.limit) : hit, total };
}
