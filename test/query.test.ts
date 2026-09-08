/**
 * P2 — device queries (§5.3).
 *
 * The cases worth pinning are the ones a document actually produces and the
 * ones a mistake produces: an empty query, an unparseable one, and the
 * derived-not-declared clauses that would be wrong if a query re-derived them.
 */
import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { matches, parseQuery, runQuery } from '../src/core/query.js';
import { selectDevices } from '../src/core/selection.js';

const dev = (over: Partial<DeviceState> & { device_id: string }): DeviceState => ({
  name: over.device_id,
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-08T00:00:00Z',
  ...over,
});

const house: DeviceState[] = [
  dev({
    device_id: 'lamp',
    name: 'Desk Lamp',
    device_type: 'light',
    area: 'office',
    attributes: { on: true, brightness_pct: 40 },
    schema: { attributes: { on: { kind: 'bool', writable: true } } },
  }),
  dev({
    device_id: 'ceiling',
    name: 'Ceiling Light',
    device_type: 'light',
    area: 'kitchen',
    attributes: { on: false },
    schema: { attributes: { on: { kind: 'bool', writable: true } } },
  }),
  dev({
    device_id: 'therm',
    name: 'Office Temp',
    device_type: 'temperature_sensor',
    area: 'office',
    attributes: { temperature: 21.5 },
    schema: { attributes: { temperature: { kind: 'float' } } },
  }),
  dev({ device_id: 'gone', name: 'Old Plug', device_type: 'switch', available: false }),
];

describe('what a stored query string means', () => {
  it('is every device when it is empty', () => {
    // Settled by the working client, not guessed: a device_grid with
    // `query: ""` and `limit: 12` renders "showing 12 of 119".
    expect(parseQuery('')).toEqual({});
    expect(runQuery({}, house).devices).toHaveLength(4);
  });

  it('is the structured form when it is JSON', () => {
    expect(parseQuery('{"deviceType":["light"]}')).toEqual({ deviceType: ['light'] });
  });

  it('is nothing when it is a syntax nobody defined', () => {
    // Core validates that it is a string and no more (homeCore#35). Selecting
    // the wrong devices confidently is worse than selecting none visibly.
    expect(parseQuery('area:kitchen type:light')).toBeUndefined();
    expect(parseQuery('{ not json')).toBeUndefined();
  });
});

describe('matching', () => {
  it('reads on-ness from the primitive, not from an attribute', () => {
    // A query that tested `attributes.on` would be right for a lamp and wrong
    // for a lock, a scene and everything else (§1.1).
    expect(runQuery({ on: true }, house).devices.map((d) => d.device_id)).toEqual(['lamp']);
  });

  it('lets ui_hint override the type, because that is what it is for', () => {
    const hinted = dev({ device_id: 'sw', device_type: 'switch', ui_hint: 'light' });
    expect(matches(hinted, { deviceType: ['light'] })).toBe(true);
    expect(matches(hinted, { deviceType: ['switch'] })).toBe(false);
  });

  it('normalises an area the way the rest of the client does', () => {
    expect(runQuery({ area: ['Office'] }, house).devices).toHaveLength(2);
  });

  it('selects by what a device is for, from its schema', () => {
    expect(runQuery({ role: ['readable'] }, house).devices.map((d) => d.device_id)).toEqual([
      'therm',
    ]);
  });

  it('compares numbers, and refuses to compare what is not one', () => {
    expect(
      runQuery({ attribute: [{ key: 'brightness_pct', op: 'gt', value: 30 }] }, house).devices,
    ).toHaveLength(1);
    expect(
      runQuery({ attribute: [{ key: 'name', op: 'gt', value: 30 }] }, house).devices,
    ).toHaveLength(0);
  });

  it('subtracts a nested query', () => {
    const q = { deviceType: ['light'], not: { on: true } };
    expect(runQuery(q, house).devices.map((d) => d.device_id)).toEqual(['ceiling']);
  });

  it('matches nothing on a bad pattern rather than throwing into a render', () => {
    expect(runQuery({ namePattern: '([' }, house).devices).toHaveLength(0);
  });
});

describe('the shape of a resolved set', () => {
  it('says how many matched before the limit', () => {
    // A list that silently stops is a list somebody mistrusts.
    const got = runQuery({ limit: 2 }, house);
    expect(got.devices).toHaveLength(2);
    expect(got.total).toBe(4);
  });

  it('sorts by name unless told otherwise', () => {
    expect(runQuery({ deviceType: ['light'] }, house).devices.map((d) => d.name)).toEqual([
      'Ceiling Light',
      'Desk Lamp',
    ]);
    expect(
      runQuery({ deviceType: ['light'], sort: { by: 'name', dir: 'desc' } }, house).devices.map(
        (d) => d.name,
      ),
    ).toEqual(['Desk Lamp', 'Ceiling Light']);
  });
});

describe('query mode at the selection seam', () => {
  it('draws the whole house for the empty query the documents carry', () => {
    // Two real placements are `selection_mode: "query"` with `query: ""`, and
    // they rendered nothing until this existed.
    const got = selectDevices({ selection_mode: 'query', query: '', limit: 3 }, house, {});
    expect(got).toHaveLength(3);
  });

  it('still shows nothing for a query it cannot read', () => {
    expect(selectDevices({ selection_mode: 'query', query: 'lights on' }, house, {})).toHaveLength(
      0,
    );
  });
});
