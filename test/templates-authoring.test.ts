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
  panel.onDetachTemplate = async () => undefined;
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

describe('the panel on a template instance', () => {
  it('offers the parameters and hides the plumbing', async () => {
    // An instance's own keys are `template` and `params`; the fields it draws
    // are the template's, and editing those here would be editing every
    // instance — deliberate, not something a panel does when opened.
    const { panel, rows } = await mountPanel(
      { template: 'room-tile', params: { room: 'kitchen' } },
      new Templates([tile({ area_name: '{{ params.room }}' })]),
    );
    expect(rows(panel)).toContain('Instance of');
    expect(rows(panel)).toContain('Room');
    expect(rows(panel)).not.toContain('Template');
    expect(rows(panel)).not.toContain('Params');
  });

  it('draws none of the widget type’s own fields', async () => {
    // They belong to the template. A control for one here would write a key
    // `instantiate` then ignores — offered and refused, from an unusual
    // direction.
    const { panel, rows } = await mountPanel(
      { template: 'room-tile' },
      new Templates([tile({ area_name: '{{ params.room }}' })]),
    );
    expect(rows(panel)).not.toContain('Selection mode');
    expect(rows(panel)).not.toContain('Limit');
    expect(rows(panel)).not.toContain('On tap');
  });

  it('says plainly when a template takes none', async () => {
    const { panel, rows } = await mountPanel(
      { template: 'room-tile' },
      new Templates([tile({ area_name: 'kitchen' })]),
    );
    expect(rows(panel)).toContain('Instance of');
    expect(panel.shadowRoot?.textContent).toContain('takes no parameters');
  });

  it('says so when the template it names is gone', async () => {
    // A page silently drawing nothing is how a broken reference hides.
    const { panel } = await mountPanel({ template: 'missing' }, new Templates([]));
    expect(panel.shadowRoot?.querySelector('.problem')?.textContent).toContain('No template');
  });

  it('writes one parameter without disturbing the others', async () => {
    const { panel } = await mountPanel(
      { template: 'room-tile', params: { room: 'kitchen', kind: 'light' } },
      new Templates([tile({ a: '{{ params.room }}', b: '{{ params.kind }}' })]),
    );
    let written: Record<string, unknown> | undefined;
    panel.onEditWidget = (next) => {
      written = next.config as Record<string, unknown>;
    };

    const input = [...(panel.shadowRoot?.querySelectorAll('input') ?? [])].find(
      (i) => i.getAttribute('aria-label') === 'Room',
    ) as HTMLInputElement;
    input.value = 'hall';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(written).toEqual({ template: 'room-tile', params: { room: 'hall', kind: 'light' } });
  });

  it('drops a parameter cleared to nothing, so the default stands', async () => {
    const { panel } = await mountPanel(
      { template: 'room-tile', params: { room: 'kitchen' } },
      new Templates([tile({ a: '{{ params.room }}' })]),
    );
    let written: Record<string, unknown> | undefined;
    panel.onEditWidget = (next) => {
      written = next.config as Record<string, unknown>;
    };

    const input = [...(panel.shadowRoot?.querySelectorAll('input') ?? [])].find(
      (i) => i.getAttribute('aria-label') === 'Room',
    ) as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(written).toEqual({ template: 'room-tile' });
  });

  it('offers to make a template of a widget that is not one', async () => {
    const { panel, rows } = await mountPanel({ text: 'Hall' }, new Templates([]));
    expect(rows(panel)).toContain('Template');
    expect(rows(panel)).not.toContain('Instance of');
  });
});

describe('editing the template itself', () => {
  it('shows the template’s fields instead of the instance’s parameters', async () => {
    const templates = new Templates([tile({ area_name: '{{ params.room }}', limit: 4 })]);
    const { panel, rows } = await mountPanel({ template: 'room-tile' }, templates);
    panel.onSaveTemplate = async () => undefined;
    await panel.updateComplete;

    const edit = [...(panel.shadowRoot?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Edit the template',
    ) as HTMLButtonElement;
    expect(edit, 'no way to edit the template').not.toBeUndefined();
    edit.click();
    await panel.updateComplete;

    // The type's own fields are exactly what is wanted now.
    expect(rows(panel)).toContain('Limit');
    expect(rows(panel)).not.toContain('Instance of');
    expect(panel.shadowRoot?.textContent).toContain('every instance of it follows');
  });

  it('writes to the template, not to the placement that named it', async () => {
    // The whole difference between a reference and a copy.
    const templates = new Templates([tile({ area_name: '{{ params.room }}', limit: 4 })]);
    const { panel } = await mountPanel({ template: 'room-tile' }, templates);
    const saved: { id: string; config: unknown }[] = [];
    const edits: unknown[] = [];
    panel.onSaveTemplate = async (id, widget) => {
      saved.push({ id, config: widget.config });
    };
    panel.onEditWidget = (next) => edits.push(next);
    await panel.updateComplete;

    (
      [...(panel.shadowRoot?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent?.trim() === 'Edit the template',
      ) as HTMLButtonElement
    ).click();
    await panel.updateComplete;

    const limit = [...(panel.shadowRoot?.querySelectorAll('input') ?? [])].find(
      (i) => i.getAttribute('aria-label') === 'Limit',
    ) as HTMLInputElement;
    limit.value = '2';
    limit.dispatchEvent(new Event('input', { bubbles: true }));

    expect(saved.at(-1)?.id).toBe('room-tile');
    expect((saved.at(-1)?.config as Record<string, unknown>)['limit']).toBe(2);
    // And nothing was written to the placement.
    expect(edits).toHaveLength(0);
  });

  it('goes back to the instance when it is done', async () => {
    const templates = new Templates([tile({ area_name: '{{ params.room }}' })]);
    const { panel, rows } = await mountPanel({ template: 'room-tile' }, templates);
    panel.onSaveTemplate = async () => undefined;
    await panel.updateComplete;

    (
      [...(panel.shadowRoot?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent?.trim() === 'Edit the template',
      ) as HTMLButtonElement
    ).click();
    await panel.updateComplete;
    (
      [...(panel.shadowRoot?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent?.trim() === 'Done',
      ) as HTMLButtonElement
    ).click();
    await panel.updateComplete;

    expect(rows(panel)).toContain('Instance of');
    expect(rows(panel)).toContain('Room');
  });

  it('offers no way in where the host cannot write templates', async () => {
    // §5.11 again: not offered rather than offered and refused.
    const templates = new Templates([tile({ area_name: '{{ params.room }}' })]);
    const { panel } = await mountPanel({ template: 'room-tile' }, templates);
    panel.onSaveTemplate = undefined;
    await panel.updateComplete;
    const edit = [...(panel.shadowRoot?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Edit the template',
    );
    expect(edit).toBeUndefined();
  });
});
