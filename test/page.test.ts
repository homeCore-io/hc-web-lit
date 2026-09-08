import { describe, expect, it } from 'vitest';
import { tapIn } from '../src/core/actions.js';
import { resolveConfig } from '../src/core/bindings.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import { DeviceStore } from '../src/core/store.js';
import '../src/shell/hc-page.js';
import '../src/widgets/hc-text.js';
import type { HcPage } from '../src/shell/hc-page.js';

async function mount(doc: DashboardDefinition, breakpoint = 'desktop'): Promise<HcPage> {
  const el = document.createElement('hc-page');
  el.doc = doc;
  el.store = new DeviceStore();
  el.breakpoint = breakpoint as HcPage['breakpoint'];
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const base = (over: Partial<DashboardDefinition>): DashboardDefinition => ({
  id: 'd',
  name: 'D',
  icon: 'home',
  owner_user_id: 'u',
  ...over,
});

describe('hc-page', () => {
  it('positions a composed page from its rects, not from cells', async () => {
    // The real house page: a 1240x1248 frame, every placement carrying a rect.
    const el = await mount(
      base({
        layouts: [
          {
            breakpoint: 'desktop',
            columns: 12,
            row_height: 120,
            gap: 12,
            flow: 'free',
            frame: { width: 1240, height: 1248, fit: 'scroll' },
            placements: [
              { widget_id: 'h', x: 0, y: 0, w: 12, h: 1, rect: { x: 22, y: 64, w: 600, h: 48 } },
            ],
          },
        ],
        widgets: [{ id: 'h', type: 'text', config: { text: 'EVERY ROOM' } }],
      }),
    );

    const frame = el.shadowRoot?.querySelector('.frame') as HTMLElement;
    expect(frame.style.width).toBe('1240px');

    const placed = el.shadowRoot?.querySelector('.placed') as HTMLElement;
    expect(placed.style.left).toBe('22px');
    expect(placed.style.top).toBe('64px');
    expect(placed.style.width).toBe('600px');
  });

  it('draws a grid page from normalised cells', async () => {
    const el = await mount(
      base({
        layouts: [
          {
            breakpoint: 'mobile',
            columns: 1,
            row_height: 120,
            gap: 12,
            flow: 'packed',
            placements: [
              { widget_id: 'a', x: 0, y: 0, w: 1, h: 2 },
              // Gravity pulls this up to row 2; drawing it at row 9 would mean
              // drawing something core would not have saved.
              { widget_id: 'b', x: 0, y: 9, w: 1, h: 1 },
            ],
          },
        ],
        widgets: [
          { id: 'a', type: 'text', config: { text: 'a' } },
          { id: 'b', type: 'text', config: { text: 'b' } },
        ],
      }),
      'mobile',
    );

    const cells = [...(el.shadowRoot?.querySelectorAll('.cell') ?? [])] as HTMLElement[];
    expect(cells).toHaveLength(2);
    expect(cells[0]?.style.gridRow).toBe('1/span 2');
    expect(cells[1]?.style.gridRow).toBe('3/span 1');
  });

  it('names an unknown widget type instead of failing', async () => {
    // Core accepts types it has never heard of, so meeting one is normal. A
    // client that errors here breaks whenever a plugin ships a card.
    const el = await mount(
      base({
        layouts: [
          {
            breakpoint: 'desktop',
            columns: 12,
            row_height: 120,
            gap: 12,
            placements: [{ widget_id: 'x', x: 0, y: 0, w: 3, h: 2 }],
          },
        ],
        widgets: [{ id: 'x', type: 'sankey_from_the_future' }],
      }),
    );

    const unknown = el.shadowRoot?.querySelector('.unknown');
    expect(unknown?.textContent?.trim()).toBe('sankey_from_the_future');
  });

  it('says so when the document has no layout for this breakpoint', async () => {
    const el = await mount(
      base({
        layouts: [{ breakpoint: 'desktop', columns: 12, row_height: 120, gap: 12 }],
        widgets: [],
      }),
      'tv',
    );
    expect(el.shadowRoot?.textContent).toContain('no tv layout');
    expect(el.shadowRoot?.textContent).toContain('desktop');
  });

  it('renders nothing rather than throwing with no document', async () => {
    const el = document.createElement('hc-page');
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain('No dashboard');
  });
});

describe('a placement that carries an action', () => {
  it('reads the one verb the reference house stores', () => {
    expect(tapIn({ on_tap: { do: 'page', target: 'dashboard_house_designed' } })).toEqual({
      do: 'page',
      target: 'dashboard_house_designed',
    });
  });

  it('has no opinion about a widget that declares none', () => {
    // Not "a tap that does nothing" — a tap that is the widget's own business.
    expect(tapIn({ text: 'HOUSE' })).toBeUndefined();
    expect(tapIn(undefined)).toBeUndefined();
  });

  it('ignores a malformed one rather than inventing a verb', () => {
    expect(tapIn({ on_tap: {} })).toBeUndefined();
    expect(tapIn({ on_tap: 'page' })).toBeUndefined();
    expect(tapIn({ on_tap: { do: '' } })).toBeUndefined();
  });
});

describe('@room reads two ways', () => {
  it('is the room name where a person reads it', () => {
    // The breadcrumb said "@room" until this existed.
    // Humanised, like every other identifier a person reads (`text.ts`).
    expect(resolveConfig({ text: '@room' }, [], { room: 'family_room' })['text']).toBe(
      'Family room',
    );
    expect(resolveConfig({ heading: '@room' }, [], { room: 'office' })['heading']).toBe('Office');
  });

  it('is left alone where it selects', () => {
    // `area_name` matches on the slug; substituting the name would break it.
    const out = resolveConfig({ area_name: '@room', room: '@room' }, [], { room: 'family_room' });
    expect(out['area_name']).toBe('@room');
    expect(out['room']).toBe('@room');
  });

  it('is empty rather than the token when no room is chosen', () => {
    expect(resolveConfig({ text: '@room' }, [], {})['text']).toBe('');
  });
});
