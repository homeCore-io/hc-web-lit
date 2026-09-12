/**
 * Could another client read this page?
 *
 * **The honest successor to "validate → diff → apply".** That flow was
 * designed when core stored dashboards: you validated a document, saw what
 * would change, and applied it. §18.2 moved pages into this client's own
 * store, so there is nothing to deploy *to* — every edit is already live —
 * and the box for it has stood obsolete-as-written since.
 *
 * What survives of it is the question it was really asking, and §18.2 is why
 * it still matters: **both clients are in use**, each with its own copy of a
 * page, and a household moving between them imports once. Two smaller checks
 * already answer a piece of it — `Engine.normalize` guarantees that what is
 * drawn is saveable, and the property panel flags one widget's fields while
 * somebody is looking at that widget — and nothing answered it for a *page*.
 * A page is where the answer matters: one dangling reference in thirty-six
 * widgets is not something anybody finds by opening each in turn.
 *
 * **Three kinds of thing, and not one of them is a rule this client invented.**
 * A field that disagrees with the table core publishes; a placement and a
 * widget list that disagree with each other; and a reference to a page that is
 * not there. Each is something another reader would have to guess about, which
 * is the definition being used: not "invalid" — core accepts more than this —
 * but *unreadable by somebody else*.
 *
 * An unknown widget **type** is deliberately not on that list. Core accepts
 * one and so does this client (§14.3); a client that coerced it to something
 * it knew was the bug that made `type` a plain string in the first place. A
 * type this build cannot draw is a placeholder on screen, which says so where
 * it happens.
 */
import type { DashboardDefinition } from './dashboard.js';
import { problemsIn } from './properties.js';
import { widgetSpec, type Vocabulary } from './vocabulary.js';

/** One thing on a page that another reader would have to guess about. */
export interface Unreadable {
  /** The widget it is about, or absent when it is about the page itself. */
  widget?: string;
  /** The key, where it is about one. */
  field?: string;
  /** What a household is told, in words rather than in a code. */
  why: string;
}

/**
 * Everything on this page another client would stumble over.
 *
 * Ordered as a person would read the page rather than by severity: widget by
 * widget, in the order the document lists them, then the page's own.
 */
export function unreadableIn(
  doc: DashboardDefinition | undefined,
  vocabulary: Vocabulary | undefined,
  pages: readonly DashboardDefinition[] = [],
): Unreadable[] {
  if (doc === undefined) return [];
  const found: Unreadable[] = [];
  const widgets = doc.widgets ?? [];
  const known = new Set(pages.map((p) => p.id));

  for (const w of widgets) {
    const spec = widgetSpec(vocabulary, w.type);
    // Nothing to check against is not a complaint: core describes 40 types and
    // draws no conclusion about the rest, and neither does this.
    if (spec !== undefined) {
      for (const p of problemsIn(spec, w.config)) {
        found.push({ widget: w.id, field: p.name, why: p.problem });
      }
    }
    for (const to of pagesNamedBy(w.config)) {
      if (!known.has(to)) {
        found.push({ widget: w.id, why: `Opens a page that is not here: ${to}.` });
      }
    }
  }

  // A placement and a widget list that disagree. Either way round is a page
  // that draws differently depending on which half a reader starts from.
  const ids = new Set(widgets.map((w) => w.id));
  const placed = new Set<string>();
  for (const layout of doc.layouts ?? []) {
    for (const p of layout.placements ?? []) {
      placed.add(p.widget_id);
      if (!ids.has(p.widget_id)) {
        found.push({
          why: `The ${layout.breakpoint} layout places a widget that is not here: ${p.widget_id}.`,
        });
      }
    }
  }
  for (const w of widgets) {
    if (!placed.has(w.id)) found.push({ widget: w.id, why: 'Nothing on any layout places it.' });
  }

  return found;
}

/**
 * The pages a widget's config points at.
 *
 * Three keys, because three keys are what documents actually use: a link's
 * target, the room page a room field opens, and the list a page switcher
 * offers. Read off the config rather than from a type table, so a widget type
 * nobody has written yet gets the same check for free.
 */
function pagesNamedBy(config: Record<string, unknown> | undefined): string[] {
  if (config === undefined) return [];
  const out: string[] = [];
  const take = (v: unknown): void => {
    if (typeof v === 'string' && v !== '') out.push(v);
  };

  take(config['room_page']);
  for (const v of Array.isArray(config['dashboard_ids']) ? config['dashboard_ids'] : []) take(v);
  for (const key of ['on_tap', 'on_hold', 'on_double_tap']) {
    const action = config[key];
    if (action === null || typeof action !== 'object') continue;
    const a = action as Record<string, unknown>;
    if (a['do'] === 'page') take(a['target']);
  }
  return out;
}
