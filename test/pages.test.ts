/**
 * Making and copying a page.
 *
 * Possible at all only since pages moved into this client's own store: while
 * they lived in core, creating one meant asking core to hold a document that
 * was never core's.
 */
import { describe, expect, it } from 'vitest';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import { duplicatePage, newPage, pageId } from '../src/core/pages.js';
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
