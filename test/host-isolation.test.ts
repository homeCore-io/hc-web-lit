/**
 * The host surviving somebody else's widget (§8.1).
 *
 * Both of these are real failures, found by loading the acceptance-gate
 * extension for real rather than through a test double — which is what §7.4
 * says that gate is for. They have the same shape: the host assumed something
 * about a widget that is true of every first-party one and is not part of the
 * ABI, and the cost was not the widget but **the whole page**.
 */
import { describe, expect, it } from 'vitest';
import { LitElement, html } from 'lit';
import { mountWidget } from '../src/shell/mount.js';
import type { MountEnv } from '../src/sdk/host.js';
import { DeviceStore } from '../src/core/store.js';
import { registerWidget } from '../src/core/registry.js';
import '../src/shell/hc-page.js';
import type { HcPage } from '../src/shell/hc-page.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';

const env = (): MountEnv => ({ store: new DeviceStore(), context: {} });

describe('a widget that computes what the host would set', () => {
  it('keeps its own value rather than being assigned over', () => {
    // `hc-button` does exactly this: `get device()` reads `config.device_id`,
    // which is what §4.2 intends an SDK widget to do. Assigning over a getter
    // throws `TypeError` in a module, and that throw happened inside the
    // page's render.
    class Computed extends HTMLElement {
      config: Record<string, unknown> = {};
      get device(): unknown {
        return { device_id: 'derived', attributes: {} };
      }
    }
    customElements.define('test-computed', Computed);

    const el = new Computed();
    expect(() =>
      mountWidget(el as never, { type: 'x', config: { device_id: 'lamp' } }, env()),
    ).not.toThrow();
    expect((el.device as { device_id: string }).device_id).toBe('derived');
    // The properties it *does* accept still arrive.
    expect(el.config['device_id']).toBe('lamp');
  });

  it('still assigns where the widget declares a settable property', () => {
    class Plain extends HTMLElement {
      config: Record<string, unknown> = {};
      device: unknown;
    }
    customElements.define('test-plain', Plain);

    const store = new DeviceStore();
    store.reset([{ device_id: 'lamp', available: true, attributes: { on: true } } as never]);
    const el = new Plain();
    mountWidget(el as never, { type: 'x', config: { device_id: 'lamp' } }, {
      ...env(),
      store,
    } as MountEnv);

    expect((el.device as { device_id: string } | undefined)?.device_id).toBe('lamp');
  });
});

describe('a widget that throws while being mounted', () => {
  it('is the only thing that fails, and says so where it sits', async () => {
    // Before this, the throw propagated out of `render`: Lit abandons the
    // update and leaves the *previous* frame's DOM on screen, so the symptom
    // was a dashboard that had silently stopped updating while the new
    // document was already installed.
    class Exploding extends LitElement {
      set config(_v: Record<string, unknown>) {
        throw new Error('bad config');
      }
      override render() {
        return html`never reached`;
      }
    }
    customElements.define('test-exploding', Exploding);
    registerWidget('exploding', 'test-exploding');

    const doc: DashboardDefinition = {
      id: 'd',
      name: 'D',
      icon: 'home',
      owner_user_id: 'u',
      widgets: [
        { id: 'boom', type: 'exploding' },
        { id: 'fine', type: 'text', config: { text: 'still here' } },
      ],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 100,
          gap: 8,
          placements: [
            { widget_id: 'boom', x: 0, y: 0, w: 6, h: 1 },
            { widget_id: 'fine', x: 6, y: 0, w: 6, h: 1 },
          ],
        },
      ],
    };

    const page = document.createElement('hc-page') as HcPage;
    page.doc = doc;
    page.store = new DeviceStore();
    page.breakpoint = 'desktop';
    document.body.append(page);
    await page.updateComplete;

    const root = page.shadowRoot;
    // The neighbour drew.
    expect(root?.textContent).toContain('still here');
    // And the failure is legible rather than silent — the type, and why.
    expect(root?.querySelector('.unknown')?.textContent).toContain('exploding');
    expect(root?.querySelector('.unknown')?.textContent).toContain('bad config');
  });
});
