/**
 * Making and copying a page.
 *
 * Possible at all only since pages moved into this client's own store: while
 * they lived in core, creating one meant asking core to hold a document that
 * was never core's.
 */
import { describe, expect, it } from 'vitest';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import {
  addWidget,
  duplicatePage,
  newPage,
  pageId,
  removeWidget,
  renamed,
} from '../src/core/pages.js';
import { layoutToDraw } from '../src/core/dashboard.js';

describe('a page id', () => {
  it('is an address, so it is tidy even when the name is not', () => {
    // An `on_tap` names one, and so does a link.
    expect(pageId('Upstairs Landing', [])).toBe('upstairs-landing');
    expect(pageId('  Kitchen & Pantry!  ', [])).toBe('kitchen-pantry');
  });

  it('does not collide, and does not refuse', () => {
    // A household with two pages called "Upstairs" gets both.
    expect(pageId('Upstairs', ['upstairs'])).toBe('upstairs-2');
    expect(pageId('Upstairs', ['upstairs', 'upstairs-2'])).toBe('upstairs-3');
  });

  it('has something to call a page named in symbols', () => {
    expect(pageId('!!!', [])).toBe('page');
    expect(pageId('', ['page'])).toBe('page-2');
  });
});

describe('a new page', () => {
  const page = newPage('Upstairs', [], 'user-1');

  it('can be edited the moment it exists', () => {
    // An empty page cannot be given a widget — placing one is the designer's
    // job and the designer is Phase 10 — so a page ships with the tool for
    // editing itself. The alternative is "you can make a page and then
    // nothing".
    expect(page.widgets?.map((w) => w.type)).toEqual(['heading', 'property_panel']);
    const panel = page.widgets?.find((w) => w.type === 'property_panel');
    expect(panel?.config?.['edits']).toBe('title');
  });

  it('is named what somebody typed, and addressed by a slug', () => {
    expect(page.name).toBe('Upstairs');
    expect(page.id).toBe('upstairs');
  });

  it('draws on a phone, from the one layout it carries', () => {
    // `layoutFor` falls back across breakpoints, so writing four copies of one
    // layout would be writing three of them wrong.
    expect(page.layouts).toHaveLength(1);
    expect(layoutToDraw(page, 'mobile')?.layout.placements).toHaveLength(2);
    expect(layoutToDraw(page, 'mobile')?.borrowedFrom).toBe('desktop');
  });
});

describe('duplicating a page', () => {
  const original: DashboardDefinition = {
    id: 'house',
    name: 'Every room',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [{ id: 'w', type: 'heading', config: { text: 'Hall' } }],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 120,
        gap: 12,
        placements: [{ widget_id: 'w', x: 0, y: 0, w: 12, h: 1 }],
      },
    ],
  };

  it('is a copy nothing is shared with', () => {
    // A shallow copy shares the widget objects, so editing the copy edits both
    // — and the two are in one array in one store, so it would be saved that
    // way too.
    const copy = duplicatePage(original, ['house']);
    (copy.widgets?.[0]?.config as Record<string, unknown>)['text'] = 'Changed';
    expect(original.widgets?.[0]?.config).toEqual({ text: 'Hall' });
  });

  it('keeps the widget ids, because they are addresses within the page', () => {
    // Renaming them would mean rewriting every placement and every `edits` a
    // panel carries, to fix a collision that cannot happen.
    const copy = duplicatePage(original, ['house']);
    expect(copy.widgets?.[0]?.id).toBe('w');
    expect(copy.layouts?.[0]?.placements?.[0]?.widget_id).toBe('w');
  });

  it('takes a new id and says it is a copy', () => {
    const copy = duplicatePage(original, ['house']);
    expect(copy.id).not.toBe('house');
    expect(copy.name).toBe('Every room copy');
  });
});

describe('putting a widget on a page', () => {
  const twoSizes: DashboardDefinition = {
    id: 'house',
    name: 'House',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [{ id: 'heading_1', type: 'heading', config: { text: 'Hall' } }],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 120,
        gap: 12,
        placements: [{ widget_id: 'heading_1', x: 0, y: 0, w: 12, h: 1 }],
      },
      {
        breakpoint: 'mobile',
        columns: 4,
        row_height: 120,
        gap: 12,
        placements: [{ widget_id: 'heading_1', x: 0, y: 0, w: 4, h: 1 }],
      },
    ],
  };

  it('places it in every layout the page has', () => {
    // A page that gained a widget in one layout is a page where a phone shows
    // less than a laptop, and nobody finds out until they pick up a phone.
    const { doc, id } = addWidget(twoSizes, 'device_grid');
    for (const layout of doc.layouts ?? []) {
      expect(layout.placements?.some((p) => p.widget_id === id)).toBe(true);
    }
  });

  it('puts it below what is already there, in that layout’s own units', () => {
    const { doc, id } = addWidget(twoSizes, 'device_grid');
    const desktop = doc.layouts?.[0]?.placements?.find((p) => p.widget_id === id);
    const mobile = doc.layouts?.[1]?.placements?.find((p) => p.widget_id === id);
    expect(desktop?.y).toBe(1);
    expect(desktop?.w).toBe(6);
    // Four columns is the whole width on a phone; six would be off the page.
    expect(mobile?.w).toBe(4);
  });

  it('gives a composed page a rect, because it ignores the grid', () => {
    const free: DashboardDefinition = {
      ...twoSizes,
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 120,
          gap: 12,
          flow: 'free',
          placements: [
            {
              widget_id: 'heading_1',
              x: 0,
              y: 0,
              w: 12,
              h: 1,
              rect: { x: 0, y: 0, w: 600, h: 48 },
            },
          ],
        },
      ],
    };
    const { doc, id } = addWidget(free, 'text');
    const placed = doc.layouts?.[0]?.placements?.find((p) => p.widget_id === id);
    expect(placed?.rect?.y).toBe(60);
    // The grid numbers are still filled in: they are what a client that has
    // never heard of frames draws.
    expect(placed?.w).toBe(6);
  });

  it('arrives with nothing in it', () => {
    // Inventing a plausible config would mean a widget that looks configured
    // and points at nothing.
    const { doc, id } = addWidget(twoSizes, 'device_grid');
    expect(doc.widgets?.find((w) => w.id === id)?.config).toEqual({});
  });

  it('does not take an id the page is already using', () => {
    const once = addWidget(twoSizes, 'heading');
    expect(once.id).toBe('heading_2');
    expect(addWidget(once.doc, 'heading').id).toBe('heading_3');
  });

  it('leaves the page it was given alone', () => {
    addWidget(twoSizes, 'device_grid');
    expect(twoSizes.widgets).toHaveLength(1);
    expect(twoSizes.layouts?.[0]?.placements).toHaveLength(1);
  });
});

describe('taking a widget off a page', () => {
  it('takes its placements with it', () => {
    // A placement naming a widget that is not there draws as nothing, in a
    // page with no way to tell why.
    const { doc, id } = addWidget(
      {
        id: 'p',
        name: 'P',
        icon: 'home',
        owner_user_id: 'u',
        widgets: [],
        layouts: [{ breakpoint: 'desktop', columns: 12, row_height: 120, gap: 12, placements: [] }],
      },
      'text',
    );

    const without = removeWidget(doc, id);
    expect(without.widgets).toEqual([]);
    expect(without.layouts?.[0]?.placements).toEqual([]);
  });
});

describe('renaming a page', () => {
  const page = newPage('Upstairs', [], 'u');

  it('leaves the id where it is', () => {
    // An `on_tap` targets one and a `dashboard_link` lists them: renaming a
    // page that others link to would break the links to fix a label.
    const next = renamed(page, 'Upstairs Landing');
    expect(next?.name).toBe('Upstairs Landing');
    expect(next?.id).toBe('upstairs');
  });

  it('is nothing to do when the name did not change', () => {
    // So a caller leaves the store alone rather than writing a document that
    // says the same thing.
    expect(renamed(page, 'Upstairs')).toBeUndefined();
    expect(renamed(page, '  Upstairs  ')).toBeUndefined();
    expect(renamed(page, '   ')).toBeUndefined();
  });

  it('keeps everything else about the page', () => {
    const next = renamed(page, 'Landing');
    expect(next?.widgets).toEqual(page.widgets);
    expect(next?.layouts).toEqual(page.layouts);
  });
});
