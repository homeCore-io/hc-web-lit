/**
 * The generated property panel, on real widget types.
 *
 * `properties.test.ts` pins the model; this pins the surface, and mostly the
 * two things a generated editor gets wrong: a control that displays a value it
 * does not hold, and an edit that writes back the wrong shape. Both have
 * happened in this repo — the icon rules editor showed the wrong icon for
 * every rule for a day, because a `select` cannot be told its value before its
 * options exist.
 */
import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/vocabulary.json' with { type: 'json' };
import { readVocabulary, type Vocabulary } from '../src/core/vocabulary.js';
import type { DeviceState } from '../src/core/device.js';
import type { WidgetSpec } from '../src/core/widget.js';
import '../src/widgets/hc-heading.js';
import '../src/widgets/hc-property-panel.js';
import type { HcPropertyPanel } from '../src/widgets/hc-property-panel.js';

const vocabulary = readVocabulary(fixture) as Vocabulary;

const device = (id: string, name: string, extra: Partial<DeviceState> = {}): DeviceState => ({
  device_id: id,
  name,
  plugin_id: 'hue',
  available: true,
  attributes: { on: true, brightness_pct: 40 },
  last_seen: '2026-09-10T00:00:00Z',
  ...extra,
});

const house: DeviceState[] = [
  device('hue_1', 'Desk Lamp', {
    area: 'office',
    schema: { attributes: { on: { kind: 'bool', writable: true } } },
  }),
  device('hue_2', 'Hall Light', { area: 'hallway' }),
];

async function panel(widget: WidgetSpec, changed = vi.fn()): Promise<HcPropertyPanel> {
  const el = document.createElement('hc-property-panel');
  el.config = { widget, preview: false };
  el.devices = house;
  el.vocabulary = vocabulary;
  el.addEventListener('hc-widget-change', (e) => changed((e as CustomEvent<WidgetSpec>).detail));
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const field = (el: HcPropertyPanel, label: string): HTMLElement | null =>
  el.shadowRoot?.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? null;

const rows = (el: HcPropertyPanel): string[] =>
  [...(el.shadowRoot?.querySelectorAll('.name') ?? [])].map((n) => n.textContent?.trim() ?? '');

describe('what it draws', () => {
  it('generates a row per property, with nothing to hand-edit', async () => {
    const el = await panel({ type: 'device_grid', config: { selection_mode: 'manual' } });

    expect(rows(el).some((r) => r.startsWith('Selection mode'))).toBe(true);
    expect(rows(el).some((r) => r.startsWith('Sort'))).toBe(true);
    // §4.4's rule, as a property of the DOM: a grid is edited with controls,
    // and the only textarea this panel ever renders is for prose.
    expect(el.shadowRoot?.querySelector('textarea')).toBeNull();
  });

  it('shows a select holding the value it actually has', async () => {
    // The bug this exists for: binding a value on a `select` renders before
    // its options, so the browser falls back to the first one and the panel
    // displays a lie while the document is correct.
    const el = await panel({
      type: 'device_grid',
      config: { selection_mode: 'manual', sort: 'room' },
    });
    expect((field(el, 'Sort') as HTMLSelectElement).value).toBe('room');
    expect((field(el, 'Selection mode') as HTMLSelectElement).value).toBe('manual');
  });

  it('offers the house in a field that points at a device, without restricting it', async () => {
    const el = await panel({ type: 'slider', config: { device_id: 'hue_1', attribute: 'on' } });
    const input = field(el, 'Device id') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');

    const options = [...(el.shadowRoot?.querySelectorAll('datalist option') ?? [])].map((o) =>
      o.getAttribute('label'),
    );
    expect(options).toContain('Desk Lamp');
    // And it says which device that id is, because an id is not a name.
    expect(el.shadowRoot?.textContent).toContain('Desk Lamp');
  });

  it('offers the bound device’s own attributes, not the whole house’s', async () => {
    const el = await panel({ type: 'slider', config: { device_id: 'hue_1' } });
    const values = [...(el.shadowRoot?.querySelectorAll('datalist option') ?? [])].map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toContain('brightness_pct');
  });

  it('says which field core would refuse', async () => {
    const el = await panel({ type: 'device_grid', config: { selection_mode: 'area' } });
    expect(el.shadowRoot?.textContent).toContain('Needs a value.');
    expect(el.shadowRoot?.textContent).toContain('1 field is not what core accepts.');
  });

  it('draws a widget type core has never heard of', async () => {
    // §14.3 — an unknown type is legal, and its config is somebody's work.
    const el = await panel({ type: 'com.example.dial', config: { hue: 20 } });
    expect(el.shadowRoot?.textContent).toContain('core describes no fields for this type');
    expect(rows(el).some((r) => r.startsWith('Hue'))).toBe(true);
  });
});

describe('what it writes back', () => {
  it('reports an edit and keeps the keys it did not touch', async () => {
    const changed = vi.fn();
    const el = await panel(
      { type: 'heading', config: { text: 'Hall', style: { tint: 'warm' } } },
      changed,
    );

    const input = field(el, 'Text') as HTMLInputElement;
    input.value = 'Hallway';
    input.dispatchEvent(new Event('input'));

    expect(changed).toHaveBeenCalledWith({
      type: 'heading',
      config: { text: 'Hallway', style: { tint: 'warm' } },
    });
  });

  it('removes an optional field rather than storing an empty one', async () => {
    const changed = vi.fn();
    const el = await panel(
      { type: 'device_grid', config: { selection_mode: 'manual', sort: 'room' } },
      changed,
    );

    const sort = field(el, 'Sort') as HTMLSelectElement;
    sort.value = '';
    sort.dispatchEvent(new Event('change'));

    expect(changed).toHaveBeenCalledWith({
      type: 'device_grid',
      config: { selection_mode: 'manual' },
    });
  });

  it('writes a gesture core does not describe, in core’s own spelling', async () => {
    const changed = vi.fn();
    const el = await panel({ type: 'heading', config: { text: 'Hall' } }, changed);

    const hold = field(el, 'On hold') as HTMLSelectElement;
    hold.value = 'toggle';
    hold.dispatchEvent(new Event('change'));

    expect(changed).toHaveBeenCalledWith({
      type: 'heading',
      config: { text: 'Hall', on_hold: { do: 'toggle' } },
    });
  });

  it('drops a gesture set back to nothing', async () => {
    const changed = vi.fn();
    const el = await panel(
      { type: 'heading', config: { text: 'Hall', on_tap: { do: 'page', target: 'house' } } },
      changed,
    );

    const tap = field(el, 'On tap') as HTMLSelectElement;
    expect(tap.value).toBe('page');
    tap.value = 'none';
    tap.dispatchEvent(new Event('change'));

    expect(changed).toHaveBeenCalledWith({ type: 'heading', config: { text: 'Hall' } });
  });

  it('edits a list one row at a time', async () => {
    const changed = vi.fn();
    const el = await panel(
      { type: 'device_grid', config: { selection_mode: 'manual', device_ids: ['hue_1'] } },
      changed,
    );

    const second = el.shadowRoot?.querySelector<HTMLButtonElement>('.listrow ~ button');
    expect(second?.textContent?.trim()).toBe('Add');
    second?.click();
    expect(changed).toHaveBeenCalledWith({
      type: 'device_grid',
      config: { selection_mode: 'manual', device_ids: ['hue_1', ''] },
    });
  });
});

describe('an edit that cannot be saved yet', () => {
  it('says so, and can be taken back', async () => {
    // There is no dashboard write path in this client. A panel that let
    // somebody make ten changes without saying that would be lying by
    // omission, and the changes would go when the page did.
    const el = await panel({ type: 'heading', config: { text: 'Hall' } });
    const input = field(el, 'Text') as HTMLInputElement;
    input.value = 'Hallway';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

    expect(el.shadowRoot?.textContent).toContain('no dashboard write path yet');

    const undo = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Undo the changes',
    );
    undo?.click();
    await el.updateComplete;
    expect((field(el, 'Text') as HTMLInputElement).value).toBe('Hall');
  });
});

describe('the preview', () => {
  it('draws the widget being edited, and redraws it on every change', async () => {
    // The panel mounts its subject as a child — `ctx.child` (§5.5) — so a
    // property is a thing that changes on screen rather than a name in a form.
    // It is also the cheapest test of whether a generated control writes a
    // shape the widget can actually read.
    const el = document.createElement('hc-property-panel');
    el.config = { widget: { type: 'heading', config: { text: 'Hall' } } };
    el.devices = house;
    el.vocabulary = vocabulary;
    el.env = { store: undefined, context: {} };
    document.body.append(el);
    await el.updateComplete;

    // The child is an element with its own shadow root, so the text is a
    // level down rather than in the panel's own tree.
    const drawn = () => el.shadowRoot?.querySelector('.preview > *')?.shadowRoot?.textContent ?? '';
    expect(drawn()).toContain('Hall');

    const input = field(el, 'Text') as HTMLInputElement;
    input.value = 'Hallway';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    // Lit renders the child element itself; give it its own frame.
    await Promise.resolve();
    expect(drawn()).toContain('Hallway');
  });
});
