/**
 * The dashboard document, as core stores it.
 *
 * Mirrors `hc_types::dashboard::DashboardDefinition`. **This format already
 * exists and is what is in redb** (§14.3) — hc-web-lit reads and writes it
 * rather than defining a successor, which is what lets both clients work
 * against the same live documents while one replaces the other (§18.2).
 */
import type { DashboardFlow, DashboardRect, GridItem } from './layout.js';

export type DashboardBreakpoint = 'mobile' | 'tablet' | 'desktop' | 'tv';

/** The canvas a composed layout sits on. Absent means a plain grid. */
export interface DashboardFrame {
  width: number;
  height: number;
  fit?: 'scroll' | 'contain' | 'cover';
}

/** A group that has been given a body. Membership is a path in widget config. */
export interface DashboardGroupBox {
  path: string;
  rect?: DashboardRect | null;
  padding?: number;
  clip?: boolean;
  frame?: boolean;
  stack?: boolean;
  stack_gap?: number;
}

export interface DashboardWidgetPlacement {
  widget_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where it really sits, when the layout is composed. */
  rect?: DashboardRect | null;
  /** Degrees clockwise about the element's own centre. */
  angle?: number | null;
}

export interface DashboardLayout {
  breakpoint: DashboardBreakpoint;
  columns: number;
  row_height: number;
  gap: number;
  placements?: DashboardWidgetPlacement[];
  flow?: DashboardFlow;
  derived_from?: DashboardBreakpoint | null;
  frame?: DashboardFrame | null;
  groups?: DashboardGroupBox[];
}

/**
 * One card.
 *
 * `type` is a plain string and core accepts unknown ones. It was an enum of 15
 * variants every client mirrored by hand, the mirror cracked, and a client
 * coerced an unknown card to `markdown` and would have saved it back that way
 * (§14.3). The registry decides what can be drawn; the document is not the
 * place that decision lives.
 */
export interface DashboardWidget {
  id: string;
  type: string;
  title?: string;
  subtitle?: string;
  config?: Record<string, unknown>;
}

export interface DashboardDefinition {
  id: string;
  name: string;
  icon: string;
  description?: string;
  owner_user_id: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  layouts?: DashboardLayout[];
  widgets?: DashboardWidget[];
  background?: Record<string, unknown> | null;
  template?: boolean;
}

/** The layout for a breakpoint, or `undefined` if the document has none. */
export function layoutFor(
  doc: DashboardDefinition,
  breakpoint: DashboardBreakpoint,
): DashboardLayout | undefined {
  return doc.layouts?.find((l) => l.breakpoint === breakpoint);
}

/**
 * Placements as the layout engine wants them.
 *
 * **`floating` is not on the placement.** Lifting an element above the grid is
 * a property of the *element*, so it rides in the widget's own config — a card
 * lifted on the wall is lifted on the phone too, because a design decision that
 * changes when you rotate a tablet is not one anybody asked for. Every real
 * document uses `config.layer === "free"` for it, so the engine's `floating`
 * has to be resolved from the widgets, not read off the placement.
 *
 * Getting this wrong is quiet: the layout still normalises, and lifted cards
 * are simply dragged back into the grid by gravity.
 */
export function gridItems(
  layout: DashboardLayout,
  widgets: readonly DashboardWidget[],
): GridItem[] {
  const lifted = new Set(
    widgets.filter((w) => (w.config?.['layer'] ?? undefined) === 'free').map((w) => w.id),
  );

  return (layout.placements ?? []).map((p) => ({
    id: p.widget_id,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    ...(lifted.has(p.widget_id) ? { floating: true } : {}),
    ...(p.rect != null ? { rect: p.rect } : {}),
  }));
}
