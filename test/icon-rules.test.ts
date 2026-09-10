/**
 * The icon rules editor — §11.2's "ordered name-pattern regexes → icon, with a
 * live test field and one-click reset".
 *
 * The correction that scales. A hint fixes one device; the reference house has
 * eight contact sensors all named "… Door Sensor" and not one sets a hint,
 * because setting eight is a chore nobody does.
 */
import { describe, expect, it, vi } from 'vitest';
import '../src/widgets/hc-icon-rules.js';
import { setIconRules, type IconRule } from '../src/design/icons.js';
import type { DeviceState } from '../src/core/device.js';

const device = (name: string, over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: name.toLowerCase().replace(/\W+/g, '_'),
  name,
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-10T00:00:00Z',
  ...over,
});

/** The eight, as the house names them. */
const house = [
  device('Garage OH1 Door Sensor', { device_type: 'contact_sensor' }),
  device('Dining Room Door Sensor', { device_type: 'contact_sensor' }),
  device('Bathroom Door Sensor', { device_type: 'contact_sensor' }),
  device('Living Room Floor Lamp', { device_type: 'light', area: 'living_room' }),
  device('Ceiling Fan', { device_type: 'fan', area: 'office' }),
];

async function editor(rules: IconRule[], over: Record<string, unknown> = {}) {
  setIconRules(rules);
  const el = document.createElement('hc-icon-rules') as HTMLElement & {
    devices: readonly DeviceState[];
    onSaveIconRules: ((r: IconRule[]) => void) | undefined;
    updateComplete: Promise<unknown>;
  };
  Object.assign(el, { devices: house, onSaveIconRules: () => undefined }, over);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const matchText = (el: HTMLElement, i = 0): string =>
  [...(el.shadowRoot?.querySelectorAll('.matches') ?? [])][i]?.textContent
    ?.replace(/\s+/g, ' ')
    .trim() ?? '';

describe('showing what a rule actually does', () => {
  it('names the devices it takes, right now', async () => {
    // §11.2 asks for a live test. Each rule *is* one: a regex is exactly the
    // kind of thing somebody writes slightly wrong and does not notice.
    const el = await editor([{ match: 'door', icon: 'door', on: 'name' }]);
    expect(matchText(el)).toContain('3 devices');
    expect(matchText(el)).toContain('Garage OH1 Door Sensor');
  });

  it('says plainly when a rule matches nothing', async () => {
    const el = await editor([{ match: 'porch', icon: 'door', on: 'name' }]);
    expect(matchText(el)).toContain('Matches nothing');
  });

  it('says when a rule is shadowed by one above it', async () => {
    // First match wins, so a rule's real effect is not what its pattern
    // matches but what is left for it. A rule that looks right and catches
    // nothing because a broader one sits above is the failure this exists for.
    const el = await editor([
      { match: 'sensor', icon: 'device', on: 'name' },
      { match: 'door', icon: 'door', on: 'name' },
    ]);
    expect(matchText(el, 1)).toContain('Matches nothing');
    expect(matchText(el, 1)).toContain('3 taken by a rule above');
  });

  it('marks a pattern that is not one yet, rather than throwing', async () => {
    // Somebody is typing it. `ruleFor` already matches nothing rather than
    // throwing; this says so where it happens.
    const el = await editor([{ match: '[unclosed', icon: 'door', on: 'name' }]);
    expect(matchText(el)).toContain('Not a pattern yet');
    expect(el.shadowRoot?.querySelector('input[data-bad]')).not.toBeNull();
  });

  it('matches a room, not only a name', async () => {
    const el = await editor([{ match: 'living', icon: 'light', on: 'area' }]);
    expect(matchText(el)).toContain('Living Room Floor Lamp');
  });
});

describe('editing', () => {
  it('saves on every change, with no button to forget', async () => {
    const saved = vi.fn();
    const el = await editor([{ match: 'door', icon: 'door', on: 'name' }], {
      onSaveIconRules: saved,
    });
    const input = el.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = 'garage';
    input.dispatchEvent(new Event('input'));

    expect(saved).toHaveBeenCalledWith([{ match: 'garage', icon: 'door', on: 'name' }]);
  });

  it('reorders, because order is meaning', async () => {
    const saved = vi.fn();
    const el = await editor(
      [
        { match: 'a', icon: 'door', on: 'name' },
        { match: 'b', icon: 'light', on: 'name' },
      ],
      { onSaveIconRules: saved },
    );
    const down = el.shadowRoot?.querySelector('button[aria-label="Move down"]') as HTMLElement;
    down.click();

    expect(saved).toHaveBeenCalledWith([
      { match: 'b', icon: 'light', on: 'name' },
      { match: 'a', icon: 'door', on: 'name' },
    ]);
  });

  it('cannot move the first up or the last down', async () => {
    const el = await editor([
      { match: 'a', icon: 'door', on: 'name' },
      { match: 'b', icon: 'light', on: 'name' },
    ]);
    const ups = [...(el.shadowRoot?.querySelectorAll('button[aria-label="Move up"]') ?? [])];
    const downs = [...(el.shadowRoot?.querySelectorAll('button[aria-label="Move down"]') ?? [])];
    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downs[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds and removes', async () => {
    const saved = vi.fn();
    const el = await editor([{ match: 'door', icon: 'door', on: 'name' }], {
      onSaveIconRules: saved,
    });
    const add = [...(el.shadowRoot?.querySelectorAll('.foot button') ?? [])][0] as HTMLElement;
    add.click();
    expect(saved).toHaveBeenLastCalledWith([
      { match: 'door', icon: 'door', on: 'name' },
      { match: '', icon: 'device', on: 'name' },
    ]);

    await el.updateComplete;
    // Removing one of two leaves one — the blank rule just added.
    const remove = el.shadowRoot?.querySelector('button[aria-label="Remove"]') as HTMLElement;
    remove.click();
    expect(saved).toHaveBeenLastCalledWith([{ match: '', icon: 'device', on: 'name' }]);
  });

  it('offers only marks that exist', async () => {
    // A rule naming a mark this client does not have falls through silently,
    // which is right for a hand-written rule and wrong for a picker.
    const { markNames } = await import('../src/design/icons.js');
    const known = new Set(markNames());
    const el = await editor([{ match: 'door', icon: 'door', on: 'name' }]);
    const options = [
      ...(el.shadowRoot?.querySelectorAll('select[aria-label="Icon"] option') ?? []),
    ];
    expect(options.length).toBeGreaterThan(5);
    for (const o of options) expect(known.has(o.getAttribute('value')!)).toBe(true);
  });
});

describe('with no way to save', () => {
  it('draws nothing at all', async () => {
    const el = await editor([{ match: 'door', icon: 'door', on: 'name' }], {
      onSaveIconRules: undefined,
    });
    expect(el.shadowRoot?.querySelector('.rule')).toBeNull();
  });
});

describe('removing every rule', () => {
  it('asks first, because there is no undo', async () => {
    // Every other control changes one rule and shows its effect above. This
    // one discards work and leaves nothing to look at — and it is exactly the
    // mistake that wiped a live store while this was being written.
    const saved = vi.fn();
    const el = await editor(
      [
        { match: 'door', icon: 'door', on: 'name' },
        { match: 'fan', icon: 'fan', on: 'name' },
      ],
      { onSaveIconRules: saved },
    );

    const removeAll = [
      ...(el.shadowRoot?.querySelectorAll('.foot button') ?? []),
    ][1] as HTMLElement;
    removeAll.click();
    await el.updateComplete;

    expect(saved).not.toHaveBeenCalled();
    const armed = [...(el.shadowRoot?.querySelectorAll('.foot button') ?? [])];
    expect(armed[1]?.textContent?.trim()).toContain('Remove all 2?');

    (armed[1] as HTMLElement).click();
    expect(saved).toHaveBeenLastCalledWith([]);
  });

  it('can be backed out of', async () => {
    const saved = vi.fn();
    const el = await editor([{ match: 'door', icon: 'door', on: 'name' }], {
      onSaveIconRules: saved,
    });
    ([...(el.shadowRoot?.querySelectorAll('.foot button') ?? [])][1] as HTMLElement).click();
    await el.updateComplete;

    const keep = [...(el.shadowRoot?.querySelectorAll('.foot button') ?? [])][2] as HTMLElement;
    expect(keep.textContent?.trim()).toBe('Keep them');
    keep.click();
    await el.updateComplete;

    expect(saved).not.toHaveBeenCalled();
    expect(el.shadowRoot?.querySelectorAll('.rule')).toHaveLength(1);
  });
});

describe('showing which icon a rule uses', () => {
  it('marks the stored one, not the first in the list', async () => {
    // Setting `.value` on the select renders before its options exist, so the
    // browser falls back to the first — every rule displayed "battery", the
    // alphabetically first mark, while the stored icons were correct.
    const el = await editor([
      { match: 'door sensor', icon: 'door', on: 'name' },
      { match: 'garage door', icon: 'garage', on: 'name' },
    ]);
    const selected = [...(el.shadowRoot?.querySelectorAll('select[aria-label="Icon"]') ?? [])].map(
      (s) => (s as HTMLSelectElement).value,
    );
    expect(selected).toEqual(['door', 'garage']);
  });

  it('marks what a rule matches against', async () => {
    const el = await editor([{ match: 'garage', icon: 'garage', on: 'area' }]);
    const on = el.shadowRoot?.querySelector(
      'select[aria-label="Match against"]',
    ) as HTMLSelectElement;
    expect(on.value).toBe('area');
  });
});
