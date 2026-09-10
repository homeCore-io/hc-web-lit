/**
 * Making and copying a page.
 *
 * Possible at all only since pages moved into this client's own store (§18.2):
 * while they lived in core, creating one meant asking core to hold a document
 * that was never core's. Now it is a write to the same place the icon rules
 * and templates go.
 *
 * **Not the designer** (Phase 10). Placement, dragging and the canvas are that;
 * this is the document management underneath, and it is what the designer will
 * need to exist before it can be built. What it buys today is the authoring
 * loop a household actually has: duplicate the page that nearly does what you
 * want, then edit it with the property panel.
 */
import type { DashboardDefinition, DashboardWidget } from './dashboard.js';

/**
 * A page id from what somebody typed.
 *
 * Ids are addresses — an `on_tap` names one, and so does a link — so they are
 * lower case, hyphenated and free of anything that has to be escaped. The
 * name keeps whatever was typed; only the id is tidied.
 */
export function pageId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'page';

  if (!taken.includes(base)) return base;
  // A household with two pages called "Upstairs" gets `upstairs` and
  // `upstairs-2`, not a refusal and not a silent overwrite.
  for (let n = 2; ; n++) {
    const tried = `${base}-${n}`;
    if (!taken.includes(tried)) return tried;
  }
}

/**
 * A new page, ready to be edited.
 *
 * **It comes with a heading and a property panel pointed at that heading**,
 * which looks like a strange default until you try the alternative: an empty
 * page cannot be given a widget, because placing one is the designer's job and
 * the designer is Phase 10. A page that ships with the tool for editing itself
 * is the difference between "you can make a page" and "you can make a page and
 * then nothing".
 *
 * One `desktop` layout and no others: `layoutFor` falls back across
 * breakpoints, so a phone draws the desktop arrangement rather than nothing,
 * and writing four copies of one layout would be writing three of them wrong.
 */
export function newPage(
  name: string,
  taken: readonly string[],
  owner: string,
): DashboardDefinition {
  const id = pageId(name, taken);
  const widgets: DashboardWidget[] = [
    { id: 'title', type: 'heading', config: { text: name, level: 'h1' } },
    {
      id: 'panel',
      type: 'property_panel',
      config: { widget: { type: 'heading', config: { text: name, level: 'h1' } }, edits: 'title' },
    },
  ];

  return {
    id,
    name,
    icon: 'home',
    owner_user_id: owner,
    layouts: [
      {
        breakpoint: 'desktop',
        columns: 12,
        row_height: 120,
        gap: 12,
        placements: [
          { widget_id: 'title', x: 0, y: 0, w: 12, h: 1 },
          { widget_id: 'panel', x: 0, y: 1, w: 6, h: 4 },
        ],
      },
    ],
    widgets,
  };
}

/**
 * A copy of a page, under a new id.
 *
 * **The whole document, deeply copied.** A shallow copy shares the widget
 * objects with the original, so editing the copy edits both — and the two are
 * in one array in one store, so it would be saved that way too.
 *
 * Widget ids are kept: they are addresses *within* a page, and a placement
 * refers to one. Renaming them would mean rewriting every placement and every
 * `edits` a panel carries, to fix a collision that cannot happen.
 */
export function duplicatePage(
  doc: DashboardDefinition,
  taken: readonly string[],
  name = `${doc.name} copy`,
): DashboardDefinition {
  const copy = structuredClone(doc) as DashboardDefinition;
  return { ...copy, id: pageId(name, taken), name };
}
