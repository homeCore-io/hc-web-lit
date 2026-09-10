/**
 * Plugin widgets, against core's own conformance corpus.
 *
 * `docs/dashboard-widget-fixtures.json` is the third part of the descriptor
 * contract — the prose, the reference implementation, and the fixtures, and
 * the fixtures win. They are copied here rather than restated, so a rule core
 * changes shows up as a failure rather than as a client that quietly disagrees
 * about what a plugin may declare.
 *
 * The corpus does not pin the *messages*, only accepted-or-not, so the wording
 * below follows core's where it is checked at all.
 */
import { describe, expect, it } from 'vitest';
import corpus from './fixtures/widget-descriptor-fixtures.json' with { type: 'json' };
import vocabularyFixture from './fixtures/vocabulary.json' with { type: 'json' };
import {
  portabilityOf,
  resolveBindings,
  validateDescriptor,
  type WidgetDescriptor,
} from '../src/core/descriptor.js';
import type { DeviceState } from '../src/core/device.js';
import { readVocabulary, type Vocabulary } from '../src/core/vocabulary.js';
import '../src/widgets/hc-plugin-widget.js';

const vocabulary = readVocabulary(vocabularyFixture) as Vocabulary;
const elements = vocabulary.elements;

interface Case {
  name: string;
  descriptor: unknown;
  accepted: boolean;
  portability?: string;
}
const cases = corpus.cases as unknown as Case[];

describe('core’s conformance corpus', () => {
  it('is the real thing, and covers both answers', () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(cases.some((c) => c.accepted)).toBe(true);
    expect(cases.some((c) => !c.accepted)).toBe(true);
    // The element table is what validation is done against; without it every
    // case below would pass for the wrong reason.
    expect(elements.map((e) => e.kind).sort()).toEqual([
      'column',
      'gauge',
      'icon',
      'row',
      'shape',
      'stack',
      'text',
    ]);
  });

  it.each(cases)('$name', ({ descriptor, accepted }) => {
    expect(validateDescriptor(descriptor, elements).ok).toBe(accepted);
  });

  it.each(cases.filter((c) => c.portability !== undefined))(
    'reads the portability of: $name',
    ({ descriptor, portability }) => {
      expect(portabilityOf(descriptor as WidgetDescriptor)).toBe(portability);
    },
  );
});

describe('why a descriptor was refused', () => {
  const reason = (d: unknown): string => {
    const got = validateDescriptor(d, elements);
    return got.ok ? '' : got.reason;
  };

  it('says code without a render is the portability rule', () => {
    expect(reason({ widget_id: 'w', title: 'W', code: { entry: 'x.html' } })).toContain(
      'declares code but no render',
    );
  });

  it('names the element kinds a client actually has', () => {
    const said = reason({ widget_id: 'w', title: 'W', render: { kind: 'sparkline' } });
    expect(said).toContain("unknown element 'sparkline'");
    expect(said).toContain('column, gauge, icon, row, shape, stack, text');
  });

  it('names the field, because that is what the author has to change', () => {
    expect(
      reason({ widget_id: 'w', title: 'W', render: { kind: 'gauge', value: 'f', glow: 0.4 } }),
    ).toContain("unknown field 'glow' on 'gauge'");
  });
});

describe('bindings, resolved against the house', () => {
  const device: DeviceState = {
    device_id: 'boiler_1',
    name: 'Boiler',
    plugin_id: 'boiler',
    available: true,
    attributes: { flow_lpm: 12, temperature: 60, temperature_unit: '°C' },
    last_seen: '2026-09-10T00:00:00Z',
  };

  it('resolves the device the card was configured with', () => {
    // One descriptor serves every device of its kind, which is what the
    // template is for. Core stores it and does not expand it.
    const bound = resolveBindings(
      [{ name: 'flow', device: '{{config.device_id}}', key: 'flow_lpm' }],
      { device_id: 'boiler_1' },
      [device],
    );
    expect(bound['flow']?.value).toBe(12);
  });

  it('maps a range onto the instrument’s', () => {
    const bound = resolveBindings(
      [
        {
          name: 'flow',
          device: 'boiler_1',
          key: 'flow_lpm',
          in_from: 0,
          in_to: 24,
          out_from: 0,
          out_to: 100,
        },
      ],
      {},
      [device],
    );
    expect(bound['flow']?.value).toBe(50);
  });

  it('carries the unit the device published', () => {
    const bound = resolveBindings([{ name: 't', device: 'boiler_1', key: 'temperature' }], {}, [
      device,
    ]);
    expect(bound['t']?.unit).toBe('°C');
  });

  it('resolves to nothing rather than to zero', () => {
    // An instrument reading zero is a claim. A binding that names a device the
    // house does not have has nothing to say.
    const bound = resolveBindings(
      [
        { name: 'gone', device: 'no_such_device', key: 'flow_lpm' },
        { name: 'unset', device: 'boiler_1', key: 'no_such_attribute' },
      ],
      {},
      [device],
    );
    expect(bound['gone']).toBeUndefined();
    expect(bound['unset']).toBeUndefined();
  });
});

describe('the widget', () => {
  const descriptor = {
    plugin_id: 'plugin.boiler',
    widget_id: 'boiler_flow',
    title: 'Boiler flow',
    bindings: [{ name: 'flow', device: '{{config.device_id}}', key: 'flow_lpm' }],
    render: {
      kind: 'row',
      children: [
        { kind: 'gauge', value: 'flow', max: 24, label: 'Flow' },
        { kind: 'text', content: '{{flow}} now' },
      ],
    },
  };

  const house: DeviceState[] = [
    {
      device_id: 'boiler_1',
      name: 'Boiler',
      plugin_id: 'boiler',
      available: true,
      attributes: { flow_lpm: 12 },
      last_seen: '2026-09-10T00:00:00Z',
    },
  ];

  const mount = async (config: Record<string, unknown>, widgets: unknown[]) => {
    const el = document.createElement('hc-plugin-widget');
    el.config = config;
    el.devices = house;
    el.vocabulary = { ...vocabulary, plugin_widgets: widgets as Vocabulary['plugin_widgets'] };
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const text = (el: HTMLElement): string =>
    [...(el.shadowRoot?.childNodes ?? [])]
      .filter((n) => (n as Element).tagName !== 'STYLE')
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('draws the instruments a plugin declared', async () => {
    const el = await mount(
      { plugin_id: 'plugin.boiler', widget_id: 'boiler_flow', device_id: 'boiler_1' },
      [descriptor],
    );
    expect(el.shadowRoot?.querySelector('path[part="indicator"]')).not.toBeNull();
    expect(text(el)).toContain('12');
    expect(text(el)).toContain('now');
  });

  it('needs both halves of the pair', async () => {
    // Two plugins may pick the same widget id, and drawing one plugin's card
    // for another's is worse than drawing neither.
    const el = await mount(
      { plugin_id: 'plugin.other', widget_id: 'boiler_flow', device_id: 'boiler_1' },
      [descriptor],
    );
    expect(text(el)).toContain('No widget "boiler_flow"');
  });

  it('says a plugin may not be running rather than drawing a blank square', async () => {
    const el = await mount({ plugin_id: 'plugin.boiler', widget_id: 'gone' }, [descriptor]);
    expect(text(el)).toContain('may not be running');
  });

  it('refuses a render it cannot draw, whole', async () => {
    // Half a card is a card nobody can debug.
    const el = await mount({ plugin_id: 'p', widget_id: 'w' }, [
      { plugin_id: 'p', widget_id: 'w', title: 'W', render: { kind: 'sparkline' } },
    ]);
    expect(text(el)).toContain("unknown element 'sparkline'");
  });

  it('draws the portable render of a widget that also ships code', async () => {
    const el = await mount({ plugin_id: 'p', widget_id: 'w', device_id: 'boiler_1' }, [
      {
        plugin_id: 'p',
        widget_id: 'w',
        title: 'Boiler flow',
        bindings: [{ name: 'flow', device: 'boiler_1', key: 'flow_lpm' }],
        render: { kind: 'text', content: 'flow' },
        code: { entry: 'boiler.html' },
      },
    ]);
    expect(text(el)).toContain('12');
    expect(text(el)).toContain('portable render');
  });
});
