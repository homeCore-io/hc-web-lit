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

/** A group-move spy that keeps its argument types, so the calls can be read. */
type Moves = readonly { id: string; box: { x: number; y: number; w: number; h: number } }[];
const groupSpy = () => vi.fn(async (_moves: Moves) => undefined);

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
    expect(css).toMatch(/\.body\s*\{[^}]*overflow:\s*hidden/);
  });

  it('clips the widget and not the box that holds the handles', async () => {
    // The clip used to be on `.placed`, which also holds free mode's handles —
    // and the turn handle sits *above* the card, so the clip deleted the
    // handle rather than the overflow. Two things wanting opposite treatment,
    // so they are two elements now.
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
            { widget_id: 'h', x: 0, y: 0, w: 12, h: 1, rect: { x: 100, y: 100, w: 200, h: 100 } },
          ],
        },
      ],
    });
    el.store = new DeviceStore();
    el.onPlaceWidget = async () => undefined;
    el.onTurnWidget = async () => undefined;
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;

    const placed = el.shadowRoot?.querySelector('.placed') as HTMLElement;
    // The handles are children of the unclipped box, beside the clipped body.
    expect(placed.querySelector(':scope > .turn')).not.toBeNull();
    expect(placed.querySelector(':scope > .body')).not.toBeNull();
    expect(placed.querySelector('.body .turn')).toBeNull();
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
  });

  it('keeps that room for the whole of edit mode, not only while armed', async () => {
    // Putting the tool down must not take the surface away: a rubber band
    // starts on it too, and so does the press that clears a selection. While
    // this was tied to the tool, the only place to begin either was the gaps
    // between cards.
    const el = await holding(async () => undefined);
    el.tool = undefined;
    await el.updateComplete;
    expect((surface(el) as HTMLElement).style.minHeight).toBe('500px');

    el.mode = 'view';
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

describe('picking more than one, and moving them together (§14.2)', () => {
  beforeEach(shimPointers);

  /** Three cards in a row, each two cells wide, so a band can reach two. */
  const page = (): DashboardDefinition =>
    base({
      widgets: [
        { id: 'a', type: 'text', config: { text: 'a' } },
        { id: 'b', type: 'text', config: { text: 'b' } },
        { id: 'c', type: 'text', config: { text: 'c' } },
      ],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 100,
          gap: 0,
          placements: [
            { widget_id: 'a', x: 1, y: 0, w: 2, h: 1 },
            { widget_id: 'b', x: 3, y: 0, w: 2, h: 1 },
            { widget_id: 'c', x: 8, y: 0, w: 2, h: 1 },
          ],
        },
      ],
    });

  /**
   * jsdom lays nothing out, so every `getBoundingClientRect` is zeros and a
   * band would sweep up everything or nothing. The rects are stubbed from the
   * placements — 100px a cell — which is what a browser would have measured.
   */
  const arranged = async (over: Partial<HcPage> = {}): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = page();
    el.store = new DeviceStore();
    el.onPlaceWidget = async () => undefined;
    el.mode = 'edit';
    Object.assign(el, over);
    document.body.append(el);
    await el.updateComplete;

    const grid = el.shadowRoot?.querySelector('.grid');
    Object.defineProperty(grid as Element, 'clientWidth', { value: 1200, configurable: true });
    place(el);
    return el;
  };

  /** Give each drawn cell the rect its placement says it occupies. */
  const place = (el: HcPage): void => {
    const at: Record<string, [number, number]> = { a: [100, 2], b: [300, 2], c: [800, 2] };
    for (const cell of el.shadowRoot?.querySelectorAll('[data-widget]') ?? []) {
      const [left, cells] = at[cell.getAttribute('data-widget') ?? ''] ?? [0, 1];
      cell.getBoundingClientRect = () =>
        ({ left, right: left + cells * 100, top: 0, bottom: 100 }) as DOMRect;
    }
  };

  const pickedIn = (el: HcPage): string[] =>
    [...(el.shadowRoot?.querySelectorAll('[data-picked]') ?? [])].map(
      (e) => e.getAttribute('data-widget') ?? '',
    );

  const surface = (el: HcPage): Element => el.shadowRoot?.querySelector('.grid') as Element;

  const sweep = (
    on: Element,
    from: [number, number],
    to: [number, number],
    init: MouseEventInit = {},
  ): void => {
    on.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: from[0],
        clientY: from[1],
        pointerId: 1,
        ...init,
      }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1 }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: to[0], clientY: to[1], pointerId: 1 }),
    );
  };

  it('takes everything the band touches, not only what it contains', async () => {
    // A band has to reach round every card it means to take, and on a page of
    // wide cards that is most of the width — so containment makes the gesture
    // unusable at exactly the size of thing it is for.
    const el = await arranged();
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    expect(pickedIn(el).sort()).toEqual(['a', 'b']);
  });

  it('leaves alone what the band never reached', async () => {
    const el = await arranged();
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    expect(pickedIn(el)).not.toContain('c');
  });

  it('replaces the selection on a plain sweep and adds to it on shift', async () => {
    const el = await arranged();
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;

    sweep(surface(el), [820, 20], [980, 60], { shiftKey: true });
    await el.updateComplete;
    expect(pickedIn(el).sort()).toEqual(['a', 'b', 'c']);

    sweep(surface(el), [820, 20], [980, 60]);
    await el.updateComplete;
    expect(pickedIn(el)).toEqual(['c']);
  });

  it('shows the band while the finger is down and puts it away after', async () => {
    const el = await arranged();
    const on = surface(el);
    on.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 20,
        pointerId: 1,
      }),
    );
    on.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 250, clientY: 60, pointerId: 1 }),
    );
    await el.updateComplete;

    const band = el.shadowRoot?.querySelector('.band') as HTMLElement;
    expect(band, 'no rubber band while sweeping').not.toBeNull();
    expect(band.style.left).toBe('50px');
    expect(band.style.width).toBe('200px');

    on.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 250, clientY: 60, pointerId: 1 }),
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.band')).toBeNull();
  });

  it('is a click and not a sweep when the finger never travelled', async () => {
    // A press on a card picks that card; a press on the gaps clears, which is
    // where somebody presses to mean "never mind" without reaching for a key.
    const el = await arranged();
    sweep(surface(el), [150, 20], [152, 21]);
    await el.updateComplete;
    expect(pickedIn(el)).toEqual(['a']);

    sweep(surface(el), [600, 400], [600, 400]);
    await el.updateComplete;
    expect(pickedIn(el)).toEqual([]);
  });

  it('moves everything picked by one delta, in one write', async () => {
    const many = groupSpy();
    const one = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidgets: many, onPlaceWidget: one });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    place(el);

    const grab = el.shadowRoot?.querySelector('[data-widget="a"] .grab') as Element;
    grab.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 300, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 300, clientY: 0, pointerId: 1 }),
    );

    expect(one).not.toHaveBeenCalled();
    expect(many).toHaveBeenCalledTimes(1);
    expect(many.mock.calls[0]?.[0]).toEqual([
      { id: 'a', box: { x: 4, y: 0, w: 2, h: 1 } },
      { id: 'b', box: { x: 6, y: 0, w: 2, h: 1 } },
    ]);
  });

  it('shortens the delta rather than deforming the group at the edge', async () => {
    // Clamping each card on its own is how a selection arrives somewhere
    // deformed: the leftmost stops at column 0 and the others keep going.
    const many = groupSpy();
    const el = await arranged({ onPlaceWidgets: many });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    place(el);

    const grab = el.shadowRoot?.querySelector('[data-widget="b"] .grab') as Element;
    grab.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: -300, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: -300, clientY: 0, pointerId: 1 }),
    );

    // Three cells left was asked for and one was available, because `a` sits
    // at column 1. Both move by that one, and the two are still two cells
    // apart — which is the whole point. Clamping each on its own would have
    // put `a` at 0 and `b` at 0 too, three cells from where it started.
    expect(many.mock.calls[0]?.[0]).toEqual([
      { id: 'a', box: { x: 0, y: 0, w: 2, h: 1 } },
      { id: 'b', box: { x: 2, y: 0, w: 2, h: 1 } },
    ]);
  });

  it('writes nothing at all when the clamp leaves the group where it was', async () => {
    // The same rule a single card follows: a press that moved nothing is a
    // press, and writing the numbers it already had is a save nobody asked for.
    const many = groupSpy();
    const el = await arranged({ onPlaceWidgets: many });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    place(el);

    const grab = el.shadowRoot?.querySelector('[data-widget="a"] .grab') as Element;
    grab.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 0, clientY: -900, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 0, clientY: -900, pointerId: 1 }),
    );

    expect(many).not.toHaveBeenCalled();
  });

  it('grabbing an unpicked card picks it and leaves the rest', async () => {
    const many = groupSpy();
    const one = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidgets: many, onPlaceWidget: one });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    place(el);

    const grab = el.shadowRoot?.querySelector('[data-widget="c"] .grab') as Element;
    grab.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 100, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 100, clientY: 0, pointerId: 1 }),
    );

    expect(many).not.toHaveBeenCalled();
    expect(one).toHaveBeenCalledWith('c', { x: 9, y: 0, w: 2, h: 1 });
  });

  it('resizes one card even when several are picked', async () => {
    // §14.1 gives grid mode one grip; a group resize is a free-mode gesture
    // with eight handles and a group frame.
    const many = groupSpy();
    const one = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidgets: many, onPlaceWidget: one });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    place(el);

    const grip = el.shadowRoot?.querySelector('[data-widget="a"] .grip') as Element;
    grip.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    grip.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 200, clientY: 0, pointerId: 1 }),
    );
    grip.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 200, clientY: 0, pointerId: 1 }),
    );

    expect(many).not.toHaveBeenCalled();
    expect(one).toHaveBeenCalledWith('a', { x: 1, y: 0, w: 4, h: 1 });
  });

  it('falls back to one write at a time for a host with no group door', async () => {
    const one = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidget: one, onPlaceWidgets: undefined });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    place(el);

    const grab = el.shadowRoot?.querySelector('[data-widget="a"] .grab') as Element;
    grab.dispatchEvent(
      new FakePointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 300, clientY: 0, pointerId: 1 }),
    );
    grab.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 300, clientY: 0, pointerId: 1 }),
    );

    // One at a time means one *await* at a time, so the second write is a
    // microtask behind the gesture rather than part of it.
    await new Promise((r) => setTimeout(r, 0));
    expect(one).toHaveBeenCalledTimes(2);
  });

  it('picks nothing while the page is being used', async () => {
    const el = await arranged({ mode: 'view' });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    expect(pickedIn(el)).toEqual([]);
  });

  it('forgets the selection when arranging stops', async () => {
    const el = await arranged();
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    expect(pickedIn(el)).toHaveLength(2);

    el.mode = 'view';
    await el.updateComplete;
    expect(pickedIn(el)).toEqual([]);
  });

  it('forgets the selection on another page, and keeps it on an edit', async () => {
    const el = await arranged();
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;

    // The same page, edited: ids still mean what they meant.
    el.doc = { ...page(), name: 'D, edited' };
    await el.updateComplete;
    place(el);
    expect(pickedIn(el)).toHaveLength(2);

    // Another page: ids are unique within a document and not across them.
    el.doc = { ...page(), id: 'other' };
    await el.updateComplete;
    expect(pickedIn(el)).toEqual([]);
  });

  it('does not sweep while a tool is held, because that press draws', async () => {
    const drew = vi.fn(async () => undefined);
    const el = await arranged({ tool: 'toggle', onDrawWidget: drew });
    sweep(surface(el), [150, 20], [350, 60]);
    await el.updateComplete;
    expect(drew).toHaveBeenCalled();
    expect(pickedIn(el)).toEqual([]);
  });
});

describe('composing with eight handles and a turn (§14.1)', () => {
  beforeEach(shimPointers);

  const composed = (over: Partial<DashboardDefinition> = {}): DashboardDefinition =>
    base({
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
            { widget_id: 'h', x: 0, y: 0, w: 12, h: 1, rect: { x: 100, y: 100, w: 200, h: 100 } },
          ],
        },
      ],
      ...over,
    });

  const arranged = async (over: Partial<HcPage> = {}): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = composed();
    el.store = new DeviceStore();
    el.onPlaceWidget = async () => undefined;
    el.onTurnWidget = async () => undefined;
    el.mode = 'edit';
    Object.assign(el, over);
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const pull = (el: HcPage, which: string, byX: number, byY: number): void => {
    const handle = el.shadowRoot?.querySelector(`.${which.replace(/ /g, '.')}`);
    expect(handle, `no ${which} handle`).not.toBeNull();
    const at = handle as Element;
    at.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }),
    );
    at.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: byX, clientY: byY, pointerId: 1 }),
    );
    at.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: byX, clientY: byY, pointerId: 1 }),
    );
  };

  it('offers eight handles and a turn where a packed page gets one grip', async () => {
    const el = await arranged();
    expect(el.shadowRoot?.querySelectorAll('.edge')).toHaveLength(8);
    expect(el.shadowRoot?.querySelector('.turn')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('.grip')).toBeNull();
  });

  it('still offers a packed page exactly one grip and no turn', async () => {
    // §14.1: a packed card is anchored top-left and only its extent is in
    // question, so a second handle offers an edit the engine would undo.
    const el = document.createElement('hc-page');
    el.doc = base({
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
    el.store = new DeviceStore();
    el.onPlaceWidget = async () => undefined;
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll('.edge')).toHaveLength(0);
    expect(el.shadowRoot?.querySelector('.turn')).toBeNull();
    expect(el.shadowRoot?.querySelector('.grip')).not.toBeNull();
  });

  it('pulls the left edge without moving the right', async () => {
    // Dragged to 56, which is on the fine grid, so the magnet is not what this
    // is measuring: the right edge stays at 300 and the width absorbs it all.
    const placed = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidget: placed });
    pull(el, 'edge left', -44, 0);
    expect(placed).toHaveBeenCalledWith('h', { x: 56, y: 100, w: 244, h: 100 });
  });

  it('snaps a composed edge to the fine grid, not to a column', async () => {
    // A text box snapped to a 120px cell can be 120 wide or 240 and nothing
    // between, so it is never the width of its own words.
    const placed = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidget: placed });
    pull(el, 'edge right', 3, 0);
    expect(placed).toHaveBeenCalledWith('h', { x: 100, y: 100, w: 204, h: 100 });
  });

  it('takes both axes from a corner', async () => {
    const placed = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidget: placed });
    pull(el, 'edge top-left', -44, -20);
    expect(placed).toHaveBeenCalledWith('h', { x: 56, y: 80, w: 244, h: 120 });
  });

  it('draws the angle the document stores, which nothing did before', async () => {
    const el = await arranged();
    el.doc = composed({
      layouts: [
        {
          ...composed().layouts![0]!,
          placements: [
            {
              widget_id: 'h',
              x: 0,
              y: 0,
              w: 12,
              h: 1,
              rect: { x: 100, y: 100, w: 200, h: 100 },
              angle: 30,
            },
          ],
        },
      ],
    });
    await el.updateComplete;
    const placed = el.shadowRoot?.querySelector('.placed') as HTMLElement;
    expect(placed.style.transform).toBe('rotate(30deg)');
  });

  it('turns a card by how far round the finger went', async () => {
    const turned = vi.fn(async (_id: string, _angle: number) => undefined);
    const el = await arranged({ onTurnWidget: turned });

    // The card's centre, measured off the drawn box — stubbed, because jsdom
    // lays nothing out. Grabbed due east of it and carried due south.
    const card = el.shadowRoot?.querySelector('[data-widget="h"]') as Element;
    card.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 200, height: 100, right: 300, bottom: 200 }) as DOMRect;

    const handle = el.shadowRoot?.querySelector('.turn') as Element;
    handle.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 150,
        pointerId: 1,
      }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 200, clientY: 250, pointerId: 1 }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 200, clientY: 250, pointerId: 1 }),
    );

    expect(turned).toHaveBeenCalledTimes(1);
    expect(turned.mock.calls[0]?.[1]).toBeCloseTo(90, 6);
  });

  it('offers no turn handle to a host that cannot write one', async () => {
    // §5.11 again: not offered rather than offered and refused.
    const el = await arranged({ onTurnWidget: undefined });
    const handle = el.shadowRoot?.querySelector('.turn') as Element;
    // The handle is drawn — free mode always shows it — but pressing it
    // starts nothing, so there is no gesture that ends in a throw.
    handle.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 150,
        pointerId: 1,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[data-dragging]')).toBeNull();
  });
});

describe('guides while composing (§14.1)', () => {
  beforeEach(shimPointers);

  /** Two cards: one to drag, one to line it up against. */
  const page = (): DashboardDefinition =>
    base({
      widgets: [
        { id: 'a', type: 'text', config: { text: 'a' } },
        { id: 'b', type: 'text', config: { text: 'b' } },
      ],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 120,
          gap: 12,
          flow: 'free',
          frame: { width: 1240, height: 1248, fit: 'scroll' },
          placements: [
            { widget_id: 'a', x: 0, y: 0, w: 2, h: 1, rect: { x: 100, y: 500, w: 100, h: 40 } },
            { widget_id: 'b', x: 0, y: 0, w: 2, h: 1, rect: { x: 401, y: 50, w: 100, h: 300 } },
          ],
        },
      ],
    });

  const arranged = async (over: Partial<HcPage> = {}): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = page();
    el.store = new DeviceStore();
    el.onPlaceWidget = async () => undefined;
    el.mode = 'edit';
    Object.assign(el, over);
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const grabIn = (el: HcPage, id: string): Element => {
    const card = [...(el.shadowRoot?.querySelectorAll('[data-widget]') ?? [])].find(
      (e) => e.getAttribute('data-widget') === id,
    );
    return card?.querySelector('.grab') as Element;
  };

  const dragBy = (handle: Element, byX: number, byY: number): void => {
    handle.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: byX, clientY: byY, pointerId: 1 }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: byX, clientY: byY, pointerId: 1 }),
    );
  };

  it('pulls a dragged card onto a neighbour’s edge', async () => {
    // `a` starts at x=100 and is dragged 200 right, to 300 — three short of
    // `b`'s off-grid left edge at 401 once its own right edge is counted. The
    // fine grid alone would have left it at 300.
    const placed = vi.fn(async () => undefined);
    const el = await arranged({ onPlaceWidget: placed });
    dragBy(grabIn(el, 'a'), 201, 0);
    expect(placed).toHaveBeenCalledWith('a', { x: 301, y: 500, w: 100, h: 40 });
  });

  it('shows the line it lined up with, and takes it away afterwards', async () => {
    const el = await arranged();
    const handle = grabIn(el, 'a');
    handle.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 201, clientY: 0, pointerId: 1 }),
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.guide').length).toBeGreaterThan(0);

    handle.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 201, clientY: 0, pointerId: 1 }),
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.guide')).toBeNull();
  });

  it('draws no guide when nothing is near enough', async () => {
    const el = await arranged();
    const handle = grabIn(el, 'a');
    handle.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }),
    );
    handle.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 600, clientY: 600, pointerId: 1 }),
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.guide')).toBeNull();
  });

  it('does not line a card up with something it is carrying', async () => {
    // A group dragged as one would otherwise match its own members on every
    // edge from the first pixel, and be welded in place.
    const many = vi.fn(async (_moves: Moves) => undefined);
    const el = await arranged({ onPlaceWidgets: many });

    // Pick both, then drag: the pull that would have happened is absent.
    const surface = el.shadowRoot?.querySelector('.frame') as Element;
    surface.dispatchEvent(
      new FakePointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }),
    );
    surface.dispatchEvent(
      new FakePointerEvent('pointermove', { clientX: 2000, clientY: 2000, pointerId: 1 }),
    );
    surface.dispatchEvent(
      new FakePointerEvent('pointerup', { clientX: 2000, clientY: 2000, pointerId: 1 }),
    );
    await el.updateComplete;

    dragBy(grabIn(el, 'a'), 201, 0);
    expect(many).toHaveBeenCalledTimes(1);
    const moves = many.mock.calls[0]?.[0] ?? [];
    // Moved by the raw 201, not pulled to 301 by the card travelling with it.
    expect(moves.find((m) => m.id === 'a')?.box.x).toBe(301);
  });

  it('leaves a packed page to the cells, which have nothing finer to catch', async () => {
    const placed = vi.fn(async () => undefined);
    const el = document.createElement('hc-page');
    el.doc = base({
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
    el.store = new DeviceStore();
    el.onPlaceWidget = placed;
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;
    Object.defineProperty(el.shadowRoot?.querySelector('.grid') as Element, 'clientWidth', {
      value: 1200,
      configurable: true,
    });

    dragBy(grabIn(el, 't'), 250, 0);
    expect(placed).toHaveBeenCalledWith('t', { x: 3, y: 0, w: 6, h: 2 });
    expect(el.shadowRoot?.querySelector('.guide')).toBeNull();
  });
});
