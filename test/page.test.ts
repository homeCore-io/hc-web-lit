import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionsIn, actuates, tapIn } from '../src/core/actions.js';
import { resolveConfig } from '../src/core/bindings.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import { DeviceStore } from '../src/core/store.js';
import '../src/shell/hc-page.js';
import '../src/widgets/hc-text.js';
import { HcPage as HcPageClass } from '../src/shell/hc-page.js';
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

  it('borrows a layout rather than reporting the size it lacks', async () => {
    // It used to say "this page has no tv layout", which is true and leaves a
    // screen with nothing on it. Every dashboard in the reference house is
    // desktop-only, so that sentence was the whole product on a phone.
    const el = await mount(
      base({
        layouts: [
          {
            breakpoint: 'desktop',
            columns: 12,
            row_height: 120,
            gap: 12,
            placements: [{ widget_id: 'a', x: 0, y: 0, w: 6, h: 1 }],
          },
        ],
        widgets: [{ id: 'a', type: 'text', config: { text: 'Drawn anyway' } }],
      }),
      'tv',
    );
    expect(el.shadowRoot?.textContent).not.toContain('no tv layout');
    expect(el.shadowRoot?.querySelectorAll('.placed,.cell').length).toBe(1);
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

  it('always has a hold, because §5.10 says inspecting is always available', () => {
    // The guarantee lives in the model, not in each widget's good intentions.
    expect(actionsIn(undefined).hold).toEqual({ do: 'details' });
    expect(actionsIn({ on_tap: { do: 'page' } }).hold).toEqual({ do: 'details' });
    expect(actionsIn({ on_hold: { do: 'none' } }).hold).toEqual({ do: 'none' });
  });

  it('reads all three gestures', () => {
    const got = actionsIn({
      on_tap: { do: 'toggle', device_id: 'hue_1' },
      on_double_tap: { do: 'url', target: 'https://example.test' },
    });
    expect(got.tap).toEqual({ do: 'toggle', device_id: 'hue_1' });
    expect(got.doubleTap).toEqual({ do: 'url', target: 'https://example.test' });
  });

  it('knows which verbs reach into the house', () => {
    // The safety policy applies to these and not the rest: navigating cannot
    // unlock a door, and confirming it would teach somebody to confirm
    // without reading (§11.3).
    expect(actuates({ do: 'toggle' })).toBe(true);
    expect(actuates({ do: 'service', service: 'press_button' })).toBe(true);
    expect(actuates({ do: 'page' })).toBe(false);
    expect(actuates({ do: 'details' })).toBe(false);
  });

  it('carries the fields a service call needs', () => {
    expect(
      tapIn({ on_tap: { do: 'service', service: 'press_button', payload: { button: 3 } } }),
    ).toEqual({ do: 'service', service: 'press_button', payload: { button: 3 } });
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

describe('what a composed page does on a narrower screen', () => {
  const composed = (fit: 'scroll' | 'contain' | 'cover'): DashboardDefinition =>
    base({
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 120,
          gap: 12,
          flow: 'free',
          frame: { width: 1240, height: 1248, fit },
          placements: [
            { widget_id: 'h', x: 0, y: 0, w: 12, h: 1, rect: { x: 0, y: 0, w: 600, h: 48 } },
          ],
        },
      ],
      widgets: [{ id: 'h', type: 'text', config: { text: 'x' } }],
    }) as DashboardDefinition;

  it('leaves a scrolling frame at the size it was drawn', async () => {
    // The reference house says `scroll` on a 1240px canvas. Scaling that onto
    // a phone would render three-pixel type, which is not what scroll means.
    const el = await mount(composed('scroll'));
    const frame = el.shadowRoot?.querySelector('.frame') as HTMLElement;
    expect(frame.style.transform).toBe('scale(1)');
  });

  it('fits a containing frame to the room it has', async () => {
    const el = await mount(composed('contain'));
    el.fitWidth = 620;
    await el.updateComplete;
    const frame = el.shadowRoot?.querySelector('.frame') as HTMLElement;
    expect(frame.style.transform).toBe('scale(0.5)');
  });
});

describe('a widget larger than its placement', () => {
  it('is clipped to the box the author drew', () => {
    // Twelve device cards in a short rect escaped and drew over three
    // neighbouring placements. A page that lets that happen has stopped being
    // the arrangement somebody saved.
    //
    // Asserted against the rule rather than the computed style: jsdom does not
    // apply adopted stylesheets, so `getComputedStyle` here would report the
    // empty string whether the rule existed or not — a test that cannot fail.
    const css = [HcPageClass.styles].flat().map(String).join('\n');
    expect(css).toMatch(/\.placed\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.cell\s*\{[^}]*overflow:\s*hidden/);
  });
});

describe('a page being edited, rather than a page being left', () => {
  const withText = (id: string, text: string): DashboardDefinition =>
    base({
      widgets: [{ id, type: 'text', config: { text } }],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 120,
          gap: 12,
          placements: [{ widget_id: id, x: 0, y: 0, w: 6, h: 1 }],
        },
      ],
    });

  const drawn = (el: HcPage): Element | null | undefined => el.shadowRoot?.querySelector('hc-text');

  // The widget has its own shadow root, so its words are a level down.
  const says = (el: HcPage): string => drawn(el)?.shadowRoot?.textContent ?? '';

  it('keeps its elements when the same page changes', async () => {
    // Editing a page hands this element a new document object several times a
    // minute. Rebuilding every widget each time re-fetches a chart's six
    // hours of readings, reloads a media card's art, and loses whatever a
    // widget was in the middle of.
    const el = await mount(withText('t', 'One'));
    const first = drawn(el);

    el.doc = withText('t', 'Two');
    await el.updateComplete;

    expect(drawn(el)).toBe(first);
    expect(says(el)).toContain('Two');
  });

  it('rebuilds when it is a different page', async () => {
    // Widget ids are unique within a document and not across them, so an
    // element cached from the last page would be handed the wrong config.
    const el = await mount(withText('t', 'One'));
    const first = drawn(el);

    el.doc = { ...withText('t', 'Elsewhere'), id: 'other' };
    await el.updateComplete;

    expect(drawn(el)).not.toBe(first);
  });

  it('forgets a widget that is no longer on the page', async () => {
    // A cache that only grows is a leak on a panel that runs for months, and
    // an id that came back would find a stale element.
    const el = await mount(withText('t', 'One'));
    const first = drawn(el);

    el.doc = { ...withText('t', 'One'), widgets: [] };
    await el.updateComplete;
    el.doc = withText('t', 'Back');
    await el.updateComplete;

    expect(drawn(el)).not.toBe(first);
    expect(says(el)).toContain('Back');
  });
});

describe('a page being arranged rather than used', () => {
  const tappable = (): DashboardDefinition =>
    base({
      widgets: [{ id: 't', type: 'text', config: { text: 'Hall', on_tap: { do: 'toggle' } } }],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 120,
          gap: 12,
          placements: [{ widget_id: 't', x: 0, y: 0, w: 6, h: 1 }],
        },
      ],
    });

  const press = (el: HcPage): void => {
    const card = el.shadowRoot?.querySelector('hc-text') as HTMLElement | null;
    card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  it('does nothing when a placement is pressed', async () => {
    // Arranging a page means pressing on the things on it, and the things on
    // a page are a household's locks and lights.
    const ran = vi.fn();
    const el = document.createElement('hc-page');
    el.doc = tappable();
    el.store = new DeviceStore();
    el.onAction = ran;
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;

    press(el);
    expect(ran).not.toHaveBeenCalled();
  });

  it('acts again the moment it stops being edited', async () => {
    // The listeners are attached once and the element is reused, so a mode
    // read at attach time would leave the page inert for good.
    const ran = vi.fn();
    const el = document.createElement('hc-page');
    el.doc = tappable();
    el.store = new DeviceStore();
    el.onAction = ran;
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;
    press(el);
    expect(ran).not.toHaveBeenCalled();

    el.mode = 'view';
    await el.updateComplete;
    press(el);
    expect(ran).toHaveBeenCalledWith({ do: 'toggle' });
  });
});

/**
 * jsdom has neither `PointerEvent` nor pointer capture.
 *
 * Shimmed rather than skipped: the arithmetic between a finger and a cell is
 * the part worth pinning, and it does not need a real browser to be wrong. The
 * gesture itself is checked in one.
 */
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

function shimPointers(): void {
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

describe('dragging a widget on a page being arranged', () => {
  beforeEach(shimPointers);

  const page = (): DashboardDefinition =>
    base({
      widgets: [{ id: 't', type: 'text', config: { text: 'Hall' } }],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 100,
          gap: 0,
          placements: [{ widget_id: 't', x: 0, y: 0, w: 6, h: 2 }],
        },
      ],
    });

  const arranged = async (placed: (id: string, box: unknown) => Promise<void>): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = page();
    el.store = new DeviceStore();
    el.onPlaceWidget = placed;
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;

    // jsdom lays nothing out, so the grid has no width to measure — and a
    // drag that cannot be measured moves nothing, deliberately. 1200px over
    // 12 columns with no gap is 100px a cell, which is what the numbers below
    // assume.
    const grid = el.shadowRoot?.querySelector('.grid');
    Object.defineProperty(grid as Element, 'clientWidth', { value: 1200, configurable: true });
    return el;
  };

  /** The handle by name, so a missing one fails as a missing handle. */
  const handleIn = (el: HcPage, which: 'grab' | 'grip'): Element => {
    const found = el.shadowRoot?.querySelector(`.${which}`);
    expect(found, `no .${which} handle`).not.toBeNull();
    return found as Element;
  };

  const drag = (handle: Element, byX: number, byY: number): void => {
    handle.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: byX, clientY: byY, pointerId: 1 }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: byX, clientY: byY, pointerId: 1 }),
    );
  };

  it('offers no handles while the page is being used', async () => {
    const el = document.createElement('hc-page');
    el.doc = page();
    el.store = new DeviceStore();
    el.onPlaceWidget = async () => undefined;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.grab')).toBeNull();
  });

  it('moves by whole cells, which is the magnet', async () => {
    // §14.1's coarse magnet on a packed page is not a separate rule: a cell
    // is the unit, so rounding the pixels to cells is the magnet.
    const placed = vi.fn(async () => undefined);
    const el = await arranged(placed);
    drag(handleIn(el, 'grab'), 250, 200);
    expect(placed).toHaveBeenCalledWith('t', { x: 3, y: 2, w: 6, h: 2 });
  });

  it('resizes from the other corner', async () => {
    const placed = vi.fn(async () => undefined);
    const el = await arranged(placed);
    drag(handleIn(el, 'grip'), 200, 100);
    expect(placed).toHaveBeenCalledWith('t', { x: 0, y: 0, w: 8, h: 3 });
  });

  it('does not write when nothing moved', async () => {
    // A press that moved nothing is a press, and writing the numbers it
    // already had would be a save nobody asked for.
    const placed = vi.fn(async () => undefined);
    const el = await arranged(placed);
    drag(handleIn(el, 'grab'), 3, 2);
    expect(placed).not.toHaveBeenCalled();
  });

  it('never moves a widget off the page', async () => {
    // Dragged hard to the left and a little down: the left edge holds and the
    // move down still happens.
    const placed = vi.fn(async () => undefined);
    const el = await arranged(placed);
    drag(handleIn(el, 'grab'), -900, 200);
    expect(placed).toHaveBeenCalledWith('t', { x: 0, y: 2, w: 6, h: 2 });
  });

  it('is not a move when the clamp puts it back where it was', async () => {
    const placed = vi.fn(async () => undefined);
    const el = await arranged(placed);
    drag(handleIn(el, 'grab'), -900, -900);
    expect(placed).not.toHaveBeenCalled();
  });

  it('keeps a widget grabbable, however small it is dragged', async () => {
    const placed = vi.fn(async () => undefined);
    const el = await arranged(placed);
    drag(handleIn(el, 'grip'), -900, -900);
    expect(placed).toHaveBeenCalledWith('t', { x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('drawing a widget with a tool held (§14.1)', () => {
  beforeEach(shimPointers);

  const page = (): DashboardDefinition =>
    base({
      widgets: [{ id: 't', type: 'text', config: { text: 'Hall' } }],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 100,
          gap: 0,
          placements: [{ widget_id: 't', x: 0, y: 0, w: 6, h: 2 }],
        },
      ],
    });

  /**
   * A page with a tool held, laid out so a cell is 100px square.
   *
   * jsdom lays nothing out, so `getBoundingClientRect` is all zeros and the
   * grid's origin is the viewport's — which makes the arithmetic below read
   * directly: clientX 250 is column 2.
   */
  const holding = async (
    drew: (type: string, box: unknown) => Promise<void>,
    over: Partial<HcPage> = {},
  ): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = page();
    el.store = new DeviceStore();
    el.onDrawWidget = drew;
    el.onPlaceWidget = async () => undefined;
    el.mode = 'edit';
    el.tool = 'toggle';
    Object.assign(el, over);
    document.body.append(el);
    await el.updateComplete;

    const grid = el.shadowRoot?.querySelector('.grid');
    Object.defineProperty(grid as Element, 'clientWidth', { value: 1200, configurable: true });
    return el;
  };

  const surface = (el: HcPage): Element => {
    const found = el.shadowRoot?.querySelector('.grid');
    expect(found, 'no .grid surface').not.toBeNull();
    return found as Element;
  };

  const draw = (on: Element, from: [number, number], to: [number, number]): void => {
    on.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: from[0],
        clientY: from[1],
        pointerId: 1,
      }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1 }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: to[0], clientY: to[1], pointerId: 1 }),
    );
  };

  it('makes the widget at the size and place it was dragged', async () => {
    // The whole of §14.1's drag-to-create: the thing exists where you drew it,
    // rather than at the bottom of the page for you to then go and move.
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    draw(surface(el), [250, 200], [450, 400]);
    expect(drew).toHaveBeenCalledWith('toggle', { x: 2, y: 2, w: 3, h: 3 });
  });

  it('counts cells inclusively, because a cell is a thing you land on', async () => {
    // Pressing and releasing inside one cell is one cell, not none — the
    // off-by-one that gives a widget one column less than somebody drew.
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    draw(surface(el), [210, 210], [290, 290]);
    expect(drew).toHaveBeenCalledWith('toggle', { x: 2, y: 2, w: 1, h: 1 });
  });

  it('draws the same rectangle whichever corner it started from', async () => {
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    draw(surface(el), [450, 400], [250, 200]);
    expect(drew).toHaveBeenCalledWith('toggle', { x: 2, y: 2, w: 3, h: 3 });
  });

  it('gives a press that never travelled the size the catalogue would', async () => {
    // A tool held and pressed does something rather than nothing: refusing
    // would be a mode that is armed and inert, which reads as broken.
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    draw(surface(el), [250, 200], [252, 201]);
    expect(drew).toHaveBeenCalledWith('toggle', { x: 2, y: 2, w: 6, h: 2 });
  });

  it('never draws off the left or top of the page', async () => {
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    draw(surface(el), [250, 200], [-900, -900]);
    expect(drew).toHaveBeenCalledWith('toggle', { x: 0, y: 0, w: 3, h: 3 });
  });

  it('shows where the widget will land while the finger is down', async () => {
    const el = await holding(async () => undefined);
    const on = surface(el);
    on.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 250,
        clientY: 200,
        pointerId: 1,
      }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 450, clientY: 400, pointerId: 1 }),
    );
    await el.updateComplete;

    const preview = el.shadowRoot?.querySelector('.drawing') as HTMLElement;
    expect(preview, 'nothing showed where the widget would land').not.toBeNull();
    expect(preview.style.gridColumn).toBe('3/span 3');
    expect(preview.style.gridRow).toBe('3/span 3');
  });

  it('puts the preview away when the finger comes up', async () => {
    const el = await holding(async () => undefined);
    draw(surface(el), [250, 200], [450, 400]);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.drawing')).toBeNull();
  });

  it('arms the surface only while a tool is held', async () => {
    const el = await holding(async () => undefined);
    expect(surface(el).hasAttribute('data-armed')).toBe(true);

    el.tool = undefined;
    await el.updateComplete;
    expect(surface(el).hasAttribute('data-armed')).toBe(false);
  });

  it('draws nothing on a page being used rather than arranged', async () => {
    // A tool held into view mode would mean a press on a light drawing a
    // rectangle, which is §14.2's rule from the other side.
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew, { mode: 'view' });
    draw(surface(el), [250, 200], [450, 400]);
    expect(drew).not.toHaveBeenCalled();
  });

  it('draws nothing for a session that may not write pages', async () => {
    // §5.11: not offered rather than offered and refused. A shell that handed
    // over a tool without the means to use it must not arm the surface.
    const el = await holding(async () => undefined, { onDrawWidget: undefined });
    expect(surface(el).hasAttribute('data-armed')).toBe(false);
  });

  it('makes room below the page to draw into', async () => {
    // A CSS grid is exactly as tall as its rows, so without this the empty
    // space somebody reaches for to put the next widget does not exist.
    const el = await holding(async () => undefined);
    // Two rows used, three spare, 100px a row.
    expect((surface(el) as HTMLElement).style.minHeight).toBe('500px');

    el.tool = undefined;
    await el.updateComplete;
    expect((surface(el) as HTMLElement).style.minHeight).toBe('');
  });
});

describe('drawing on a composed page, where the units are pixels', () => {
  beforeEach(shimPointers);

  const holding = async (drew: (type: string, box: unknown) => Promise<void>): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = base({
      widgets: [{ id: 'h', type: 'text', config: { text: 'EVERY ROOM' } }],
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
    });
    el.store = new DeviceStore();
    el.onDrawWidget = drew;
    el.mode = 'edit';
    el.tool = 'text';
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const draw = (on: Element, from: [number, number], to: [number, number]): void => {
    on.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: from[0],
        clientY: from[1],
        pointerId: 1,
      }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1 }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: to[0], clientY: to[1], pointerId: 1 }),
    );
  };

  it('measures pixels as a distance, not as cells to land on', async () => {
    // The inclusive +1 a grid gets would be a pixel too wide here, and a
    // composed page has no cells to round to at all.
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    const frame = el.shadowRoot?.querySelector('.frame') as Element;
    draw(frame, [100, 100], [400, 300]);
    expect(drew).toHaveBeenCalledWith('text', { x: 100, y: 100, w: 300, h: 200 });
  });

  it('keeps a drawn widget big enough to grab again', async () => {
    const drew = vi.fn(async () => undefined);
    const el = await holding(drew);
    const frame = el.shadowRoot?.querySelector('.frame') as Element;
    draw(frame, [100, 100], [110, 108]);
    expect(drew).toHaveBeenCalledWith('text', { x: 100, y: 100, w: 40, h: 40 });
  });
});
