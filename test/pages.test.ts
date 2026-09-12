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
  clipGroup,
  reparentGroup,
  reparentWidgets,
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

describe('dragging a widget into a container, and out of one', () => {
  // The hole containers left: membership only ever changed through Group and
  // Ungroup, so moving a card from one section to another meant dissolving the
  // first section and rebuilding it — on pages where the sections are the
  // design.
  const doc = (): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [
      { id: 'head', type: 'text', config: { group: 'Left' } },
      { id: 'list', type: 'device_list', config: { group: 'Left' } },
      { id: 'chip', type: 'text', config: { group: 'Foot' } },
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
        groups: [
          // A column at x 40, y 100, so its space is offset from the page's in
          // both directions — an origin of zero would hide every conversion
          // bug this is here to catch.
          {
            path: 'Left',
            rect: { x: 40, y: 100, w: 700, h: 400 },
            frame: true,
            stack: true,
            stack_gap: 10,
          },
          { path: 'Foot', rect: { x: 40, y: 600, w: 700, h: 80 }, frame: true, fit: 'content' },
        ],
        placements: [
          { widget_id: 'head', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 20 } },
          { widget_id: 'list', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 30, w: 700, h: 60 } },
          { widget_id: 'chip', x: 0, y: 0, w: 1, h: 1, rect: { x: 10, y: 10, w: 120, h: 40 } },
          { widget_id: 'loose', x: 0, y: 0, w: 1, h: 1, rect: { x: 900, y: 0, w: 100, h: 40 } },
        ],
      },
    ],
  });

  const rect = (d: DashboardDefinition, id: string) =>
    d.layouts?.[0]?.placements?.find((p) => p.widget_id === id)?.rect;
  const group = (d: DashboardDefinition, id: string) =>
    d.widgets?.find((w) => w.id === id)?.config?.['group'];
  const box = (d: DashboardDefinition, path: string) =>
    d.layouts?.[0]?.groups?.find((b) => b.path === path);
  const order = (d: DashboardDefinition, path: string) =>
    (d.widgets ?? [])
      .filter((w) => w.config?.['group'] === path)
      .map((w) => ({ id: w.id, y: rect(d, w.id)?.y ?? 0 }))
      .sort((a, b) => a.y - b.y)
      .map((r) => r.id);

  it('writes the membership and the rectangle together', async () => {
    // Either on its own draws the card somewhere nobody dropped it: in the new
    // container at the old container's coordinates, or at the right place on
    // screen and still a member of the section it left.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['loose', { path: 'Foot', box: { x: 940, y: 640, w: 100, h: 40 } }]]),
    );
    expect(moved, 'nothing written').not.toBeUndefined();
    expect(group(moved!, 'loose')).toBe('Foot');
    // The page rectangle restated in Foot's space, which begins at 40, 600.
    expect(rect(moved!, 'loose')).toEqual({ x: 900, y: 40, w: 100, h: 40 });
  });

  it('takes a card out of a container on to the page', async () => {
    // Out is a destination like any other: the page is where you land when
    // nothing above you is a frame.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['chip', { path: undefined, box: { x: 200, y: 800, w: 120, h: 40 } }]]),
    );
    expect(group(moved!, 'chip')).toBeUndefined();
    expect(rect(moved!, 'chip')).toEqual({ x: 200, y: 800, w: 120, h: 40 });
  });

  it('keeps the cluster somebody made below the container', async () => {
    // A drag says which container holds a card. The cluster inside it is not
    // something the gesture expressed any opinion about.
    const tagged = doc();
    tagged.widgets![2]!.config = { group: 'Foot/Modes' };
    const moved = reparentWidgets(
      tagged,
      'desktop',
      new Map([['chip', { path: 'Left', box: { x: 40, y: 100, w: 120, h: 40 }, at: 0 }]]),
    );
    expect(group(moved!, 'chip')).toBe('Left/Modes');
  });

  it('leaves it clustered and out of every container, dropped on the page', async () => {
    const tagged = doc();
    tagged.widgets![2]!.config = { group: 'Foot/Modes' };
    const moved = reparentWidgets(
      tagged,
      'desktop',
      new Map([['chip', { path: undefined, box: { x: 0, y: 0, w: 120, h: 40 } }]]),
    );
    expect(group(moved!, 'chip')).toBe('Modes');
  });

  it('lands where in the column it was dropped, not where its page y converts to', async () => {
    // A column's stored tops are an ordering; what separates two rows on
    // screen is their content. The index is the surface's answer and this is
    // what it is for.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['loose', { path: 'Left', box: { x: 40, y: 100, w: 100, h: 40 }, at: 1 }]]),
    );
    expect(order(moved!, 'Left')).toEqual(['head', 'loose', 'list']);
  });

  it('restates the column as a stack from its top', async () => {
    // A stored top that is only an ordering loses nothing by being restated,
    // and these are the numbers an unstack would want: each row under the last
    // one, a gap apart.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['loose', { path: 'Left', box: { x: 40, y: 100, w: 100, h: 40 }, at: 1 }]]),
    );
    expect(rect(moved!, 'head')).toMatchObject({ y: 0, h: 20 });
    expect(rect(moved!, 'loose')).toMatchObject({ y: 30, h: 40 });
    expect(rect(moved!, 'list')).toMatchObject({ y: 80, h: 60 });
  });

  it('reorders a column without anything leaving it', async () => {
    // The same write with the same container at both ends, which is what
    // dragging a row up its own column is.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['list', { path: 'Left', box: { x: 40, y: 100, w: 700, h: 60 }, at: 0 }]]),
    );
    expect(order(moved!, 'Left')).toEqual(['list', 'head']);
  });

  it('orders a container nested in the column along with the widgets', async () => {
    // A container in a column is a row of that column, so a card dropped above
    // it has to land above it — which only works if the renumbering moves the
    // box too (§14.2b).
    const nested = doc();
    nested.layouts![0]!.groups!.push({
      path: 'Left/Band',
      rect: { x: 0, y: 100, w: 700, h: 50 },
      frame: true,
      fit: 'content',
    });
    const moved = reparentWidgets(
      nested,
      'desktop',
      new Map([['loose', { path: 'Left', box: { x: 40, y: 100, w: 100, h: 40 }, at: 2 }]]),
    );
    expect(rect(moved!, 'head')).toMatchObject({ y: 0 });
    expect(rect(moved!, 'list')).toMatchObject({ y: 30 });
    expect(rect(moved!, 'loose')).toMatchObject({ y: 100 });
    expect(box(moved!, 'Left/Band')?.rect).toMatchObject({ y: 150 });
  });

  it('leaves the container it came from alone', async () => {
    // The order of what remains is unchanged, so rewriting those rows to close
    // a hole that does not draw would be a diff for its own sake.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['head', { path: 'Foot', box: { x: 40, y: 600, w: 300, h: 20 } }]]),
    );
    expect(rect(moved!, 'list')).toEqual({ x: 0, y: 30, w: 700, h: 60 });
    expect(box(moved!, 'Left')?.rect).toEqual({ x: 40, y: 100, w: 700, h: 400 });
  });

  it('drops several into one column in the order they are given', async () => {
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([
        ['chip', { path: 'Left', box: { x: 40, y: 100, w: 120, h: 40 }, at: 0 }],
        ['loose', { path: 'Left', box: { x: 40, y: 100, w: 100, h: 40 }, at: 1 }],
      ]),
    );
    expect(order(moved!, 'Left')).toEqual(['chip', 'loose', 'head', 'list']);
  });

  it('keeps the cells in step with the rectangle', async () => {
    // A client that has never heard of frames draws the cells, and one left
    // behind says where the card used to be (§14.3).
    const before = doc();
    const moved = reparentWidgets(
      before,
      'desktop',
      new Map([['loose', { path: 'Foot', box: { x: 940, y: 640, w: 100, h: 40 } }]]),
    );
    const was = before.layouts?.[0]?.placements?.find((p) => p.widget_id === 'loose');
    const now = moved!.layouts?.[0]?.placements?.find((p) => p.widget_id === 'loose');
    expect({ x: now?.x, y: now?.y }).not.toEqual({ x: was?.x, y: was?.y });
  });

  it('skips an id the page does not have rather than losing the drop', async () => {
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([
        ['gone', { path: 'Foot', box: { x: 0, y: 0, w: 10, h: 10 } }],
        ['loose', { path: 'Foot', box: { x: 940, y: 640, w: 100, h: 40 } }],
      ]),
    );
    expect(group(moved!, 'loose')).toBe('Foot');
  });

  it('lets a column decide the left edge as well as the top', async () => {
    // The same rule a section's drop follows: a column sets its members' left
    // edge, so the x the pointer happened to be at is a number nothing draws.
    const moved = reparentWidgets(
      doc(),
      'desktop',
      new Map([['loose', { path: 'Left', box: { x: 300, y: 115, w: 100, h: 40 }, at: 0 }]]),
    );
    expect(rect(moved!, 'loose')?.x).toBe(0);
  });

  it('writes nothing when there is nothing it could write', async () => {
    expect(reparentWidgets(doc(), 'desktop', new Map())).toBeUndefined();
    expect(
      reparentWidgets(
        doc(),
        'desktop',
        new Map([['gone', { path: 'Foot', box: { x: 0, y: 0, w: 1, h: 1 } }]]),
      ),
    ).toBeUndefined();
  });

  it('declines on a packed page, which has no containers to land in', async () => {
    const packed = doc();
    packed.layouts![0]!.flow = 'packed';
    expect(
      reparentWidgets(
        packed,
        'desktop',
        new Map([['loose', { path: 'Foot', box: { x: 0, y: 0, w: 1, h: 1 } }]]),
      ),
    ).toBeUndefined();
  });
});

describe('dragging a container into another container', () => {
  // The half of the drop that containers left open: a widget changes container
  // by a write to its own config, and a container cannot — its membership *is*
  // its path, so moving one is a rename of that path and of everything under
  // it. Until this, a section dragged into a column moved its own box and
  // stayed a member of the column it came from, which draws it somewhere
  // nobody dropped it.
  const doc = (): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [
      { id: 'm1', type: 'text', config: { group: 'Left/Motion' } },
      { id: 'd1', type: 'text', config: { group: 'Left/Doors' } },
      { id: 'd2', type: 'text', config: { group: 'Left/Doors/Locks' } },
      { id: 'r1', type: 'text', config: { group: 'Right' } },
      { id: 'f1', type: 'text', config: { group: 'Foot' } },
    ],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 100,
        gap: 10,
        flow: 'free',
        frame: { width: 1240, height: 900 },
        // Both columns sit away from the page origin, in both directions: an
        // origin of zero would hide every conversion this is here to catch.
        groups: [
          {
            path: 'Left',
            rect: { x: 40, y: 100, w: 700, h: 400 },
            frame: true,
            stack: true,
            stack_gap: 10,
          },
          {
            path: 'Left/Motion',
            rect: { x: 0, y: 0, w: 700, h: 120 },
            frame: true,
            fit: 'content',
          },
          {
            path: 'Left/Doors',
            rect: { x: 0, y: 130, w: 700, h: 100 },
            frame: true,
            fit: 'content',
          },
          {
            path: 'Right',
            rect: { x: 800, y: 100, w: 400, h: 400 },
            frame: true,
            stack: true,
            stack_gap: 10,
          },
          { path: 'Foot', rect: { x: 40, y: 600, w: 700, h: 80 }, frame: true, fit: 'content' },
        ],
        placements: [
          { widget_id: 'm1', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 700, h: 120 } },
          { widget_id: 'd1', x: 0, y: 0, w: 1, h: 1, rect: { x: 10, y: 10, w: 300, h: 40 } },
          { widget_id: 'd2', x: 0, y: 0, w: 1, h: 1, rect: { x: 320, y: 10, w: 300, h: 40 } },
          { widget_id: 'r1', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 400, h: 60 } },
          { widget_id: 'f1', x: 0, y: 0, w: 1, h: 1, rect: { x: 10, y: 10, w: 120, h: 40 } },
        ],
      },
    ],
  });

  const box = (d: DashboardDefinition, path: string) =>
    d.layouts?.[0]?.groups?.find((b) => b.path === path);
  const rect = (d: DashboardDefinition, id: string) =>
    d.layouts?.[0]?.placements?.find((p) => p.widget_id === id)?.rect;
  const group = (d: DashboardDefinition, id: string) =>
    d.widgets?.find((w) => w.id === id)?.config?.['group'];

  it('renames the box, and everything underneath it, as one document', async () => {
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 820, y: 150, w: 700, h: 100 },
      at: 0,
    });
    expect(moved, 'nothing written').not.toBeUndefined();
    expect(box(moved!, 'Left/Doors'), 'left behind').toBeUndefined();
    expect(box(moved!, 'Right/Doors')).not.toBeUndefined();
    expect(group(moved!, 'd1')).toBe('Right/Doors');
    // The tag somebody made inside the section rides along: the gesture said
    // which container holds it, not what cluster is in it.
    expect(group(moved!, 'd2')).toBe('Right/Doors/Locks');
  });

  it('writes nothing at all to the things inside it', async () => {
    // A member's rectangle is stated in the box's space, and that space
    // travelled with the box — rewriting them is the bug, not the work.
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 820, y: 150, w: 700, h: 100 },
      at: 0,
    })!;
    expect(rect(moved, 'd1')).toEqual({ x: 10, y: 10, w: 300, h: 40 });
    expect(rect(moved, 'd2')).toEqual({ x: 320, y: 10, w: 300, h: 40 });
  });

  it('takes a place in the column it lands in, and restates it as a stack', async () => {
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 820, y: 150, w: 700, h: 100 },
      at: 0,
    })!;
    // First in the column, so the row that was there is pushed below it by the
    // section's own height and the column's gap.
    expect(box(moved, 'Right/Doors')?.rect?.y).toBe(0);
    expect(rect(moved, 'r1')?.y).toBe(110);
  });

  it('keeps the size its author drew, not the height it was measured at', async () => {
    // A column is as tall as its content and a band is measured after layout,
    // so the height a drag hands back is what the browser made of the box. A
    // move has an opinion about the corner and none about the size.
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 820, y: 150, w: 999, h: 999 },
      at: 1,
    })!;
    expect(box(moved, 'Right/Doors')?.rect).toEqual({ x: 0, y: 70, w: 700, h: 100 });
  });

  it('lets a column decide the left edge as well as the top', async () => {
    // A member's left edge is the column's, so the x a drop happened to let go
    // at draws nothing and reads wrong — it is where the section would leap
    // the moment anybody unstacked the column. Measured on the household's
    // room page, a section let go over the right column stored an x of -128.
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 700, y: 150, w: 700, h: 100 },
      at: 0,
    })!;
    expect(box(moved, 'Right/Doors')?.rect?.x).toBe(0);
  });

  it('keeps it where it was let go in a container that positions its members', async () => {
    // A band lays its members out by coordinate, so both numbers are real
    // there and the conversion is the whole answer.
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Left/Motion',
      box: { x: 100, y: 200, w: 700, h: 100 },
    })!;
    expect(box(moved, 'Left/Motion/Doors')?.rect).toEqual({ x: 60, y: 100, w: 700, h: 100 });
  });

  it('takes a section out on to the page, where the rectangle is the page one', async () => {
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: undefined,
      box: { x: 300, y: 700, w: 700, h: 100 },
    })!;
    expect(box(moved, 'Doors')?.rect).toEqual({ x: 300, y: 700, w: 700, h: 100 });
    expect(group(moved, 'd1')).toBe('Doors');
  });

  it('numbers a name the destination has already used', async () => {
    // **The one place the widget rule is turned round.** A card joins a
    // cluster of the same name because agreeing on a name is what a cluster
    // is. Two containers agreeing would be one box swallowing another's
    // members while its own rectangle stayed where it was.
    const taken = doc();
    taken.layouts![0]!.groups!.push({
      path: 'Right/Doors',
      rect: { x: 0, y: 200, w: 400, h: 40 },
      frame: true,
      fit: 'content',
    });
    const moved = reparentGroup(taken, 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 820, y: 150, w: 700, h: 100 },
      at: 0,
    })!;
    expect(box(moved, 'Right/Doors 2')).not.toBeUndefined();
    expect(box(moved, 'Right/Doors')?.rect?.w, 'the one already there').toBe(400);
    expect(group(moved, 'd1')).toBe('Right/Doors 2');
  });

  it('reorders a section inside its own column by its place, not by its top', async () => {
    // **Why this is a drop and not a move.** A column's stored tops are an
    // ordering while what separates two rows on screen is their content, and
    // the two drift — so adding the pointer's travel to a stored top lands a
    // section wherever the drift had got to.
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Left',
      box: { x: 40, y: 100, w: 700, h: 100 },
      at: 0,
    })!;
    expect(box(moved, 'Left/Doors')?.rect?.y).toBe(0);
    expect(box(moved, 'Left/Motion')?.rect?.y).toBe(110);
    expect(group(moved, 'd1'), 'renamed for no reason').toBe('Left/Doors');
  });

  it('leaves the column it came from exactly as it was', async () => {
    // The order of what remains is unchanged, and rewriting rows nobody
    // touched to close a hole that does not draw is a diff for its own sake.
    const moved = reparentGroup(doc(), 'desktop', 'Left/Doors', {
      path: 'Right',
      box: { x: 820, y: 150, w: 700, h: 100 },
      at: 0,
    })!;
    expect(box(moved, 'Left/Motion')?.rect).toEqual({ x: 0, y: 0, w: 700, h: 120 });
    expect(box(moved, 'Left')?.rect).toEqual({ x: 40, y: 100, w: 700, h: 400 });
  });

  it('refuses to put a container inside itself, or inside what it holds', async () => {
    expect(
      reparentGroup(doc(), 'desktop', 'Left', {
        path: 'Left/Motion',
        box: { x: 0, y: 0, w: 700, h: 400 },
      }),
    ).toBeUndefined();
    expect(
      reparentGroup(doc(), 'desktop', 'Left', {
        path: 'Left',
        box: { x: 0, y: 0, w: 700, h: 400 },
      }),
    ).toBeUndefined();
  });

  it('leaves an ordinary move to the door that owns it', async () => {
    // A positioned container let go in the space it already sits in has not
    // been dropped anywhere — that is `moveGroupBox`, which writes a delta.
    expect(
      reparentGroup(doc(), 'desktop', 'Foot', {
        path: undefined,
        box: { x: 100, y: 620, w: 700, h: 80 },
      }),
    ).toBeUndefined();
  });

  it('writes nothing when there is nothing it could write', async () => {
    expect(
      reparentGroup(doc(), 'desktop', 'Nothing', {
        path: 'Right',
        box: { x: 0, y: 0, w: 10, h: 10 },
      }),
    ).toBeUndefined();
    const packed = doc();
    packed.layouts![0]!.flow = 'packed';
    expect(
      reparentGroup(packed, 'desktop', 'Left/Doors', {
        path: 'Right',
        box: { x: 0, y: 0, w: 10, h: 10 },
      }),
    ).toBeUndefined();
  });
});

describe('holding a container to the size it was drawn', () => {
  const doc = (clip?: boolean): DashboardDefinition => ({
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    widgets: [
      { id: 'a', type: 'text', config: { group: 'Strip' } },
      { id: 'b', type: 'text', config: { group: 'Tag' } },
    ],
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 100,
        gap: 10,
        flow: 'free',
        frame: { width: 1240, height: 900 },
        groups: [
          {
            path: 'Strip',
            rect: { x: 40, y: 100, w: 700, h: 120 },
            frame: true,
            stack: true,
            stack_gap: 10,
            ...(clip === undefined ? {} : { clip }),
          },
        ],
        placements: [
          { widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 40 } },
          { widget_id: 'b', x: 0, y: 0, w: 1, h: 1, rect: { x: 900, y: 0, w: 100, h: 40 } },
        ],
      },
    ],
  });

  const box = (d: DashboardDefinition) => d.layouts?.[0]?.groups?.find((b) => b.path === 'Strip');

  it('writes the one key and nothing else', async () => {
    // Nothing inside it moves: a member's rectangle is stated in the box's
    // space, so this writes the box and clipping is as reversible as the two
    // bodies are.
    const next = clipGroup(doc(), 'desktop', 'Strip', true)!;
    expect(box(next)?.clip).toBe(true);
    expect(box(next)?.rect).toEqual({ x: 40, y: 100, w: 700, h: 120 });
    expect(next.layouts?.[0]?.placements).toEqual(doc().layouts?.[0]?.placements);
    expect(next.widgets).toEqual(doc().widgets);
  });

  it('lets go of it again, and the document is byte-identical', async () => {
    // The invariant every container edit here keeps: group then ungroup, stack
    // then unstack, and now clip then unclip all leave the page exactly as it
    // was. So letting go takes the key out rather than writing a `false` that
    // reads the same to everything and diffs against nothing.
    const held = clipGroup(doc(), 'desktop', 'Strip', true)!;
    const freed = clipGroup(held, 'desktop', 'Strip', false)!;
    expect(box(freed)?.clip).toBeUndefined();
    expect(JSON.stringify(freed)).toBe(JSON.stringify(doc()));
  });

  it('is nothing to do when it is already that way', async () => {
    expect(clipGroup(doc(true), 'desktop', 'Strip', true)).toBeUndefined();
    expect(clipGroup(doc(false), 'desktop', 'Strip', false)).toBeUndefined();
    expect(clipGroup(doc(), 'desktop', 'Strip', false)).toBeUndefined();
  });

  it('refuses a group that is only a tag, which has no size to hold to', async () => {
    // A tag is several elements agreeing on a name and has no geometry at all
    // (§14.2b) — there is nothing there to clip.
    expect(clipGroup(doc(), 'desktop', 'Tag', true)).toBeUndefined();
    expect(clipGroup(doc(), 'desktop', 'Nothing', true)).toBeUndefined();
  });

  it('declines on a packed page, which has no containers at all', async () => {
    const packed = doc();
    packed.layouts![0]!.flow = 'packed';
    expect(clipGroup(packed, 'desktop', 'Strip', true)).toBeUndefined();
  });
});
