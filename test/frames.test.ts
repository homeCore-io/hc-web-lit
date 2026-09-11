/**
 * The coordinate space a frame gives the things inside it (§14.1).
 *
 * The one operation that has to be exactly right, because it is what a
 * person's page is worth: a rectangle stated inside a frame and a rectangle
 * stated on the page are different numbers for the same place, and mixing them
 * up moves somebody's arrangement.
 */
import { describe, expect, it } from 'vitest';
import type { DashboardGroupBox } from '../src/core/dashboard.js';
import { gridItems } from '../src/core/dashboard.js';
import {
  PAGE_ORIGIN,
  framesByPath,
  isFrame,
  originOf,
  pageRectOf,
  spaceOfBox,
  toLocal,
  toPage,
} from '../src/core/frames.js';
import { placeWidget } from '../src/core/pages.js';
import { DeviceStore } from '../src/core/store.js';
import '../src/shell/hc-page.js';
import '../src/widgets/hc-text.js';
import type { HcPage } from '../src/shell/hc-page.js';

const box = (over: Partial<DashboardGroupBox> & { path: string }): DashboardGroupBox => ({
  rect: { x: 0, y: 0, w: 100, h: 100 },
  frame: true,
  ...over,
});

const wall = box({ path: 'Wall', rect: { x: 100, y: 50, w: 400, h: 300 } });
const lights = box({ path: 'Wall/Lights', rect: { x: 20, y: 10, w: 200, h: 100 } });

describe('what counts as a frame', () => {
  it('needs both halves of the claim', () => {
    // A coordinate space with no origin is not one, and treating it as the
    // page's would silently move everything inside it.
    expect(isFrame(wall)).toBe(true);
    expect(isFrame({ path: 'Wall', frame: true })).toBe(false);
    expect(isFrame({ path: 'Wall', rect: { x: 0, y: 0, w: 10, h: 10 } })).toBe(false);
  });

  it('collects only the frames, by path', () => {
    const frames = framesByPath([wall, { path: 'Tagged', rect: { x: 5, y: 5, w: 1, h: 1 } }]);
    expect([...frames.keys()]).toEqual(['Wall']);
  });
});

describe('where a space begins', () => {
  const frames = framesByPath([wall, lights]);

  it('is the page when nothing above is a frame', () => {
    expect(originOf(undefined, frames)).toEqual(PAGE_ORIGIN);
    expect(originOf('Elsewhere', frames)).toEqual(PAGE_ORIGIN);
    expect(originOf('Wall', new Map())).toEqual(PAGE_ORIGIN);
  });

  it('adds every framed ancestor, outermost first', () => {
    // A nested frame's rectangle is itself stated inside its parent.
    expect(originOf('Wall', frames)).toEqual({ x: 100, y: 50 });
    expect(originOf('Wall/Lights', frames)).toEqual({ x: 120, y: 60 });
  });

  it('ignores a group that is only a tag', () => {
    // A tag has no geometry to offer.
    const tagged = framesByPath([wall, { path: 'Wall/Tagged', rect: { x: 9, y: 9, w: 1, h: 1 } }]);
    expect(originOf('Wall/Tagged', tagged)).toEqual({ x: 100, y: 50 });
  });

  it('gives a frame’s own corner when asked for its own path', () => {
    // The one place two meanings coincide rather than merely agree: the origin
    // a frame's contents measure from *is* its corner.
    expect(pageRectOf(wall, frames)).toEqual({ x: 100, y: 50, w: 400, h: 300 });
    expect(pageRectOf(lights, frames)).toEqual({ x: 120, y: 60, w: 200, h: 100 });
  });

  it('has no page rect for a box that is not a frame', () => {
    expect(pageRectOf({ path: 'Tag', rect: { x: 1, y: 1, w: 2, h: 2 } }, frames)).toBeUndefined();
  });

  it('states a box’s own rect in its parent’s space, not its own', () => {
    // The one thing about this arithmetic that is easy to get backwards.
    expect(spaceOfBox('Wall/Lights')).toBe('Wall');
    expect(spaceOfBox('Wall')).toBeUndefined();
  });
});

describe('converting between the two', () => {
  const frames = framesByPath([wall, lights]);
  const rect = { x: 16, y: 48, w: 96, h: 64 };

  it('is the identity where nothing is framed', () => {
    // Which is why no saved page changes: nothing in them sets `frame`.
    expect(toPage(rect, undefined, frames)).toBe(rect);
    expect(toLocal(rect, undefined, frames)).toBe(rect);
  });

  it('shifts by the whole chain of origins', () => {
    expect(toPage(rect, 'Wall/Lights', frames)).toEqual({ x: 136, y: 108, w: 96, h: 64 });
  });

  it('round-trips, which is the whole claim', () => {
    for (const path of [undefined, 'Wall', 'Wall/Lights', 'Elsewhere']) {
      expect(toLocal(toPage(rect, path, frames), path, frames)).toEqual(rect);
    }
  });

  it('leaves the size alone — a frame moves things, it does not scale them', () => {
    const moved = toPage(rect, 'Wall', frames);
    expect(moved.w).toBe(rect.w);
    expect(moved.h).toBe(rect.h);
  });
});

describe('the seam, end to end', () => {
  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 800, fit: 'scroll' as const },
    groups: [wall],
    placements: [{ widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 16, y: 48, w: 96, h: 64 } }],
  };
  const widgets = [{ id: 'a', type: 'text', config: { group: 'Wall' } }];

  it('reads a framed rectangle as a page one', () => {
    // The document says 16,48 inside the frame; the surface draws it at 116,98.
    expect(gridItems(layout, widgets)[0]?.rect).toEqual({ x: 116, y: 98, w: 96, h: 64 });
  });

  it('writes a page rectangle back into the frame’s space', () => {
    // Every gesture works in page coordinates, so this is the inverse and the
    // round trip is what keeps a card in a frame from leaping to the page
    // origin the first time it is nudged.
    const doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets,
    };
    const next = placeWidget(doc, 'desktop', 'a', { x: 140, y: 110, w: 96, h: 64 });
    expect(next?.layouts?.[0]?.placements?.[0]?.rect).toEqual({ x: 40, y: 60, w: 96, h: 64 });
    // And reading it back gives the page position it was dropped at.
    expect(gridItems(next!.layouts![0]!, widgets)[0]?.rect).toEqual({
      x: 140,
      y: 110,
      w: 96,
      h: 64,
    });
  });

  it('leaves an unframed page exactly as it was', () => {
    const plain = { ...layout, groups: [] };
    expect(gridItems(plain, widgets)[0]?.rect).toEqual({ x: 16, y: 48, w: 96, h: 64 });
  });
});

describe('a frame that stacks its members (§14.1)', () => {
  const stacked: DashboardGroupBox = {
    path: 'Playing',
    rect: { x: 40, y: 60, w: 400, h: 200 },
    frame: true,
    stack: true,
    stack_gap: 8,
    padding: 12,
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 800, fit: 'scroll' as const },
    groups: [stacked],
    placements: [
      { widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 60 } },
      { widget_id: 'b', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 60 } },
      { widget_id: 'loose', x: 0, y: 0, w: 1, h: 1, rect: { x: 600, y: 60, w: 200, h: 40 } },
    ],
  };
  const widgets = [
    { id: 'a', type: 'text', config: { text: 'one', group: 'Playing' } },
    { id: 'b', type: 'text', config: { text: 'two', group: 'Playing' } },
    { id: 'loose', type: 'text', config: { text: 'elsewhere' } },
  ];

  const mount = async (): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets,
    };
    el.store = new DeviceStore();
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('draws one container at the frame’s own place', async () => {
    const el = await mount();
    const stack = el.shadowRoot?.querySelector('.stack') as HTMLElement;
    expect(stack, 'no stack container').not.toBeNull();
    expect(stack.dataset['frame']).toBe('Playing');
    expect(stack.style.left).toBe('40px');
    expect(stack.style.top).toBe('60px');
    expect(stack.style.gap).toBe('8px');
    expect(stack.style.padding).toBe('12px');
  });

  it('puts its members inside it, in flow', async () => {
    // Which is the whole point: a member that grows pushes the ones below it
    // down, and that only happens if they are really inside.
    const el = await mount();
    const stack = el.shadowRoot?.querySelector('.stack') as HTMLElement;
    const inside = [...stack.querySelectorAll('[data-widget]')].map((e) =>
      e.getAttribute('data-widget'),
    );
    expect(inside).toEqual(['a', 'b']);
  });

  it('draws each member once, not twice', async () => {
    // A stacked member positioned at its stored coordinates *as well* would be
    // the same card in two places.
    const el = await mount();
    const all = [...(el.shadowRoot?.querySelectorAll('[data-widget]') ?? [])].map((e) =>
      e.getAttribute('data-widget'),
    );
    expect(all.filter((id) => id === 'a')).toHaveLength(1);
  });

  it('leaves a card outside the frame where it was put', async () => {
    const el = await mount();
    const loose = [...(el.shadowRoot?.querySelectorAll('.placed') ?? [])].find(
      (e) => e.getAttribute('data-widget') === 'loose',
    ) as HTMLElement;
    expect(loose.style.left).toBe('600px');
    expect(loose.classList.contains('inflow')).toBe(false);
  });

  it('takes its members’ tops from the column, not from their rects', async () => {
    const el = await mount();
    const inflow = el.shadowRoot?.querySelector('.placed.inflow') as HTMLElement;
    expect(inflow.style.left).toBe('');
    expect(inflow.style.top).toBe('');
  });

  it('draws no separate backdrop for itself', async () => {
    // The stack is a real container and already has a body; a framebody behind
    // it would be a second box in the same place.
    const el = await mount();
    expect(el.shadowRoot?.querySelector('.framebody[data-frame="Playing"]')).toBeNull();
  });

  it('is an ordinary positioned frame when it does not stack', async () => {
    const el = await mount();
    el.doc = {
      ...el.doc!,
      layouts: [{ ...layout, groups: [{ ...stacked, stack: false }] }],
    };
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.stack')).toBeNull();
    expect(el.shadowRoot?.querySelector('.framebody')).not.toBeNull();
  });
});
