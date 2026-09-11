/**
 * The property panel's model, against core's real vocabulary.
 *
 * §4.4's rule is absolute — "every widget option must be editable in the GUI;
 * no widget ships that requires hand-editing JSON" — and it is the kind of
 * rule that is true when it is written and false a release later, because a
 * new field in core needs no change here to start being ignored. So the first
 * test below walks every field of every widget type core describes and asserts
 * a control for it, with the single exception named out loud.
 *
 * Refresh the fixture with `tool/sync-vocabulary-fixture.sh`.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/vocabulary.json' with { type: 'json' };
import {
  GESTURES,
  asList,
  problemsIn,
  propertiesFor,
  withValue,
  type Property,
} from '../src/core/properties.js';
import { readVocabulary, widgetSpec, type Vocabulary } from '../src/core/vocabulary.js';

const vocabulary = readVocabulary(fixture) as Vocabulary;
const spec = (type: string) => widgetSpec(vocabulary, type);

/** A config that satisfies every `when` at once is impossible; take them one at a time. */
const modes = ['manual', 'area', 'query', 'facet'];

describe('the vocabulary as served', () => {
  it('reads, and is the real thing rather than a stub', () => {
    expect(vocabulary.widgets.length).toBeGreaterThan(30);
    expect(vocabulary.enums.breakpoints).toContain('mobile');
    // §14.3 — an unknown type is legal, which is why the panel must edit one.
    expect(vocabulary.unknown_types_accepted).toBe(true);
  });

  it('lets every widget carry keys it does not describe', () => {
    // The round-trip rule and the two extra gestures both rest on this. If
    // core ever closed a widget, offering `on_hold` on it would be offering
    // an unsaveable config.
    for (const w of vocabulary.widgets) expect(w.extra_fields).toBe(true);
  });
});

describe('every option is editable', () => {
  it('gives every field of every widget type a control', () => {
    const opaque: string[] = [];

    for (const w of vocabulary.widgets) {
      for (const mode of modes) {
        // Walk each selection mode so the conditional fields are reached too.
        const config: Record<string, unknown> = { selection_mode: mode };
        for (const p of propertiesFor(w, config)) {
          if (p.form === 'opaque') opaque.push(`${w.type}.${p.name}`);
          expect(p.label).not.toBe('');
        }
      }
    }

    // One field in core's whole catalogue has structure and no description of
    // it: a floorplan's geometry, which is imported and edited on the plan
    // itself (§12), not typed into a panel. Pinned rather than tolerated — a
    // second entry here is a field somebody would otherwise have to hand-edit.
    expect([...new Set(opaque)]).toEqual(['floor_plan.plan']);
  });

  it('reaches every conditional field across the modes', () => {
    const grid = spec('device_grid');
    const reached = new Set(
      modes.flatMap((m) => propertiesFor(grid, { selection_mode: m }).map((p) => p.name)),
    );
    for (const f of grid?.fields ?? []) expect(reached).toContain(f.name);
  });
});

describe('a field that only sometimes applies', () => {
  const grid = spec('device_grid');

  it('is absent when its condition is not met', () => {
    const names = propertiesFor(grid, { selection_mode: 'manual' }).map((p) => p.name);
    expect(names).toContain('device_ids');
    expect(names).not.toContain('area_name');
    expect(names).not.toContain('query');
  });

  it('appears, and is required, when it is', () => {
    const area = propertiesFor(grid, { selection_mode: 'area' }).find(
      (p) => p.name === 'area_name',
    );
    expect(area?.required).toBe(true);
    expect(area?.suggest).toBe('area');
    // Nothing typed yet, and core would refuse the card. Said here, in the
    // field, rather than as a save that bounces.
    expect(area?.problem).toBe('Needs a value.');
  });
});

describe('what core constrains, and what it leaves open', () => {
  it('offers exactly core’s values where there is a closed set', () => {
    const sort = propertiesFor(spec('device_grid'), { selection_mode: 'manual' }).find(
      (p) => p.name === 'sort',
    );
    expect(sort?.form).toBe('select');
    expect(sort?.options).toEqual(['name', 'room', 'kind', 'on']);
  });

  it('only suggests where core does not constrain', () => {
    // A colour role this build has not learned must stay saveable: the picker
    // is a list of hints, and `options` is what makes a control a restriction.
    const ink = propertiesFor(spec('slider'), {}).find((p) => p.name === 'ink');
    expect(ink?.form).toBe('text');
    expect(ink?.suggest).toBe('role');
    expect(ink?.options).toBeUndefined();
  });

  it('takes the reference kind from core, not from the field’s name', () => {
    const device = propertiesFor(spec('slider'), {}).find((p) => p.name === 'device_id');
    expect(device?.suggest).toBe('device');
    const scenes = propertiesFor(spec('scene_row'), {}).find((p) => p.name === 'scene_ids');
    expect(scenes?.form).toBe('list');
    expect(scenes?.of).toBe('scene');
  });

  it('says which values are outside the shared vocabulary', () => {
    // Nothing downstream will refuse this — the page lives in this client's
    // own store — so a value another client cannot read has to be caught here
    // or not at all.
    const bad = problemsIn(spec('device_grid'), { selection_mode: 'sideways' });
    expect(bad).toContainEqual({
      name: 'selection_mode',
      problem: 'Not one of: manual, area, query, facet.',
    });
  });

  it('holds core’s lower bound', () => {
    const limit = propertiesFor(spec('device_grid'), {
      selection_mode: 'manual',
      limit: 0,
    }).find((p) => p.name === 'limit');
    expect(limit?.form).toBe('number');
    expect(limit?.min).toBe(1);
    expect(limit?.problem).toBe('At least 1.');
  });
});

describe('prose against a word', () => {
  it('gives a note room to be written in', () => {
    const md = propertiesFor(spec('markdown'), { markdown: '' }).find((p) => p.name === 'markdown');
    expect(md?.form).toBe('longText');
    // Required, and empty is a value: a note nobody has written yet is not a
    // broken card. Core says so with `allow_empty`; the panel must not
    // disagree and mark it a problem.
    expect(md?.required).toBe(true);
    expect(md?.allowEmpty).toBe(true);
    expect(md?.problem).toBeUndefined();
  });

  it('refuses an empty required string that does not allow it', () => {
    const text = propertiesFor(spec('heading'), { text: '   ' }).find((p) => p.name === 'text');
    expect(text?.problem).toBe('Needs a value.');
  });
});

describe('gestures', () => {
  it('offers all three, though core describes one', () => {
    const names = propertiesFor(spec('heading'), {}).map((p) => p.name);
    for (const g of GESTURES) expect(names).toContain(g);
    expect(propertiesFor(spec('heading'), {}).find((p) => p.name === 'on_hold')?.form).toBe(
      'action',
    );
  });

  it('draws the described one as an action too, not as an object', () => {
    const tap = propertiesFor(spec('heading'), {}).find((p) => p.name === 'on_tap');
    expect(tap?.form).toBe('action');
  });
});

describe('a config with keys nothing describes', () => {
  const config = { text: 'Hall', style: { tint: 'warm' }, wobble: true, extras: ['a', 'b'] };

  it('lists them, shaped by what they hold', () => {
    const props = propertiesFor(spec('heading'), config);
    const by = (n: string): Property | undefined => props.find((p) => p.name === n);
    expect(by('wobble')?.form).toBe('toggle');
    expect(by('wobble')?.undescribed).toBe(true);
    expect(by('extras')?.form).toBe('list');
    expect(by('style')?.form).toBe('pairs');
  });

  it('keeps them through an edit', () => {
    // The failure this prevents: a panel that saves back only what it
    // understood, deleting another client's drawing preferences every time
    // somebody opens it.
    const props = propertiesFor(spec('heading'), config);
    const text = props.find((p) => p.name === 'text');
    const next = withValue(config, text!, 'Hallway');
    expect(next).toEqual({ ...config, text: 'Hallway' });
  });

  it('edits a widget type core has never heard of', () => {
    // No spec at all: still fully editable, just unlabelled and unchecked.
    const props = propertiesFor(undefined, { caption: 'x', big: true });
    // The gestures and the layer: the keys core describes for nobody and every
    // client uses, offered wherever extra fields are legal.
    expect(props.map((p) => p.name)).toEqual([...GESTURES, 'layer', 'big', 'caption']);
    expect(props.every((p) => p.problem === undefined)).toBe(true);
  });
});

describe('writing a value back', () => {
  const optional = { name: 'sort', required: false, allowEmpty: false };

  it('removes an optional field rather than storing nothing', () => {
    expect(withValue({ sort: 'name', limit: 3 }, optional, '')).toEqual({ limit: 3 });
    expect(withValue({ sort: 'name' }, optional, undefined)).toEqual({});
  });

  it('keeps an empty value where the emptiness is the value', () => {
    const md = { name: 'markdown', required: true, allowEmpty: true };
    expect(withValue({ markdown: 'x' }, md, '')).toEqual({ markdown: '' });
  });

  it('writes one value back the way the document writes it', () => {
    const facet = { name: 'facet', required: true, allowEmpty: false, scalarOk: true };
    expect(withValue({}, facet, ['light'])).toEqual({ facet: 'light' });
    expect(withValue({}, facet, ['light', 'switch'])).toEqual({ facet: ['light', 'switch'] });
    expect(withValue({ facet: 'light' }, facet, [])).toEqual({});
  });

  it('reads a list whichever way it is stored', () => {
    expect(asList('light')).toEqual(['light']);
    expect(asList(['light', 'switch'])).toEqual(['light', 'switch']);
    expect(asList(undefined)).toEqual([]);
  });
});

describe('with no vocabulary at all', () => {
  it('reads nothing out of rubbish rather than throwing', () => {
    expect(readVocabulary(undefined)).toBeUndefined();
    expect(readVocabulary({ widgets: 'no' })).toBeUndefined();
    // A panel offline (§16) has no vocabulary and must still edit the page it
    // has cached.
    expect(widgetSpec(undefined, 'heading')).toBeUndefined();
    expect(propertiesFor(undefined, { text: 'Hall' }).length).toBeGreaterThan(0);
  });
});

describe('lifting an element above the grid (§14.1)', () => {
  it('is offered as a choice, not typed as a word', () => {
    // It showed up as an undescribed text field on documents that already had
    // it, and not at all on documents that did not — so a lifted card could
    // only be made by hand in another editor.
    const layer = propertiesFor(undefined, {}).find((p) => p.name === 'layer');
    expect(layer?.form).toBe('select');
    expect(layer?.options).toEqual(['grid', 'free']);
  });

  it('shows what the document already says', () => {
    const layer = propertiesFor(undefined, { layer: 'free' }).find((p) => p.name === 'layer');
    expect(layer?.value).toBe('free');
    // Once only: the undescribed sweep must not offer it a second time.
    expect(
      propertiesFor(undefined, { layer: 'free' }).filter((p) => p.name === 'layer'),
    ).toHaveLength(1);
  });

  it('clears back to the grid rather than storing a word for the default', () => {
    // `withValue` drops an optional field set to nothing, so a card put back
    // on the grid carries no `layer` at all — which is what every document
    // that never lifted anything already looks like.
    const layer = propertiesFor(undefined, { layer: 'free' }).find((p) => p.name === 'layer');
    expect(withValue({ layer: 'free' }, layer!, '')).toEqual({});
  });

  it('is not offered where core has closed the widget to extra fields', () => {
    // §5.11's shape again: not offered rather than offered and refused.
    const closed = { type: 'heading', config_required: false, extra_fields: false, fields: [] };
    expect(propertiesFor(closed, {}).some((p) => p.name === 'layer')).toBe(false);
  });
});
