import { describe, expect, it } from 'vitest';
import type { DashboardDefinition, DashboardWidget } from '../src/core/dashboard.js';
import { gridItems, layoutFor } from '../src/core/dashboard.js';
import { Engine } from '../src/core/layout.js';

/**
 * Shapes taken from the three dashboards a real deployment stores: a composed
 * `free` page with a 1240x1248 frame, and a four-breakpoint `packed` one.
 */
function doc(over: Partial<DashboardDefinition> = {}): DashboardDefinition {
  return {
    id: 'd',
    name: 'D',
    icon: 'home',
    owner_user_id: 'u',
    layouts: [],
    widgets: [],
    ...over,
  };
}

const widget = (id: string, config?: Record<string, unknown>): DashboardWidget => ({
  id,
  type: 'text',
  ...(config !== undefined ? { config } : {}),
});

describe('layoutFor', () => {
  it('picks the breakpoint asked for', () => {
    const d = doc({
      layouts: [
        { breakpoint: 'mobile', columns: 1, row_height: 120, gap: 12 },
        { breakpoint: 'desktop', columns: 12, row_height: 120, gap: 12 },
      ],
    });
    expect(layoutFor(d, 'desktop')?.columns).toBe(12);
    expect(layoutFor(d, 'mobile')?.columns).toBe(1);
    // `tv` is a real breakpoint core has; a document need not carry one.
    expect(layoutFor(d, 'tv')).toBeUndefined();
  });
});

describe('gridItems', () => {
  it('resolves floating from the widget config, not the placement', () => {
    // Every real document spells lifting as config.layer === "free". Reading it
    // off the placement finds nothing, and the failure is quiet: the layout
    // still normalises and lifted cards are just dragged back into the grid.
    const layout = {
      breakpoint: 'desktop' as const,
      columns: 12,
      row_height: 120,
      gap: 12,
      flow: 'free' as const,
      placements: [
        { widget_id: 'grounded', x: 0, y: 0, w: 2, h: 1 },
        { widget_id: 'lifted', x: 0, y: 6, w: 2, h: 1 },
      ],
    };
    const items = gridItems(layout, [widget('grounded'), widget('lifted', { layer: 'free' })]);

    expect(items.find((i) => i.id === 'grounded')?.floating).toBeUndefined();
    expect(items.find((i) => i.id === 'lifted')?.floating).toBe(true);
  });

  it('carries rect through, so a composed element keeps where it was put', () => {
    const layout = {
      breakpoint: 'desktop' as const,
      columns: 12,
      row_height: 120,
      gap: 12,
      flow: 'free' as const,
      placements: [
        { widget_id: 'h_001', x: 0, y: 0, w: 12, h: 1, rect: { x: 0, y: 0, w: 1240, h: 48 } },
      ],
    };
    const [item] = gridItems(layout, [widget('h_001')]);
    expect(item?.rect).toEqual({ x: 0, y: 0, w: 1240, h: 48 });
  });

  it('produces a layout core would accept', () => {
    // The real composed page: 12 columns, free flow, every placement carrying a
    // rect. Whatever we hand the engine has to come back legal.
    const layout = {
      breakpoint: 'desktop' as const,
      columns: 12,
      row_height: 120,
      gap: 12,
      flow: 'free' as const,
      placements: [
        { widget_id: 'a', x: 0, y: 0, w: 12, h: 1, rect: { x: 0, y: 0, w: 1240, h: 48 } },
        { widget_id: 'b', x: 0, y: 1, w: 6, h: 3, rect: { x: 22, y: 64, w: 600, h: 300 } },
        { widget_id: 'c', x: 6, y: 1, w: 6, h: 3, rect: { x: 640, y: 64, w: 578, h: 300 } },
      ],
    };
    const engine = new Engine(layout.columns, layout.flow);
    const normalized = engine.normalize(gridItems(layout, [widget('a'), widget('b'), widget('c')]));
    expect(engine.isLegal(normalized)).toBe(true);
  });

  it('handles a layout with no placements at all', () => {
    const layout = { breakpoint: 'tv' as const, columns: 12, row_height: 120, gap: 12 };
    expect(gridItems(layout, [])).toEqual([]);
  });
});
