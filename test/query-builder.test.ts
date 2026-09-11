/**
 * Building a device query, rather than typing its JSON (§5.3).
 *
 * Core stores `query` as a string and defines nothing about its syntax, so the
 * only way to author one was to hand-edit JSON in a text box — the one thing
 * §4.4 rules out.
 */
import { describe, expect, it } from 'vitest';
import '../src/widgets/hc-property-panel.js';
import type { HcPropertyPanel } from '../src/widgets/hc-property-panel.js';
import type { DeviceState } from '../src/core/device.js';
import { parseQuery, runQuery } from '../src/core/query.js';
import fixture from './fixtures/vocabulary.json' with { type: 'json' };
import { readVocabulary, type Vocabulary } from '../src/core/vocabulary.js';

const device = (over: Partial<DeviceState> & { device_id: string }): DeviceState => ({
  name: over.device_id,
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-11T00:00:00Z',
  ...over,
});

const house: DeviceState[] = [
  device({
    device_id: 'a',
    name: 'Kitchen Lamp',
    area: 'kitchen',
    device_type: 'light',
    attributes: { on: true },
  }),
  device({
    device_id: 'b',
    name: 'Kitchen Fan',
    area: 'kitchen',
    device_type: 'fan',
    attributes: { on: false },
  }),
  device({
    device_id: 'c',
    name: 'Hall Lamp',
    area: 'hall',
    device_type: 'light',
    attributes: { on: false },
  }),
  device({
    device_id: 'd',
    name: 'Gone',
    area: 'hall',
    device_type: 'light',
    available: false,
    attributes: { on: false },
  }),
];

async function panel(query: unknown): Promise<{ el: HcPropertyPanel; written: () => unknown }> {
  const el = document.createElement('hc-property-panel');
  el.config = {
    widget: { type: 'device_grid', config: { selection_mode: 'query', query } },
    edits: 'w',
  };
  el.devices = house;
  // The real table, because `query` declares `allow_empty` there — and whether
  // an emptied field keeps its key or loses it is decided by that.
  el.vocabulary = readVocabulary(fixture) as Vocabulary;
  document.body.append(el);
  await el.updateComplete;

  let last: unknown;
  el.onEditWidget = (next) => {
    last = (next.config as Record<string, unknown>)['query'];
  };
  return { el, written: () => last };
}

const chip = (el: HcPropertyPanel, label: string): HTMLInputElement | undefined =>
  [...(el.shadowRoot?.querySelectorAll('.chip') ?? [])]
    .find((c) => (c.textContent ?? '').trim() === label)
    ?.querySelector('input') as HTMLInputElement | undefined;

const count = (el: HcPropertyPanel): string =>
  [...(el.shadowRoot?.querySelectorAll('.resolved') ?? [])]
    .map((s) => s.textContent ?? '')
    .find((t) => t.includes('Matches')) ?? '';

describe('the query builder', () => {
  it('replaces the box somebody would have typed JSON into', async () => {
    const { el } = await panel('');
    expect(el.shadowRoot?.querySelector('.query')).not.toBeNull();
  });

  it('offers the rooms and kinds the house actually has', async () => {
    const { el } = await panel('');
    expect(chip(el, 'Kitchen')).toBeDefined();
    expect(chip(el, 'Hall')).toBeDefined();
    expect(chip(el, 'Light')).toBeDefined();
    expect(chip(el, 'Fan')).toBeDefined();
  });

  it('says what the query matches right now, before it is saved', async () => {
    // A query is a claim about the house, and the house is right there.
    const { el } = await panel('');
    expect(count(el)).toContain('Matches 4 of 4');
  });

  it('writes a room as the query language spells it', async () => {
    const { el, written } = await panel('');
    chip(el, 'Kitchen')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(parseQuery(written())).toEqual({ area: ['kitchen'] });
  });

  it('narrows the count as clauses are added', async () => {
    const { el } = await panel(JSON.stringify({ area: ['kitchen'] }));
    expect(count(el)).toContain('Matches 2 of 4');
  });

  it('goes back to no predicate when the last clause is cleared', async () => {
    // **An empty query and an absent one are not the same thing.** Absent
    // parses to undefined and selects nothing; empty is no predicate and
    // selects the whole house. The panel's ordinary rule drops an optional
    // field set to an empty string, so clearing the last clause here would
    // have emptied the card rather than opening it up.
    const { el, written } = await panel(JSON.stringify({ area: ['kitchen'] }));
    chip(el, 'Kitchen')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(written()).toBe('');
    expect(parseQuery(written())).toEqual({});
    expect(runQuery(parseQuery(written())!, house).devices).toHaveLength(4);
  });

  it('writes on-ness as the derived truth, not a state string', async () => {
    const { el, written } = await panel('');
    const state = [...(el.shadowRoot?.querySelectorAll('select') ?? [])].find(
      (s) => s.getAttribute('aria-label') === 'State',
    ) as HTMLSelectElement;
    state.value = 'true';
    state.dispatchEvent(new Event('change', { bubbles: true }));
    expect(parseQuery(written())).toEqual({ on: true });
  });

  it('keeps a clause it does not offer, rather than deleting it', async () => {
    // `attribute` and `not` are real parts of the language. A builder that
    // dropped them would quietly delete the interesting half of somebody's
    // query the first time they changed a room.
    const original = {
      area: ['hall'],
      attribute: [{ key: 'brightness_pct', op: 'gt', value: 50 }],
      not: { deviceType: ['fan'] },
      sort: { by: 'name' },
    };
    const { el, written } = await panel(JSON.stringify(original));
    chip(el, 'Kitchen')!.dispatchEvent(new Event('change', { bubbles: true }));

    const after = parseQuery(written()) as Record<string, unknown>;
    expect(after['attribute']).toEqual(original.attribute);
    expect(after['not']).toEqual(original.not);
    expect(after['sort']).toEqual(original.sort);
    expect(after['area']).toEqual(['hall', 'kitchen']);
  });

  it('says which clauses it is keeping as they are', async () => {
    const { el } = await panel(JSON.stringify({ not: { deviceType: ['fan'] } }));
    expect(el.shadowRoot?.textContent).toContain('Kept as it is');
    expect(el.shadowRoot?.textContent).toContain('not');
  });

  it('counts before the limit, so the number is honest', async () => {
    // A query that matches four and shows one has done both things.
    const { el } = await panel(JSON.stringify({ limit: 1 }));
    expect(count(el)).toContain('Matches 4 of 4');
  });

  it('builds what the widget will actually select', async () => {
    // The preview is worth nothing unless it is the same evaluation the card
    // does, so this pins the two together.
    const { el, written } = await panel('');
    chip(el, 'Light')!.dispatchEvent(new Event('change', { bubbles: true }));
    const built = parseQuery(written())!;
    // Sorted by name: Gone, Hall Lamp, Kitchen Lamp.
    expect(runQuery(built, house).devices.map((d) => d.device_id)).toEqual(['d', 'c', 'a']);
  });
});
