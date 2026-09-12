/**
 * Looking closer at a page while arranging it — the `{tx, ty, k}` of §14.2.
 *
 * **One transform, and the two halves kept where each is already right.** The
 * scale is the scene's own, and the translate is the ordinary scroll position
 * of a page whose stage states the scaled size as a real box — so panning is
 * what every device already does, and nothing had to be reimplemented to get
 * it. What these check is that the number reaches the scene, that the scroll
 * has somewhere to go, that the chrome does not shrink with the page, and that
 * the measurements every gesture is built on still answer in page units.
 */
import { describe, expect, it } from 'vitest';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import { DeviceStore } from '../src/core/store.js';
import '../src/shell/hc-page.js';
import '../src/widgets/hc-text.js';
import type { HcPage } from '../src/shell/hc-page.js';

const doc = (fit: 'scroll' | 'contain' = 'scroll'): DashboardDefinition => ({
  id: 'd',
  name: 'D',
  icon: 'home',
  owner_user_id: 'u',
  widgets: [{ id: 'a', type: 'text', config: { text: 'one' } }],
  layouts: [
    {
      breakpoint: 'desktop',
      columns: 12,
      row_height: 120,
      gap: 12,
      flow: 'free',
      frame: { width: 1240, height: 800, fit },
      placements: [
        { widget_id: 'a', x: 0, y: 0, w: 1, h: 1, rect: { x: 40, y: 60, w: 300, h: 80 } },
      ],
    },
  ],
});

const mount = async (page = doc()): Promise<HcPage> => {
  const el = document.createElement('hc-page');
  el.doc = page;
  el.store = new DeviceStore();
  el.mode = 'edit';
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const frame = (el: HcPage) => el.shadowRoot?.querySelector('.frame') as HTMLElement;
const stage = (el: HcPage) => el.shadowRoot?.querySelector('.stage') as HTMLElement;

describe('the zoom, as the scene is drawn', () => {
  it('starts at the size the page states', async () => {
    const el = await mount();
    expect(frame(el).style.transform).toBe('scale(1)');
    expect(stage(el).style.width).toBe('1240px');
  });

  it('scales the scene and states the scaled size as a box', async () => {
    // **A transform changes what is drawn and nothing about layout.** Without
    // the stage a page zoomed past the viewport has no scroll extent to reach
    // it with — the part of it past the edge is simply unreachable.
    const el = await mount();
    await el.zoomTo(2);
    expect(frame(el).style.transform).toBe('scale(2)');
    expect(stage(el).style.width).toBe('2480px');
    expect(stage(el).style.height).toBe('1600px');
  });

  it('multiplies the document’s own fit rather than overruling it', async () => {
    // `fit` is the author's answer to a narrow screen (§5.7) and the zoom is
    // this session's. A zoom that replaced it would silently overrule a page
    // that asked to be contained.
    const el = await mount(doc('contain'));
    el.fitWidth = 620;
    await el.updateComplete;
    expect(frame(el).style.transform).toBe('scale(0.5)');
    await el.zoomTo(2);
    expect(frame(el).style.transform).toBe('scale(1)');
  });

  it('holds the chrome to its own size while the page changes size', async () => {
    // A grip that halves with the page is a grip nobody can hit at the zoom
    // where they most need to see the whole thing.
    const el = await mount();
    await el.zoomTo(0.5);
    expect(frame(el).style.getPropertyValue('--hc-zoom')).toBe('0.5');
  });

  it('goes no further out than a page can be read, or in than a screen', async () => {
    const el = await mount();
    await el.zoomTo(12);
    expect(el.zoom).toBe(3);
    await el.zoomTo(0.01);
    expect(el.zoom).toBe(0.25);
  });

  it('says what it is now, for the readout that has to agree with it', async () => {
    const el = await mount();
    const said: number[] = [];
    el.addEventListener('hc-zoom', (e) =>
      said.push((e as CustomEvent<{ zoom: number }>).detail.zoom),
    );
    await el.zoomTo(1.5);
    expect(said).toEqual([1.5]);
  });

  it('fits the width of the page on screen when asked', async () => {
    const el = await mount();
    Object.defineProperty(el, 'clientWidth', { value: 628, configurable: true });
    expect(el.fitZoom()).toBe(0.5);
  });
});

describe('whose gesture the wheel is', () => {
  const wheel = (el: HcPage, init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it('zooms when the gesture says zoom, which is what a pinch sends', async () => {
    const el = await mount();
    const e = wheel(el, { deltaY: -400, ctrlKey: true });
    await el.updateComplete;
    expect(e.defaultPrevented, 'the browser would zoom the whole window').toBe(true);
    expect(el.zoom).toBeGreaterThan(1);
  });

  it('leaves a plain wheel alone, because that is the pan', async () => {
    const el = await mount();
    const e = wheel(el, { deltaY: -400 });
    await el.updateComplete;
    expect(e.defaultPrevented).toBe(false);
    expect(el.zoom).toBe(1);
  });

  it('is not a gesture on a page somebody is only using', async () => {
    // A viewer holding Ctrl means the browser's own zoom, which is not ours to
    // take — and what a viewer sees at a narrow width is the document's `fit`.
    const el = await mount();
    el.mode = 'view';
    await el.updateComplete;
    const e = wheel(el, { deltaY: -400, ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(el.zoom).toBe(1);
  });

  it('puts the page back to full size on the way out of arranging', async () => {
    // Otherwise a page is left drawn small with nothing on screen able to put
    // it back: the controls are part of arranging.
    const el = await mount();
    await el.zoomTo(0.5);
    el.mode = 'view';
    await el.updateComplete;
    expect(el.zoom).toBe(1);
    expect(frame(el).style.transform).toBe('scale(1)');
  });
});

describe('what a gesture measures while the page is zoomed', () => {
  /**
   * jsdom lays nothing out, so the scale has to be stated: a frame drawn at
   * half its natural width *is* a page at 0.5, which is what `frameScale`
   * reads and what every measurement on this surface divides by.
   */
  const halved = async (): Promise<HcPage> => {
    const el = await mount();
    const at = frame(el);
    Object.defineProperty(at, 'offsetWidth', { value: 1240, configurable: true });
    at.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 50,
        left: 100,
        top: 50,
        width: 620,
        height: 400,
        right: 720,
        bottom: 450,
        toJSON: () => ({}),
      }) as DOMRect;
    return el;
  };

  it('reads a pointer as the page point under it, not as a screen point', async () => {
    const el = await halved();
    const inner = el as unknown as {
      pointIn: (x: number, y: number) => { x: number; y: number } | undefined;
    };
    // 200px right of the frame's corner on screen is 400 page units in.
    expect(inner.pointIn(300, 150)).toEqual({ x: 400, y: 200 });
  });

  it('turns a pointer’s travel into the distance the page moved', async () => {
    const el = await halved();
    const inner = el as unknown as {
      stepOf: (dx: number, dy: number) => { dx: number; dy: number } | undefined;
    };
    expect(inner.stepOf(100, 40)).toEqual({ dx: 200, dy: 80 });
  });
});
