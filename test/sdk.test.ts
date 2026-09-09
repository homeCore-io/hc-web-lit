/**
 * The SDK surface (§4.2, §4.5, §18.1).
 *
 * What these pin is that the context is *complete* — every host primitive
 * reachable through it — because §5.1's diagnosis of Home Assistant is a
 * platform where a capability was missing and an ecosystem grew around the
 * workaround. A missing method here is a card somebody writes to work around
 * it, and once written it cannot be un-written.
 */
import { describe, expect, it, vi } from 'vitest';
import { DeviceStore } from '../src/core/store.js';
import { Templates } from '../src/core/templates.js';
import type { MountEnv } from '../src/shell/mount.js';
import { contextFor } from '../src/sdk/host.js';
import { HcWidgetBase } from '../src/sdk/index.js';
import type { DeviceState } from '../src/core/device.js';

const lamp: DeviceState = {
  device_id: 'hue_1',
  name: 'Desk Lamp',
  plugin_id: 'hue',
  available: true,
  attributes: { on: true, brightness_pct: 40 },
  last_seen: '2026-09-08T00:00:00Z',
  device_type: 'light',
  schema: { attributes: { on: { kind: 'bool', writable: true } } },
};

const env = (over: Partial<MountEnv> = {}): MountEnv => {
  const store = new DeviceStore();
  store.reset([lamp]);
  return { store, context: {}, ...over };
};

describe('the context a widget is given', () => {
  it('reaches every primitive', () => {
    // The list §4.2 promises. A capability that is not here is one an
    // extension has to reach around the host to get, which is the failure the
    // whole boundary exists to prevent.
    const ctx = contextFor(env(), { type: 'text' });
    for (const name of [
      'subscribe',
      'device',
      'query',
      'expr',
      'call',
      'action',
      'history',
      'sheet',
      'details',
      'template',
    ] as const) {
      expect(typeof ctx[name], name).toBe('function');
    }
    expect(ctx.mode).toBe('view');
  });

  it('hands over functions, never the host', () => {
    // §3 Rule 3: narrow enough that every call could be a message. A context
    // carrying the store would make isolating a widget a rewrite.
    const ctx = contextFor(env(), { type: 'text' }) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(ctx)) {
      if (key === 'mode' || key === 'tokens') continue;
      expect(typeof value, key).toBe('function');
    }
  });

  it('resolves a query against the live store', () => {
    const ctx = contextFor(env(), { type: 'text' });
    expect(ctx.query({ deviceType: ['light'] }).devices).toHaveLength(1);
    expect(ctx.query({ on: false }).total).toBe(0);
  });

  it('puts the bound device in expression scope without being asked', () => {
    // A widget that assembled its own scope would assemble it wrongly.
    const ctx = contextFor(env(), { type: 'text', config: { device_id: 'hue_1' } });
    expect(ctx.expr('device.name')).toBe('Desk Lamp');
    expect(ctx.expr('isOn(device)')).toBe(true);
  });

  it('passes a command to the host rather than performing one', () => {
    const onCommand = vi.fn();
    const ctx = contextFor(env({ onCommand }), { type: 'text' });
    ctx.call({ deviceId: 'hue_1', patch: { on: false } });
    expect(onCommand).toHaveBeenCalledWith({ deviceId: 'hue_1', patch: { on: false } });
  });

  it('is quiet rather than broken when the host offers nothing', () => {
    // A widget in a test harness, or a sheet with no command sink: absent is
    // read-only, not an error.
    const ctx = contextFor({ store: undefined, context: {} }, { type: 'text' });
    expect(() => ctx.call({ deviceId: 'x', patch: {} })).not.toThrow();
    expect(ctx.device('x')).toBeUndefined();
    expect(ctx.query({}).devices).toEqual([]);
    expect(ctx.subscribe(['x'], () => undefined)).toBeTypeOf('function');
  });

  it('finds a template the host holds', () => {
    const templates = new Templates([
      { id: 't', widget: { type: 'device_grid', config: { facet: ['lights'] } } },
    ]);
    const ctx = contextFor(env({ templates }), { type: 'text' });
    expect(ctx.template('t')?.type).toBe('device_grid');
    expect(ctx.template('missing')).toBeUndefined();
  });
});

describe('the base class', () => {
  it('drops every subscription when the element goes', () => {
    // The part everyone forgets: a widget that never unsubscribes keeps a
    // listener alive for every device it watched, on a page that runs for
    // months.
    const off = vi.fn();
    class Probe extends HcWidgetBase {
      run(): void {
        this.watch(['hue_1'], () => undefined);
      }
    }
    customElements.define('hc-probe-widget', Probe);

    const el = new Probe();
    el.ctx = { ...contextFor(env(), { type: 'text' }), subscribe: () => off };
    el.run();
    el.run();
    el.disconnectedCallback();
    expect(off).toHaveBeenCalledTimes(2);
  });

  it('survives a host that gave it no context', () => {
    class Bare extends HcWidgetBase {
      run(): void {
        this.watch(['hue_1'], () => undefined);
      }
      override render() {
        return null;
      }
    }
    customElements.define('hc-bare-widget', Bare);
    const el = new Bare();
    expect(() => {
      el.run();
      el.disconnectedCallback();
    }).not.toThrow();
  });
});
