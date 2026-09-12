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
  moveGroupBox,
  frameGroup,
  sizeGroupBox,
  boxOf,
  duplicatePage,
  newPage,
  pageId,
  placeWidget,
  removeWidget,
  renamed,
  type Box,
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

describe('moving a widget', () => {
  const desktopOnly: DashboardDefinition = {
    id: 'house',
    name: 'House',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [{ id: 'w', type: 'text', config: {} }],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 120,
        gap: 12,
        placements: [{ widget_id: 'w', x: 0, y: 0, w: 6, h: 2 }],
      },
    ],
  };

  it('writes into the layout on screen, borrowed or not', () => {
    // A phone borrows the desktop arrangement (§5.7). Writing the numbers
    // into a new mobile layout would silently split one arrangement into two,
    // and nobody asked for a per-breakpoint design by moving something on a
    // phone.
    const moved = placeWidget(desktopOnly, 'mobile', 'w', { x: 2, y: 3, w: 4, h: 1 });
    expect(moved?.layouts).toHaveLength(1);
    expect(moved?.layouts?.[0]?.breakpoint).toBe('desktop');
    expect(moved?.layouts?.[0]?.placements?.[0]).toMatchObject({ x: 2, y: 3, w: 4, h: 1 });
  });

  it('writes a rect on a composed page, because it ignores the grid', () => {
    const composed: DashboardDefinition = {
      ...desktopOnly,
      layouts: [
        {
          ...desktopOnly.layouts![0]!,
          flow: 'free',
          placements: [
            { widget_id: 'w', x: 0, y: 0, w: 6, h: 2, rect: { x: 0, y: 0, w: 100, h: 50 } },
          ],
        },
      ],
    };
    const moved = placeWidget(composed, 'desktop', 'w', { x: 20, y: 40, w: 300, h: 120 });
    expect(moved?.layouts?.[0]?.placements?.[0]?.rect).toEqual({ x: 20, y: 40, w: 300, h: 120 });
  });

  it('is nothing to do for a widget that layout does not have', () => {
    expect(placeWidget(desktopOnly, 'desktop', 'nope', { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
  });

  it('leaves the page it was given alone', () => {
    placeWidget(desktopOnly, 'desktop', 'w', { x: 9, y: 9, w: 1, h: 1 });
    expect(desktopOnly.layouts?.[0]?.placements?.[0]?.x).toBe(0);
  });

  it('reads back the numbers in the units that layout uses', () => {
    expect(boxOf(desktopOnly.layouts?.[0], 'w')).toEqual({
      box: { x: 0, y: 0, w: 6, h: 2 },
      units: 'cells',
    });
    expect(boxOf(desktopOnly.layouts?.[0], 'nope')).toBeUndefined();
  });
});

describe('drawing a widget, which is adding and placing at once (§14.1)', () => {
  /**
   * What `hc-app.drawWidgetOnPage` does, in the two calls it makes.
   *
   * Pinned here rather than in the shell because the composition is the part
   * that can be wrong: the box belongs to the layout on screen, and every
   * other layout keeps the placement `addWidget` gave it. Where a widget sits
   * may differ per size; whether it exists may not.
   */
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

  const drawn = (breakpoint: 'desktop' | 'mobile', box: Box) => {
    const { doc, id } = addWidget(twoSizes, 'toggle');
    return { doc: placeWidget(doc, breakpoint, id, box) ?? doc, id };
  };

  const placementIn = (doc: DashboardDefinition, breakpoint: string, id: string) =>
    doc.layouts
      ?.find((l) => l.breakpoint === breakpoint)
      ?.placements?.find((p) => p.widget_id === id);

  it('lands where it was drawn, in the layout that was on screen', () => {
    const { doc, id } = drawn('desktop', { x: 3, y: 2, w: 4, h: 3 });
    expect(placementIn(doc, 'desktop', id)).toMatchObject({ x: 3, y: 2, w: 4, h: 3 });
  });

  it('still exists on every other size, below what is there', () => {
    // Drawing on a laptop must not leave a phone showing less. It is not in
    // the same place — nobody drew it there — but it is on the page.
    const { doc, id } = drawn('desktop', { x: 3, y: 2, w: 4, h: 3 });
    const onPhone = placementIn(doc, 'mobile', id);
    expect(onPhone).toBeDefined();
    expect(onPhone?.y).toBe(1);
  });

  it('writes into the layout being borrowed, not into a new one', () => {
    // A page with only a desktop layout, drawn on from a phone: §5.7 says the
    // phone borrows desktop, and the edit has to land where the numbers came
    // from or the page silently splits into two arrangements.
    const desktopOnly: DashboardDefinition = {
      ...twoSizes,
      layouts: [twoSizes.layouts![0]!],
    };
    const { doc, id } = addWidget(desktopOnly, 'toggle');
    const next = placeWidget(doc, 'mobile', id, { x: 1, y: 1, w: 2, h: 2 });

    expect(next?.layouts).toHaveLength(1);
    expect(placementIn(next!, 'desktop', id)).toMatchObject({ x: 1, y: 1, w: 2, h: 2 });
  });

  it('draws into a composed page by rect, leaving the cells it fell back to', () => {
    const composed: DashboardDefinition = {
      ...twoSizes,
      layouts: [
        {
          ...twoSizes.layouts![0]!,
          flow: 'free',
          frame: { width: 1240, height: 1248, fit: 'scroll' },
        },
      ],
    };
    const { doc, id } = addWidget(composed, 'text');
    const next = placeWidget(doc, 'desktop', id, { x: 100, y: 100, w: 300, h: 200 });
    expect(placementIn(next!, 'desktop', id)?.rect).toEqual({ x: 100, y: 100, w: 300, h: 200 });
  });
});

describe('giving a group a body, and taking it away again', () => {
  // §19.9: every option is GUI-editable and no widget ships that requires
  // hand-editing JSON. The nine sections on the household's room page were
  // made by editing the document, because Group writes a tag and nothing in
  // the product could give one a body.
  const doc = (): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [
      { id: 'head', type: 'text', config: { group: 'Doors' } },
      { id: 'list', type: 'device_list', config: { group: 'Doors' } },
      { id: 'loose', type: 'text', config: {} },
    ],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 100,
        gap: 10,
        flow: 'free',
        frame: { width: 1240, height: 900 },
        placements: [
          { widget_id: 'head', x: 0, y: 0, w: 1, h: 1, rect: { x: 40, y: 100, w: 300, h: 18 } },
          { widget_id: 'list', x: 0, y: 0, w: 1, h: 1, rect: { x: 40, y: 130, w: 700, h: 60 } },
          { widget_id: 'loose', x: 0, y: 0, w: 1, h: 1, rect: { x: 900, y: 0, w: 100, h: 40 } },
        ],
      },
    ],
  });

  const boxes = (d: DashboardDefinition) => d.layouts?.[0]?.groups ?? [];
  const rect = (d: DashboardDefinition, id: string) =>
    d.layouts?.[0]?.placements?.find((p) => p.widget_id === id)?.rect;

  it('puts the box round exactly what its members cover', async () => {
    const made = frameGroup(doc(), 'desktop', 'Doors', 'column');
    expect(made, 'nothing written').not.toBeUndefined();
    expect(boxes(made!)[0]).toMatchObject({
      path: 'Doors',
      frame: true,
      stack: true,
      rect: { x: 40, y: 100, w: 700, h: 90 },
    });
  });

  it('restates its members in the space the box just made', async () => {
    // A member's rect is stated in the space of its nearest framed ancestor,
    // and the box is now that ancestor. Leaving them in page coordinates would
    // move everything inside it by the frame's own offset.
    const made = frameGroup(doc(), 'desktop', 'Doors', 'column')!;
    expect(rect(made, 'head')).toEqual({ x: 0, y: 0, w: 300, h: 18 });
    expect(rect(made, 'list')).toEqual({ x: 0, y: 30, w: 700, h: 60 });
  });

  it('leaves everything outside the group alone', async () => {
    const made = frameGroup(doc(), 'desktop', 'Doors', 'column')!;
    expect(rect(made, 'loose')).toEqual({ x: 900, y: 0, w: 100, h: 40 });
  });

  it('takes the gap from the gaps its author drew', async () => {
    // A column spaces its members evenly and the drawn ones are not, so this
    // is the one thing that has to be chosen rather than carried.
    const made = frameGroup(doc(), 'desktop', 'Doors', 'column')!;
    expect(boxes(made)[0]?.stack_gap).toBe(12);
  });

  it('comes back byte-identical when it is taken away', async () => {
    // The same invariant group-then-ungroup keeps, and the reason a household
    // can try this on a real page without wondering what it cost.
    const before = doc();
    const made = frameGroup(before, 'desktop', 'Doors', 'column')!;
    const back = frameGroup(made, 'desktop', 'Doors', undefined)!;
    expect(back.layouts?.[0]?.placements).toEqual(before.layouts?.[0]?.placements);
    expect(boxes(back)).toEqual([]);
  });

  it('writes nothing when there is nothing to do', async () => {
    const made = frameGroup(doc(), 'desktop', 'Doors', 'column')!;
    expect(frameGroup(made, 'desktop', 'Doors', 'column')).toBeUndefined();
    expect(frameGroup(doc(), 'desktop', 'Doors', undefined)).toBeUndefined();
    expect(frameGroup(doc(), 'desktop', 'Nothing', 'column')).toBeUndefined();
  });

  it('declines on a packed page, where the engine would undo it', async () => {
    // A column of rectangles is not expressible in cells, and grid mode has an
    // engine that immediately re-packs (§14.1).
    const packed = doc();
    packed.layouts![0]!.flow = 'packed';
    expect(frameGroup(packed, 'desktop', 'Doors', 'column')).toBeUndefined();
  });

  it('gathers a nested group too, because a path is the membership', async () => {
    const deep = doc();
    deep.widgets![0]!.config = { group: 'Doors/Head' };
    const made = frameGroup(deep, 'desktop', 'Doors', 'column')!;
    expect(rect(made, 'head')).toEqual({ x: 0, y: 0, w: 300, h: 18 });
  });
});

describe('moving a container', () => {
  const doc = (): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [{ id: 'a', type: 'text', config: { group: 'Doors' } }],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 100,
        gap: 10,
        flow: 'free',
        frame: { width: 1240, height: 900 },
        groups: [
          { path: 'Doors', rect: { x: 0, y: 520, w: 723, h: 60 }, frame: true, stack: true },
        ],
        placements: [
          { widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 20, w: 300, h: 18 } },
        ],
      },
    ],
  });

  it('writes the box and nothing inside it', async () => {
    // A member's rectangle is stated in the container's space, so moving all
    // of them moves them *within* it and leaves the box where it was — which
    // on a column does not even show.
    const next = moveGroupBox(doc(), 'desktop', 'Doors', { x: 0, y: 150 })!;
    expect(next.layouts?.[0]?.groups?.[0]?.rect).toEqual({ x: 0, y: 670, w: 723, h: 60 });
    expect(next.layouts?.[0]?.placements?.[0]?.rect).toEqual({ x: 0, y: 20, w: 300, h: 18 });
  });

  it('is reordering, when the container is in a column', async () => {
    // A column is ordered by its members' stored tops, so dragging a section
    // up or down the column moves it up or down the column. One write, two
    // readings, and the parent decides which.
    const next = moveGroupBox(doc(), 'desktop', 'Doors', { x: 0, y: 150 })!;
    expect(next.layouts?.[0]?.groups?.[0]?.rect?.y).toBeGreaterThan(520);
  });

  it('writes nothing for a box that is not there, or a move that is not one', async () => {
    expect(moveGroupBox(doc(), 'desktop', 'Nothing', { x: 10, y: 10 })).toBeUndefined();
    expect(moveGroupBox(doc(), 'desktop', 'Doors', { x: 0, y: 0 })).toBeUndefined();
  });
});

describe('resizing a container', () => {
  const doc = (): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [{ id: 'a', type: 'text', config: { group: 'Left' } }],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 100,
        gap: 10,
        flow: 'free',
        frame: { width: 1240, height: 900 },
        groups: [
          { path: 'Left', rect: { x: 0, y: 180, w: 767, h: 1062 }, frame: true, stack: true },
        ],
        placements: [
          { widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 20, w: 700, h: 40 } },
        ],
      },
    ],
  });

  it('writes the box and leaves the rows to reflow', async () => {
    // Narrowing a column is how a set of rows goes from three across to two,
    // and the rows have no say in it.
    const next = sizeGroupBox(doc(), 'desktop', 'Left', { x: 0, y: 180, w: 400, h: 1062 })!;
    expect(next.layouts?.[0]?.groups?.[0]?.rect).toEqual({ x: 0, y: 180, w: 400, h: 1062 });
    expect(next.layouts?.[0]?.placements?.[0]?.rect).toEqual({ x: 0, y: 20, w: 700, h: 40 });
  });

  it('never writes a box with no width or no height', async () => {
    const next = sizeGroupBox(doc(), 'desktop', 'Left', { x: 0, y: 180, w: -40, h: 0 })!;
    expect(next.layouts?.[0]?.groups?.[0]?.rect).toMatchObject({ w: 1, h: 1 });
  });

  it('writes nothing when the rectangle is the one already there', async () => {
    expect(
      sizeGroupBox(doc(), 'desktop', 'Left', { x: 0, y: 180, w: 767, h: 1062 }),
    ).toBeUndefined();
    expect(sizeGroupBox(doc(), 'desktop', 'Nothing', { x: 0, y: 0, w: 10, h: 10 })).toBeUndefined();
  });
});

describe('the other kind of body, and switching between them', () => {
  // A band is a row of things side by side that is still as tall as what is in
  // it, which is what the house's footer is and what no amount of column would
  // express.
  const doc = (): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [
      { id: 'modes', type: 'mode_chips', config: { group: 'Foot' } },
      { id: 'scenes', type: 'scene_row', config: { group: 'Foot' } },
    ],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 100,
        gap: 10,
        flow: 'free',
        frame: { width: 1240, height: 900 },
        placements: [
          { widget_id: 'modes', x: 0, y: 0, w: 1, h: 1, rect: { x: 22, y: 1070, w: 320, h: 56 } },
          {
            widget_id: 'scenes',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            rect: { x: 372, y: 1070, w: 846, h: 120 },
          },
        ],
      },
    ],
  });

  const box = (d: DashboardDefinition) => d.layouts?.[0]?.groups?.[0];
  const rects = (d: DashboardDefinition) => d.layouts?.[0]?.placements?.map((p) => p.rect);

  it('is as tall as what is in it, and lays nothing out', async () => {
    const made = frameGroup(doc(), 'desktop', 'Foot', 'band')!;
    expect(box(made)).toMatchObject({ path: 'Foot', frame: true, fit: 'content' });
    expect(box(made)?.stack).not.toBe(true);
  });

  it('keeps its members side by side, where they were drawn', async () => {
    // The whole difference from a column: a band honours the tops and the
    // lefts, so two things beside each other stay beside each other.
    const made = frameGroup(doc(), 'desktop', 'Foot', 'band')!;
    expect(rects(made)).toEqual([
      { x: 0, y: 0, w: 320, h: 56 },
      { x: 350, y: 0, w: 846, h: 120 },
    ]);
  });

  it('changes into a column without moving anything', async () => {
    // Two keys on the same box: a member's rect is stated in the box's space
    // either way, so switching is arithmetic-free and switching back gets the
    // arrangement it started with.
    const band = frameGroup(doc(), 'desktop', 'Foot', 'band')!;
    const column = frameGroup(band, 'desktop', 'Foot', 'column')!;
    expect(rects(column)).toEqual(rects(band));
    expect(box(column)).toMatchObject({ stack: true, fit: null });
    expect(box(column)?.rect).toEqual(box(band)?.rect);

    const back = frameGroup(column, 'desktop', 'Foot', 'band')!;
    expect(rects(back)).toEqual(rects(band));
  });

  it('comes back byte-identical from either kind', async () => {
    const before = doc();
    for (const as of ['band', 'column'] as const) {
      const made = frameGroup(before, 'desktop', 'Foot', as)!;
      const back = frameGroup(made, 'desktop', 'Foot', undefined)!;
      expect(back.layouts?.[0]?.placements, as).toEqual(before.layouts?.[0]?.placements);
      expect(back.layouts?.[0]?.groups, as).toEqual([]);
    }
  });

  it('writes nothing when it is already the kind asked for', async () => {
    const made = frameGroup(doc(), 'desktop', 'Foot', 'band')!;
    expect(frameGroup(made, 'desktop', 'Foot', 'band')).toBeUndefined();
  });
});
