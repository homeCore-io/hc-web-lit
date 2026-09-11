/**
 * Authoring a template, not only rendering one (§5.4).
 *
 * The mechanism has been complete since P3 — substitution, by-reference
 * instantiation, a store behind an interface — and nothing could make one.
 */
import { describe, expect, it } from 'vitest';
import { Templates, instantiate, paramNames, templateId } from '../src/core/templates.js';
import type { WidgetTemplate } from '../src/core/templates.js';
import '../src/widgets/hc-property-panel.js';
import fixture from './fixtures/vocabulary.json' with { type: 'json' };
import { readVocabulary, type Vocabulary } from '../src/core/vocabulary.js';
import type { HcPropertyPanel } from '../src/widgets/hc-property-panel.js';

/** A panel pointed at one widget config, with a template store behind it. */
async function mountPanel(
  config: Record<string, unknown>,
  templates: Templates,
): Promise<{
  panel: HcPropertyPanel;
  rows: (p: HcPropertyPanel) => string[];
}> {
  const panel = document.createElement('hc-property-panel');
  panel.config = { widget: { type: 'device_grid', config }, edits: 'w' };
  panel.devices = [];
  panel.templates = templates;
  panel.onMakeTemplate = async () => 'made';
  // Core's real table, so the widget's own fields are described ones.
  panel.vocabulary = readVocabulary(fixture) as Vocabulary;
  document.body.append(panel);
  await panel.updateComplete;

  const rows = (p: HcPropertyPanel): string[] =>
    [...(p.shadowRoot?.querySelectorAll('.row .name') ?? [])].map((n) =>
      (n.textContent ?? '').trim().split('\n')[0]!.trim(),
    );
  return { panel, rows };
}

const tile = (config: Record<string, unknown>): WidgetTemplate => ({
  id: 'room-tile',
  widget: { type: 'device_grid', config },
});

describe('what a template asks for', () => {
  it('is whatever its subtree reads, not a list somebody kept in step', () => {
    // A declared list that can disagree with the subtree is a list that
    // eventually does, and the failure is an instance offering a parameter
    // nothing reads.
    expect(paramNames(tile({ area_name: '{{ params.room }}' }))).toEqual(['room']);
  });

  it('reaches into nested structure, where the interesting parts are', () => {
    // §5.4's own example puts the parameter inside a `$query`.
    const t = tile({ query: { area: ['{{ params.room }}'], kind: ['{{ params.kind }}'] } });
    expect(paramNames(t)).toEqual(['kind', 'room']);
  });

  it('reads an expression as readily as an interpolation', () => {
    // Substitution is P1's expression language, so both spellings are the
    // same feature and a template author uses whichever they already know.
    const t = tile({ title: { $expr: "params.room + ' lights'" } });
    expect(paramNames(t)).toEqual(['room']);
  });

  it('keeps a declared parameter that nothing reads yet', () => {
    // A default is a parameter whose value somebody chose not to require.
    const t: WidgetTemplate = { ...tile({}), params: [{ name: 'kind', default: 'light' }] };
    expect(paramNames(t)).toEqual(['kind']);
  });

  it('is nothing for a template with no parameters at all', () => {
    // Still a useful template: one styled tile, reused, edited once.
    expect(paramNames(tile({ area_name: 'kitchen' }))).toEqual([]);
  });

  it('does not mistake a word containing "params" for one', () => {
    expect(paramNames(tile({ text: '{{ paramsx }}' }))).toEqual([]);
    expect(paramNames(tile({ text: '{{ device.params }}' }))).toEqual([]);
  });

  it('names each parameter once however often it is read', () => {
    const t = tile({ a: '{{ params.room }}', b: '{{ params.room }}' });
    expect(paramNames(t)).toEqual(['room']);
  });
});

describe('a template id', () => {
  it('is an address, so it is tidy even when the name is not', () => {
    expect(templateId('Room tile!', [])).toBe('room-tile');
    expect(templateId('   ', [])).toBe('template');
  });

  it('numbers a collision rather than overwriting somebody else’s', () => {
    expect(templateId('Room tile', ['room-tile'])).toBe('room-tile-2');
    expect(templateId('Room tile', ['room-tile', 'room-tile-2'])).toBe('room-tile-3');
  });
});

describe('what the derived parameters are for', () => {
  it('names exactly what instantiating will substitute', () => {
    // The point of deriving them: the inputs offered on an instance are the
    // ones that change what it draws.
    const t = tile({ area_name: '{{ params.room }}', limit: 4 });
    expect(paramNames(t)).toEqual(['room']);
    expect(instantiate(t, { room: 'kitchen' }).config).toEqual({
      area_name: 'kitchen',
      limit: 4,
    });
  });
});

describe('a template is a starting point, not a link (§5.4)', () => {
  it('offers to make one from an ordinary widget', async () => {
    const { panel, rows } = await mountPanel({ text: 'Hall' }, new Templates([]));
    expect(rows(panel)).toContain('Template');
  });

  it('says nothing about where a widget came from', async () => {
    // **There is no "instance of" row, and that is the design.** Placing a
    // template stamps out an independent copy, so a widget made from one is an
    // ordinary widget with nothing extra to say about itself. The rows that
    // used to be here — the reference, its parameters, detach, edit the
    // definition — existed only to manage a link that no longer exists.
    const { panel, rows } = await mountPanel(
      { area_name: 'kitchen', limit: 4 },
      new Templates([tile({ area_name: '{{ params.room }}' })]),
    );
    expect(rows(panel)).not.toContain('Instance of');
    expect(rows(panel)).toContain('Limit');
  });

  it('draws the widget’s own fields, because they are its own', async () => {
    // Under the link model these were hidden: they belonged to the template
    // and editing them here would have written keys `instantiate` ignored.
    // A copy owns them.
    const { panel, rows } = await mountPanel(
      { area_name: 'kitchen', limit: 4 },
      new Templates([tile({})]),
    );
    expect(rows(panel)).toContain('Limit');
  });
});

describe('what placing a template produces', () => {
  it('is a plain config with the parameters already substituted', async () => {
    // "Applied, and then yours": the copy is wired and independent from the
    // moment it lands, and nothing in the document records the template.
    const t = tile({ area_name: '{{ params.room }}', limit: 4 });
    const stamped = instantiate(t, { room: 'kitchen' });
    expect(stamped.config).toEqual({ area_name: 'kitchen', limit: 4 });
    expect(stamped.config?.['template']).toBeUndefined();
  });

  it('leaves the template alone when the copy is edited', async () => {
    const t = tile({ area_name: '{{ params.room }}', limit: 4 });
    const stamped = instantiate(t, { room: 'kitchen' });
    (stamped.config as Record<string, unknown>)['limit'] = 99;
    expect(t.widget.config?.['limit']).toBe(4);
  });
});
