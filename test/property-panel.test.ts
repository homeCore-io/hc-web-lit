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
import { knownFacets } from '../src/core/selection.js';
import { knownTypes } from '../src/core/registry.js';
import type { DeviceState } from '../src/core/device.js';
import type { WidgetSpec } from '../src/core/widget.js';
import '../src/widgets/hc-heading.js';
import '../src/widgets/hc-device-grid.js';
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

  it('offers the facet names that actually select something', async () => {
    // Two vocabularies that look alike: `selectDevices` matches `lights` and
    // `doors_windows`; `facetHints` is the singular `ui_hint` set on one
    // device. A picker offering the wrong one has every value looking
    // official and selecting nothing.
    const el = await panel({ type: 'device_grid', config: { selection_mode: 'facet' } });
    const offered = [
      ...(el.shadowRoot?.querySelectorAll('datalist[id="list-facet"] option') ?? []),
    ].map((o) => o.getAttribute('value'));
    expect(offered).toEqual(knownFacets());
    expect(offered).toContain('lights');
    expect(offered).not.toContain('light');
  });

  it('says which field nothing else would be able to read', async () => {
    const el = await panel({ type: 'device_grid', config: { selection_mode: 'area' } });
    expect(el.shadowRoot?.textContent).toContain('Needs a value.');
    expect(el.shadowRoot?.textContent).toContain('1 field is outside the shared vocabulary');
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

describe('editing any widget on the page', () => {
  const pageWidgets = [
    { id: 'h_001', type: 'heading', config: { text: 'Hall' } },
    { id: 'g_002', type: 'device_grid', title: 'Office', config: { selection_mode: 'manual' } },
  ];

  const onPage = async (config: Record<string, unknown> = {}): Promise<HcPropertyPanel> => {
    const el = document.createElement('hc-property-panel');
    el.config = { preview: false, ...config };
    el.devices = house;
    el.vocabulary = vocabulary;
    el.pageWidgets = pageWidgets;
    el.onSaveWidget = async () => undefined;
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const picker = (el: HcPropertyPanel): HTMLSelectElement =>
    el.shadowRoot?.querySelector('[aria-label="Widget"]') as HTMLSelectElement;

  it('offers every widget the page has', async () => {
    // One panel is an editor for the page, not for the one widget its config
    // happened to name.
    const el = await onPage({ edits: 'h_001' });
    expect([...picker(el).options].map((o) => o.value)).toEqual(['h_001', 'g_002']);
    expect(picker(el).value).toBe('h_001');
  });

  it('edits the widget it is pointed at, from the page', async () => {
    const el = await onPage({ edits: 'g_002' });
    expect(el.shadowRoot?.textContent).toContain('device_grid');
    expect((field(el, 'Selection mode') as HTMLSelectElement).value).toBe('manual');
  });

  it('changes what it is editing when somebody picks another', async () => {
    const el = await onPage({ edits: 'h_001' });
    picker(el).value = 'g_002';
    picker(el).dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain('device_grid');
  });

  it('will not carry an unsaved edit to another widget', async () => {
    // Discarding it silently and carrying it over both lose work; this is a
    // sentence a person can act on.
    const el = await onPage({ edits: 'h_001' });
    const text = field(el, 'Text') as HTMLInputElement;
    text.value = 'Hallway';
    text.dispatchEvent(new Event('input'));
    await el.updateComplete;

    expect(picker(el).disabled).toBe(true);
    expect(el.shadowRoot?.textContent).toContain('Save this edit or take it back');
  });

  it('falls back to the literal in its config when it is not on a page', async () => {
    // A sheet, or a test. This is what the panel always did.
    const el = document.createElement('hc-property-panel');
    el.config = { widget: { type: 'heading', config: { text: 'Loose' } }, preview: false };
    el.vocabulary = vocabulary;
    document.body.append(el);
    await el.updateComplete;
    expect((field(el, 'Text') as HTMLInputElement).value).toBe('Loose');
    expect(el.shadowRoot?.querySelector('[aria-label="Widget"]')).toBeNull();
  });
});

describe('adding and removing a widget', () => {
  const page = [{ id: 'h_001', type: 'heading', config: { text: 'Hall' } }];

  const withHost = async (
    hosts: {
      onAddWidget?: (type: string) => Promise<string>;
      onRemoveWidget?: (id: string) => Promise<void>;
    } = {},
  ): Promise<HcPropertyPanel> => {
    const el = document.createElement('hc-property-panel');
    el.config = { preview: false, edits: 'h_001' };
    el.vocabulary = vocabulary;
    el.pageWidgets = page;
    el.onSaveWidget = async () => undefined;
    if (hosts.onAddWidget !== undefined) el.onAddWidget = hosts.onAddWidget;
    if (hosts.onRemoveWidget !== undefined) el.onRemoveWidget = hosts.onRemoveWidget;
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const catalogue = (el: HcPropertyPanel): HTMLSelectElement =>
    el.shadowRoot?.querySelector('[aria-label="Add a widget"]') as HTMLSelectElement;

  it('offers only what this client can draw', async () => {
    // Offering a type that renders as a labelled placeholder would be offering
    // somebody a broken card and calling it a choice.
    const el = await withHost({ onAddWidget: async () => 'x' });
    const offered = [...catalogue(el).options].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual(knownTypes());
    expect(offered).toContain('device_grid');
    expect(offered).not.toContain('floor_plan');
  });

  it('starts editing what it just added', async () => {
    // The widget arrives with an empty config and draws as its own "nothing to
    // show"; leaving somebody looking at that with no next step reads as
    // broken.
    // What the host does: the page gains the widget, and the panel is handed
    // the page again on the next render. Deferred through a holder so the
    // callback can reach the element it is given to.
    const panel: { el?: HcPropertyPanel } = {};
    const added = vi.fn(async (type: string) => {
      if (panel.el !== undefined) {
        panel.el.pageWidgets = [...page, { id: 'grid_1', type, config: {} }];
      }
      return 'grid_1';
    });
    const el = await withHost({ onAddWidget: added });
    panel.el = el;

    catalogue(el).value = 'device_grid';
    catalogue(el).dispatchEvent(new Event('change'));
    await el.updateComplete;
    await el.updateComplete;

    expect(added).toHaveBeenCalledWith('device_grid');
    expect(el.shadowRoot?.textContent).toContain('nothing in it yet');
    // And it is the new widget being edited, not the one that was there.
    expect(el.shadowRoot?.textContent).toContain('device_grid');
  });

  it('asks before taking one off', async () => {
    // No undo and no bin, the same reason the icon rules reset asks twice.
    const removed = vi.fn(async () => undefined);
    const el = await withHost({ onAddWidget: async () => 'x', onRemoveWidget: removed });

    const arm = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find((b) =>
      (b.textContent ?? '').includes('Remove this widget'),
    );
    arm?.click();
    await el.updateComplete;
    expect(removed).not.toHaveBeenCalled();

    const confirm = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find((b) =>
      (b.textContent ?? '').includes('Remove h_001?'),
    );
    confirm?.click();
    expect(removed).toHaveBeenCalledWith('h_001');
  });

  it('offers none of it without a host that can write', async () => {
    const el = await withHost();
    expect(catalogue(el)).toBeNull();
  });
});

describe('moving a widget', () => {
  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    placements: [{ widget_id: 'h_001', x: 1, y: 2, w: 6, h: 2 }],
  };

  const placed = async (
    over: { layout?: typeof layout; breakpoint?: string } = {},
  ): Promise<{ el: HcPropertyPanel; moved: ReturnType<typeof vi.fn> }> => {
    const moved = vi.fn(async () => undefined);
    const el = document.createElement('hc-property-panel');
    el.config = { preview: false, edits: 'h_001' };
    el.vocabulary = vocabulary;
    el.pageWidgets = [{ id: 'h_001', type: 'heading', config: { text: 'Hall' } }];
    el.pagePlacements = over.layout ?? layout;
    el.onPlaceWidget = moved;
    el.env = { store: undefined, context: {}, breakpoint: over.breakpoint ?? 'desktop' };
    document.body.append(el);
    await el.updateComplete;
    return { el, moved };
  };

  it('shows where the widget sits, in that layout’s units', async () => {
    const { el } = await placed();
    expect((field(el, 'Left') as HTMLInputElement).value).toBe('1');
    expect((field(el, 'Width') as HTMLInputElement).value).toBe('6');
    expect(el.shadowRoot?.textContent).toContain('Grid cells');
  });

  it('moves it, keeping the numbers it was not given', async () => {
    const { el, moved } = await placed();
    const top = field(el, 'Top') as HTMLInputElement;
    top.value = '5';
    top.dispatchEvent(new Event('change'));
    expect(moved).toHaveBeenCalledWith('h_001', { x: 1, y: 5, w: 6, h: 2 });
  });

  it('says when the arrangement belongs to another size', async () => {
    // Three of the four pages in the reference house have only a desktop
    // layout, so moving something on a phone moves it on the laptop too.
    const { el } = await placed({ breakpoint: 'mobile' });
    expect(el.shadowRoot?.textContent).toContain('which this size is borrowing');
  });

  it('says pixels on a composed page', async () => {
    const { el } = await placed({
      layout: {
        ...layout,
        flow: 'free',
        placements: [
          { widget_id: 'h_001', x: 0, y: 0, w: 6, h: 2, rect: { x: 8, y: 9, w: 300, h: 40 } },
        ],
      } as unknown as typeof layout,
    });
    expect(el.shadowRoot?.textContent).toContain('Pixels in the frame');
    expect((field(el, 'Left') as HTMLInputElement).value).toBe('8');
  });

  it('offers nothing to move without a host that can place', async () => {
    const el = document.createElement('hc-property-panel');
    el.config = { preview: false, edits: 'h_001' };
    el.vocabulary = vocabulary;
    el.pageWidgets = [{ id: 'h_001', type: 'heading', config: {} }];
    el.pagePlacements = layout;
    document.body.append(el);
    await el.updateComplete;
    expect(field(el, 'Left')).toBeNull();
  });
});

describe('saving into the page', () => {
  const mount = async (
    config: Record<string, unknown>,
    onSaveWidget?: (id: string, c: Record<string, unknown>) => Promise<void>,
  ): Promise<HcPropertyPanel> => {
    const el = document.createElement('hc-property-panel');
    el.config = config;
    el.devices = house;
    el.vocabulary = vocabulary;
    if (onSaveWidget !== undefined) el.onSaveWidget = onSaveWidget;
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const button = (el: HcPropertyPanel, starts: string): HTMLButtonElement | undefined =>
    [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find((b) =>
      (b.textContent ?? '').trim().startsWith(starts),
    );

  const type = async (el: HcPropertyPanel, label: string, value: string): Promise<void> => {
    const input = field(el, label) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
  };

  const editing = {
    widget: { type: 'heading', config: { text: 'Hall' } },
    edits: 'h_012',
    preview: false,
  };

  it('writes the widget id and the config, and nothing else', async () => {
    // The narrowest write that is useful: a widget that could hand over a
    // whole page could rewrite the page it is on.
    const save = vi.fn(async () => undefined);
    const el = await mount(editing, save);
    await type(el, 'Text', 'Hallway');

    button(el, 'Save into')?.click();
    expect(save).toHaveBeenCalledWith('h_012', { text: 'Hallway' });
  });

  it('drops the draft once the house has it', async () => {
    // What is drawn from here on is what the house holds, not what this panel
    // remembers sending.
    const el = await mount(
      editing,
      vi.fn(async () => undefined),
    );
    await type(el, 'Text', 'Hallway');
    button(el, 'Save into')?.click();
    await el.updateComplete;
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain('Saved.');
    expect(button(el, 'Undo the changes')).toBeUndefined();
  });

  it('says why a save did not happen, and keeps the edit', async () => {
    const el = await mount(
      editing,
      vi.fn(async () => {
        throw new Error('dashboard access denied');
      }),
    );
    await type(el, 'Text', 'Hallway');
    button(el, 'Save into')?.click();
    await el.updateComplete;
    await el.updateComplete;

    expect(el.shadowRoot?.textContent).toContain('dashboard access denied');
    // The words somebody typed are still there to try again with.
    expect((field(el, 'Text') as HTMLInputElement).value).toBe('Hallway');
  });

  it('does not offer to send a config core would refuse', async () => {
    // The refusal would be correct, and the round trip would be spent
    // learning what the field already says.
    const el = await mount(
      {
        widget: { type: 'device_grid', config: { selection_mode: 'area', area_name: 'office' } },
        edits: 'g_1',
        preview: false,
      },
      vi.fn(async () => undefined),
    );
    await type(el, 'Area name', '');
    expect(button(el, 'Fix the fields first')?.disabled).toBe(true);
  });

  it('says so plainly when this session may not write', async () => {
    const el = await mount(editing);
    await type(el, 'Text', 'Hallway');
    expect(el.shadowRoot?.textContent).toContain('may not write pages');
  });

  it('says so plainly when it is not pointed at a widget', async () => {
    const el = await mount(
      { widget: { type: 'heading', config: { text: 'Hall' } }, preview: false },
      vi.fn(async () => undefined),
    );
    await type(el, 'Text', 'Hallway');
    expect(el.shadowRoot?.textContent).toContain('not pointed at a widget');
  });
});

describe('an edit that cannot be saved yet', () => {
  it('can be taken back', async () => {
    // A panel with no target and no way to write still edits; what it must
    // not do is let somebody make ten changes believing they are kept.
    const el = await panel({ type: 'heading', config: { text: 'Hall' } });
    const input = field(el, 'Text') as HTMLInputElement;
    input.value = 'Hallway';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

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
