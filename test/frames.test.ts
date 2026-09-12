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
  containerOf,
  flowFrames,
  framesByPath,
  framesIn,
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

describe('a container inside a container', () => {
  // The household's Room page in miniature: a left column that is a heading, a
  // grid, and a *band* of controls that sit beside each other. A column of
  // widgets alone cannot express the band, which is what this is for.
  const column: DashboardGroupBox = {
    path: 'Left',
    rect: { x: 0, y: 100, w: 760, h: 400 },
    frame: true,
    stack: true,
    stack_gap: 10,
    padding: 20,
  };
  const band: DashboardGroupBox = {
    path: 'Left/Band',
    rect: { x: 0, y: 200, w: 720, h: 130 },
    frame: true,
  };
  const tag: DashboardGroupBox = {
    path: 'Left/Band/Knobs',
    rect: { x: 0, y: 0, w: 10, h: 10 },
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 900, fit: 'scroll' as const },
    groups: [column, band, tag],
    placements: [
      { widget_id: 'head', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
      { widget_id: 'tail', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 340, w: 300, h: 60 } },
      { widget_id: 'wheel', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 130, h: 130 } },
      { widget_id: 'slider', x: 0, y: 0, w: 1, h: 1, rect: { x: 150, y: 10, w: 480, h: 50 } },
    ],
  };
  const widgets = [
    { id: 'head', type: 'text', config: { text: 'LIGHTS', group: 'Left' } },
    { id: 'tail', type: 'text', config: { text: 'after', group: 'Left' } },
    { id: 'wheel', type: 'text', config: { text: 'wheel', group: 'Left/Band' } },
    { id: 'slider', type: 'text', config: { text: 'slider', group: 'Left/Band/Knobs' } },
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

  it('is a container because its parent is one', () => {
    // `stack` is not inherited; being a real element is. A frame nested in a
    // container holds its own members, or its position would come from the
    // flow while its contents stayed absolutely somewhere else on the page.
    const flow = flowFrames([column, band, tag]);
    expect([...flow.keys()].sort()).toEqual(['Left', 'Left/Band']);
    // A tag is not a frame and never becomes a container, however deep it is.
    expect(flow.has('Left/Band/Knobs')).toBe(false);
  });

  it('answers which container lays a path out', () => {
    const flow = flowFrames([column, band, tag]);
    expect(containerOf('Left', flow)).toBe('Left');
    expect(containerOf('Left/Band', flow)).toBe('Left/Band');
    // Through the tag to the frame above it.
    expect(containerOf('Left/Band/Knobs', flow)).toBe('Left/Band');
    expect(containerOf('Elsewhere', flow)).toBeUndefined();
    expect(containerOf(undefined, flow)).toBeUndefined();
  });

  it('holds a nested container in its parent, not on the page', () => {
    const flow = flowFrames([column, band, tag]);
    expect(framesIn(undefined, flow).map((b) => b.path)).toEqual(['Left']);
    expect(framesIn('Left', flow).map((b) => b.path)).toEqual(['Left/Band']);
    expect(framesIn('Left/Band', flow)).toEqual([]);
  });

  it('does not depend on the order the document lists boxes in', () => {
    // A document is free to list a child before its parent, and an editor that
    // appends will eventually do it.
    const flow = flowFrames([tag, band, column]);
    expect([...flow.keys()].sort()).toEqual(['Left', 'Left/Band']);
  });

  it('draws the band in flow, inside the column', async () => {
    const el = await mount();
    const outer = el.shadowRoot?.querySelector('.stack[data-frame="Left"]') as HTMLElement;
    const inner = el.shadowRoot?.querySelector('.stack[data-frame="Left/Band"]') as HTMLElement;
    expect(outer, 'no column').not.toBeNull();
    expect(inner, 'no band').not.toBeNull();
    expect(inner.parentElement).toBe(outer);
    // In flow: the column decides its top, so it states none of its own.
    expect(inner.classList.contains('inflow')).toBe(true);
    expect(inner.style.left).toBe('');
    expect(inner.style.height).toBe('130px');
  });

  it('orders a column by where its author drew each thing, frames included', async () => {
    // The band is drawn between the heading and what follows it, and the
    // column has to put it there — a widget's top and a frame's top are the
    // only thing the two kinds have in common.
    const el = await mount();
    const outer = el.shadowRoot?.querySelector('.stack[data-frame="Left"]') as HTMLElement;
    const order = [...outer.children].map(
      (c) => c.getAttribute('data-widget') ?? c.getAttribute('data-frame'),
    );
    expect(order).toEqual(['head', 'Left/Band', 'tail']);
  });

  it('places a band’s members at their own rectangles, not the page’s', async () => {
    // Their rects are stated in the band's space, which is what the band's
    // element *is* — so they go in at exactly the numbers the document holds.
    const el = await mount();
    const wheel = el.shadowRoot?.querySelector('[data-widget="wheel"]') as HTMLElement;
    const slider = el.shadowRoot?.querySelector('[data-widget="slider"]') as HTMLElement;
    expect(wheel.classList.contains('inflow')).toBe(false);
    expect(wheel.style.left).toBe('0px');
    expect(wheel.style.top).toBe('0px');
    expect(slider.style.left).toBe('150px');
    expect(slider.style.top).toBe('10px');
    expect(slider.style.width).toBe('480px');
  });

  it('lays a band out by coordinate rather than as a column', async () => {
    const el = await mount();
    const inner = el.shadowRoot?.querySelector('.stack[data-frame="Left/Band"]') as HTMLElement;
    const outer = el.shadowRoot?.querySelector('.stack[data-frame="Left"]') as HTMLElement;
    expect(inner.hasAttribute('data-column')).toBe(false);
    expect(outer.hasAttribute('data-column')).toBe(true);
  });

  it('draws no backdrop behind any container', async () => {
    // Two boxes in the same place, and the nested one's would be at page
    // coordinates its contents left the moment the column started deciding.
    const el = await mount();
    expect(el.shadowRoot?.querySelector('.framebody[data-frame="Left"]')).toBeNull();
    expect(el.shadowRoot?.querySelector('.framebody[data-frame="Left/Band"]')).toBeNull();
  });
});

describe('what a container does with nothing in it', () => {
  // Every member bound to a token that has not resolved — the room page's SETS
  // band before a lamp is picked.
  const band: DashboardGroupBox = {
    path: 'Col/Band',
    rect: { x: 0, y: 40, w: 700, h: 132 },
    frame: true,
  };
  const col: DashboardGroupBox = {
    path: 'Col',
    rect: { x: 0, y: 100, w: 760, h: 400 },
    frame: true,
    stack: true,
    padding: 0,
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 900, fit: 'scroll' as const },
    groups: [col, band],
    placements: [
      { widget_id: 'head', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
      { widget_id: 'knob', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 130, h: 130 } },
    ],
  };

  const mount = async (hidden: boolean): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets: [
        { id: 'head', type: 'text', config: { text: 'LIGHTS', group: 'Col' } },
        {
          id: 'knob',
          type: 'text',
          config: { text: 'knob', group: 'Col/Band', ...(hidden ? { hide_with: '@picked' } : {}) },
        },
      ],
    };
    el.store = new DeviceStore();
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('takes no room when everything in it is hidden', async () => {
    // A container that kept its size for contents that are not there is a
    // hole in the page, which is what the room page had under its lights.
    const el = await mount(true);
    expect(el.shadowRoot?.querySelector('.stack[data-frame="Col/Band"]')).toBeNull();
    expect(el.shadowRoot?.querySelector('.stack[data-frame="Col"]')).not.toBeNull();
  });

  it('is there the moment anything in it is', async () => {
    const el = await mount(false);
    expect(el.shadowRoot?.querySelector('.stack[data-frame="Col/Band"]')).not.toBeNull();
  });
});

describe('a placement drawn to the page', () => {
  // The ground a composed page is painted over: sized to the page, not to
  // anything in itself.
  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 800, fit: 'scroll' as const },
    groups: [],
    placements: [
      { widget_id: 'ground', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 1240, h: 700 } },
      { widget_id: 'rule', x: 0, y: 0, w: 1, h: 1, rect: { x: 600, y: 100, w: 1, h: 400 } },
      { widget_id: 'plain', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 100, h: 50 } },
    ],
  };

  const mount = async (): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets: [
        { id: 'ground', type: 'shape', config: { fit: 'page' } },
        { id: 'rule', type: 'shape', config: { fit: 'page' } },
        { id: 'plain', type: 'shape', config: {} },
      ],
    };
    el.store = new DeviceStore();
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('reaches the foot of the page rather than the number it was drawn at', async () => {
    // 700 was a number typed once; the page is 800, and a ground that stops at
    // 700 leaves an unpainted strip under the last card.
    const el = await mount();
    const ground = el.shadowRoot?.querySelector('[data-widget="ground"]') as HTMLElement;
    expect(ground.style.height).toBe('800px');
  });

  it('measures from where it starts, not from the top', async () => {
    // A hairline between two columns begins under the rule above them.
    const el = await mount();
    const rule = el.shadowRoot?.querySelector('[data-widget="rule"]') as HTMLElement;
    expect(rule.style.height).toBe('700px');
  });

  it('leaves every other placement exactly as it was drawn', async () => {
    const el = await mount();
    const plain = el.shadowRoot?.querySelector('[data-widget="plain"]') as HTMLElement;
    expect(plain.style.height).toBe('50px');
  });

  it('is left out of the measurement that decides where the foot is', async () => {
    // A ground drawn to the foot of the page would set the height it reads,
    // and the two would chase each other up the screen a margin at a time. The
    // attribute is how the measurement knows to skip it.
    const el = await mount();
    expect(
      (el.shadowRoot?.querySelector('[data-widget="ground"]') as HTMLElement).hasAttribute(
        'data-page',
      ),
    ).toBe(true);
    expect(
      (el.shadowRoot?.querySelector('[data-widget="plain"]') as HTMLElement).hasAttribute(
        'data-page',
      ),
    ).toBe(false);
  });
});

describe('a section, which is a heading and a set', () => {
  // A room with no leak sensor wants no LEAKS heading either, and the list
  // hiding itself is only half of that.
  const section: DashboardGroupBox = {
    path: 'Left/leaks',
    rect: { x: 0, y: 0, w: 700, h: 60 },
    frame: true,
    stack: true,
  };
  const band: DashboardGroupBox = {
    path: 'Left/head',
    rect: { x: 0, y: 100, w: 700, h: 22 },
    frame: true,
    stack: true,
  };
  const column: DashboardGroupBox = {
    path: 'Left',
    rect: { x: 0, y: 100, w: 760, h: 400 },
    frame: true,
    stack: true,
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 900, fit: 'scroll' as const },
    groups: [column, section, band],
    placements: [
      { widget_id: 'label', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
      { widget_id: 'list', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 30, w: 700, h: 40 } },
      { widget_id: 'plain', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
    ],
  };

  const mount = async (): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets: [
        { id: 'label', type: 'text', config: { text: 'LEAKS', group: 'Left/leaks' } },
        {
          id: 'list',
          type: 'device_list',
          config: {
            group: 'Left/leaks',
            selection_mode: 'facet',
            facet: ['leaks'],
            area_name: '@room',
            hide_when_empty: true,
          },
        },
        { id: 'plain', type: 'text', config: { text: 'SETS', group: 'Left/head' } },
      ],
    };
    el.store = new DeviceStore();
    el.context = { room: 'garage' };
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('goes when its set does, heading and all', async () => {
    // The store is empty, so the list has nothing and the section is a label
    // over a gap.
    const el = await mount();
    expect(el.shadowRoot?.querySelector('.stack[data-frame="Left/leaks"]')).toBeNull();
  });

  it('keeps a container that holds no set at all', async () => {
    // The room page's SETS band is three labels and no list, and it stays
    // exactly as long as the labels do — which is what makes this a rule about
    // sections rather than about headings.
    const el = await mount();
    expect(el.shadowRoot?.querySelector('.stack[data-frame="Left/head"]')).not.toBeNull();
  });
});

describe('a container as tall as what is in it', () => {
  // The house's footer: a modes block beside a scenes block, side by side and
  // so not a column — and absolutely positioned children give their parent no
  // height at all, so it held a number somebody typed once.
  const foot: DashboardGroupBox = {
    path: 'Foot',
    rect: { x: 0, y: 600, w: 1240, h: 176 },
    frame: true,
    padding: 18,
    fit: 'content',
  };

  it('is a container, because a height is a measurement of its members', () => {
    // A box whose members are drawn somewhere else on the page has none to
    // measure — which is why this and not only `stack` makes one.
    const flow = flowFrames([foot]);
    expect(flow.has('Foot')).toBe(true);
  });

  it('lays them out by coordinate all the same', () => {
    // `stack` is not implied by it: a footer is a row, not a column.
    expect(foot.stack).toBeUndefined();
  });

  it('leaves an ordinary positioned frame a backdrop', () => {
    // Nothing else changes: a frame that states a height and does not ask to
    // be measured keeps drawing behind its members, where they are.
    const plain: DashboardGroupBox = {
      path: 'Panel',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      frame: true,
    };
    expect(flowFrames([plain]).has('Panel')).toBe(false);
  });
});

describe('what one press holds, now that a section is a group', () => {
  // §14.1's cluster gesture was written for groups somebody assembled by
  // selecting cards and pressing Group. A section and a column are groups too
  // now, and the same rule applied to them held thirty-five widgets.
  const column: DashboardGroupBox = {
    path: 'Left',
    rect: { x: 0, y: 0, w: 700, h: 600 },
    frame: true,
    stack: true,
  };
  const section: DashboardGroupBox = {
    path: 'Left/doors',
    rect: { x: 0, y: 0, w: 700, h: 60 },
    frame: true,
    stack: true,
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 900, fit: 'scroll' as const },
    groups: [column, section],
    placements: [
      { widget_id: 'label', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
      { widget_id: 'list', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 30, w: 700, h: 40 } },
      { widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 800, y: 0, w: 100, h: 40 } },
      { widget_id: 'b', x: 0, y: 0, w: 1, h: 1, rect: { x: 800, y: 60, w: 100, h: 40 } },
    ],
  };

  const mount = async (): Promise<HcPage> => {
    const el = document.createElement('hc-page');
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets: [
        { id: 'label', type: 'text', config: { text: 'DOORS', group: 'Left/doors' } },
        { id: 'list', type: 'text', config: { text: 'rows', group: 'Left/doors' } },
        // An ordinary cluster: two cards somebody grouped, nothing above them.
        { id: 'a', type: 'text', config: { text: 'one', group: 'Wall/Lights' } },
        { id: 'b', type: 'text', config: { text: 'two', group: 'Wall/Lights' } },
      ],
    };
    el.store = new DeviceStore();
    el.mode = 'edit';
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const held = (el: HcPage, id: string): string[] => {
    const cluster = (el as unknown as { clusterOf: (x: string) => Set<string> }).clusterOf(id);
    return [...cluster].sort();
  };

  it('holds the card, not the column it is a section of', async () => {
    // A page you cannot edit a card on without pressing three times to get
    // down to it is not a page you can arrange.
    const el = await mount();
    expect(held(el, 'label')).toEqual(['label']);
    expect(held(el, 'list')).toEqual(['list']);
  });

  it('still holds the whole cluster where somebody made one', async () => {
    // The case §14.1 describes, and the one this must not change: a group with
    // no container anywhere above it behaves exactly as it always did.
    const el = await mount();
    expect(held(el, 'a')).toEqual(['a', 'b']);
  });

  it('lets stepping out take hold of the whole section again', async () => {
    // Out of a container is a real place to stand, and Escape is how you get
    // there: the automatic position is where a press starts, not a floor
    // under it. Standing in the column, a press holds the section in it.
    const el = await mount();
    (el as unknown as { inside: string }).inside = 'Left';
    expect(held(el, 'label')).toEqual(['label', 'list']);
  });
});

describe('what a drag on a whole container writes', () => {
  const section: DashboardGroupBox = {
    path: 'Left/doors',
    rect: { x: 0, y: 520, w: 700, h: 60 },
    frame: true,
    stack: true,
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 900, fit: 'scroll' as const },
    groups: [section],
    placements: [
      { widget_id: 'head', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
      { widget_id: 'list', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 30, w: 700, h: 30 } },
      { widget_id: 'loose', x: 0, y: 0, w: 1, h: 1, rect: { x: 900, y: 0, w: 100, h: 40 } },
    ],
  };

  const mount = async () => {
    const el = document.createElement('hc-page');
    const groups: { path: string; by: { x: number; y: number } }[] = [];
    const widgets: unknown[] = [];
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets: [
        { id: 'head', type: 'text', config: { text: 'DOORS', group: 'Left/doors' } },
        { id: 'list', type: 'text', config: { text: 'rows', group: 'Left/doors' } },
        { id: 'loose', type: 'text', config: { text: 'elsewhere' } },
      ],
    };
    el.store = new DeviceStore();
    el.mode = 'edit';
    el.onPlaceGroup = (path, by) => {
      groups.push({ path, by });
    };
    // Both doors, because `commit` uses the batch one only for more than one
    // move — a single widget still goes through the single-widget door.
    el.onPlaceWidgets = async (moves) => {
      widgets.push(moves);
    };
    el.onPlaceWidget = async (id, box) => {
      widgets.push([{ id, box }]);
    };
    document.body.append(el);
    await el.updateComplete;
    return { el, groups, widgets };
  };

  /**
   * A drag, in the page coordinates every gesture on this surface works in.
   *
   * `by` is how far the pointer travelled; where each member starts is its own
   * rectangle plus the origin of the container it is stated in, which is the
   * conversion `gridItems` does on the way in and the one the delta has to be
   * measured against.
   */
  const drag = async (el: HcPage, ids: string[], by: { x: number; y: number }) => {
    const origin = (id: string) =>
      el.doc?.widgets?.find((w) => w.id === id)?.config?.['group'] === undefined
        ? { x: 0, y: 0 }
        : { x: section.rect!.x, y: section.rect!.y };
    const boxes = new Map(
      ids.map((id) => {
        const p = layout.placements.find((q) => q.widget_id === id)!;
        const from = origin(id);
        return [
          id,
          { x: p.rect.x + from.x + by.x, y: p.rect.y + from.y + by.y, w: p.rect.w, h: p.rect.h },
        ];
      }),
    );
    await (el as unknown as { commit: (m: Map<string, unknown>) => Promise<void> }).commit(boxes);
  };

  it('moves the box, and writes nothing inside it', async () => {
    // The members do not move at all. Writing them is how a drag on a section
    // ends up shuffling its contents while the section stays where it was.
    const { el, groups, widgets } = await mount();
    await drag(el, ['head', 'list'], { x: 0, y: 150 });
    expect(groups).toEqual([{ path: 'Left/doors', by: { x: 0, y: 150 } }]);
    expect(widgets).toEqual([]);
  });

  it('moves the members when only some of them are in hand', async () => {
    // Half a section being dragged out of one is a different edit and a real
    // one: those members are leaving, and moving the box would take the rest
    // with them.
    const { el, groups, widgets } = await mount();
    await drag(el, ['head'], { x: 0, y: 150 });
    expect(groups).toEqual([]);
    expect(widgets).toHaveLength(1);
  });

  it('leaves a selection that is not a container alone', async () => {
    const { el, groups } = await mount();
    await drag(el, ['loose'], { x: 50, y: 0 });
    expect(groups).toEqual([]);
  });
});

describe('the grips a container gets', () => {
  const column: DashboardGroupBox = {
    path: 'Left',
    rect: { x: 0, y: 180, w: 767, h: 600 },
    frame: true,
    stack: true,
  };
  const section: DashboardGroupBox = {
    path: 'Left/doors',
    rect: { x: 0, y: 0, w: 700, h: 60 },
    frame: true,
    stack: true,
  };

  const layout = {
    breakpoint: 'desktop' as const,
    columns: 12,
    row_height: 120,
    gap: 12,
    flow: 'free' as const,
    frame: { width: 1240, height: 900, fit: 'scroll' as const },
    groups: [column, section],
    placements: [
      { widget_id: 'head', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 0, w: 300, h: 18 } },
      { widget_id: 'list', x: 0, y: 0, w: 1, h: 1, rect: { x: 0, y: 30, w: 700, h: 30 } },
    ],
  };

  const mount = async () => {
    const el = document.createElement('hc-page');
    const sized: { path: string; rect: unknown }[] = [];
    el.doc = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      layouts: [layout],
      widgets: [
        { id: 'head', type: 'text', config: { text: 'DOORS', group: 'Left/doors' } },
        { id: 'list', type: 'text', config: { text: 'rows', group: 'Left/doors' } },
      ],
    };
    el.store = new DeviceStore();
    el.mode = 'edit';
    el.onSizeGroup = (path, rect) => {
      sized.push({ path, rect });
    };
    document.body.append(el);
    await el.updateComplete;
    return { el, sized };
  };

  it('draws eight of them round the container the page positions', async () => {
    const { el } = await mount();
    (el as unknown as { picked: Set<string> }).picked = new Set(['head', 'list']);
    await el.updateComplete;
    // Both the column and the section hold exactly these two, and the
    // outermost is what somebody grabbed.
    const frame = el.shadowRoot?.querySelector('.cluster') as HTMLElement;
    expect(frame, 'no frame').not.toBeNull();
    expect(frame.dataset['frame']).toBe('Left');
    expect(frame.querySelectorAll('.grip')).toHaveLength(8);
  });

  it('draws it round the container’s own box, not round its contents', async () => {
    // A column drawn 600 tall holding 60 of content is 600, and the members
    // only cover the 60.
    const { el } = await mount();
    (el as unknown as { picked: Set<string> }).picked = new Set(['head', 'list']);
    await el.updateComplete;
    const frame = el.shadowRoot?.querySelector('.cluster') as HTMLElement;
    expect(frame.style.height).toBe('600px');
    expect(frame.style.width).toBe('767px');
  });

  it('offers none for a container a column positions', async () => {
    // It takes its width from the column and its height from its contents, so
    // there is nothing there to resize — not offered rather than offered and
    // refused (§5.11).
    const { el } = await mount();
    el.doc = { ...el.doc!, layouts: [{ ...layout, groups: [column, section] }] };
    (el as unknown as { inside: string }).inside = 'Left';
    (el as unknown as { picked: Set<string> }).picked = new Set(['head', 'list']);
    await el.updateComplete;
    const frame = el.shadowRoot?.querySelector('.cluster') as HTMLElement | null;
    // The section is the only container holding exactly these, once standing
    // inside the column — and it is laid out by the column.
    expect(frame?.dataset['frame']).not.toBe('Left/doors');
  });
});
