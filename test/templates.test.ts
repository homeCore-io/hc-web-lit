/**
 * P3 — widget templates (§5.4).
 *
 * The two things that have to be right are the two §5.4 argues about: that
 * substitution reaches the nested parts, and that an instance is a *reference*
 * rather than a copy — one edit landing everywhere is the whole reason to have
 * this rather than duplicating a widget twelve times.
 */
import { describe, expect, it } from 'vitest';
import {
  Templates,
  instantiate,
  paramsFor,
  resolveInstance,
  templateRef,
  type WidgetTemplate,
} from '../src/core/templates.js';

const roomTile: WidgetTemplate = {
  id: 'room-tile',
  params: [
    { name: 'room', type: 'room' },
    { name: 'icon', type: 'asset', default: 'icons/room.svg' },
  ],
  widget: {
    type: 'device_grid',
    config: {
      selection_mode: 'area',
      area_name: '{{ params.room }}',
      icon: '{{ params.icon }}',
      style: { titled: false, heading: '{{ params.room }} lights' },
      facet: ['lights'],
    },
  },
};

describe('recognising an instance', () => {
  it('reads a reference off a config', () => {
    expect(templateRef({ template: 'room-tile', params: { room: 'office' } })).toEqual({
      template: 'room-tile',
      params: { room: 'office' },
    });
  });

  it('has no opinion about an ordinary widget', () => {
    expect(templateRef({ type: 'text' })).toBeUndefined();
    expect(templateRef(undefined)).toBeUndefined();
  });
});

describe('parameters', () => {
  it('takes the instance over the declared default', () => {
    expect(paramsFor(roomTile, { room: 'office' })).toEqual({
      room: 'office',
      icon: 'icons/room.svg',
    });
    expect(paramsFor(roomTile, { room: 'office', icon: 'x.svg' })['icon']).toBe('x.svg');
  });
});

describe('instantiating', () => {
  it('substitutes through the nested parts, not just the top level', () => {
    // §5.4's own example puts a parameter inside a nested object; a
    // substitution that only walked the first level would miss it.
    const spec = instantiate(roomTile, { room: 'office' });
    expect(spec.config?.['area_name']).toBe('office');
    expect((spec.config?.['style'] as Record<string, unknown>)['heading']).toBe('office lights');
  });

  it('leaves alone what has no parameter in it', () => {
    const spec = instantiate(roomTile, { room: 'office' });
    expect(spec.config?.['selection_mode']).toBe('area');
    expect(spec.config?.['facet']).toEqual(['lights']);
  });

  it('uses the same expression language as everything else', () => {
    const t: WidgetTemplate = {
      id: 't',
      params: [{ name: 'n' }],
      widget: { type: 'text', config: { text: { $expr: 'params.n * 2' } } },
    };
    expect(instantiate(t, { n: 21 }).config?.['text']).toBe(42);
  });
});

describe('by reference, not by copy', () => {
  it('follows an edit to the template', () => {
    // The distinction §5.4 draws: a dashboard template is copied because a
    // page you began from should not change under you; a widget template is
    // the opposite case, and this is what makes it so.
    const store = new Templates([roomTile]);
    const first = resolveInstance(
      { type: 'template', config: { template: 'room-tile', params: { room: 'office' } } },
      store,
    );
    expect(first).toEqual({
      spec: expect.objectContaining({ type: 'device_grid' }),
    });

    store.add({
      ...roomTile,
      widget: { type: 'device_list', config: roomTile.widget.config ?? {} },
    });
    const second = resolveInstance(
      { type: 'template', config: { template: 'room-tile', params: { room: 'office' } } },
      store,
    );
    expect(second).toEqual({ spec: expect.objectContaining({ type: 'device_list' }) });
  });

  it('says a reference is broken rather than drawing nothing', () => {
    // A page quietly missing a widget is how a broken reference hides.
    expect(
      resolveInstance({ type: 'template', config: { template: 'gone' } }, new Templates()),
    ).toEqual({ missing: 'gone' });
  });

  it('passes an ordinary widget straight through', () => {
    expect(resolveInstance({ type: 'text', config: {} }, new Templates())).toBeUndefined();
  });
});
