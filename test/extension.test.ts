/**
 * Phase 3's acceptance gate (§7.4, §18.3).
 *
 * §7.4 is explicit about what this proves: `hc-button` adds no host capability
 * of its own, so **if it needs something that is not already a primitive, that
 * is a finding against Phase 2 rather than a reason to special-case the
 * widget.** Loading it the way a third party's extension would load is the
 * only way to know whether the surface is real.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HC_API_VERSION, readManifest } from '../src/ext/manifest.js';
import { canDraw, loadExtension } from '../src/ext/host.js';
import { DeviceStore } from '../src/core/store.js';
import { contextFor } from '../src/sdk/host.js';
import type { DeviceState } from '../src/core/device.js';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, '..', 'extensions', 'hc-button', 'hc-extension.json'), 'utf8'),
) as unknown;

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

describe('reading a manifest', () => {
  it('accepts the one that ships', () => {
    const read = readManifest(manifest);
    expect(read.ok).toBe(true);
  });

  it('names the field that is wrong rather than saying "invalid"', () => {
    // Every failure here is a question an admin asks when a widget does not
    // appear, so each one answers it.
    expect(readManifest({}).ok).toBe(false);
    expect(readManifest({ ...(manifest as object), entry: undefined })).toMatchObject({
      reason: 'Missing "entry".',
    });
  });

  it('refuses an API version it does not implement, and says both', () => {
    expect(readManifest({ ...(manifest as object), hcApiVersion: '99' })).toMatchObject({
      reason: `Wants API version 99; this host implements ${HC_API_VERSION}.`,
    });
  });

  it('refuses an entry pointing at another origin', () => {
    // A different trust decision from the one an admin made when installing a
    // package, and not one to take on their behalf (§8.1).
    expect(
      readManifest({ ...(manifest as object), entry: 'https://cdn.example/x.js' }),
    ).toMatchObject({
      reason: 'Entry must be a path inside the extension, not a URL.',
    });
  });
});

describe('loading one', () => {
  it('registers what the module actually defined', async () => {
    const got = await loadExtension(
      manifest,
      '/ext/button',
      () => import('../extensions/hc-button/button.js'),
    );
    expect(got).toMatchObject({ widgets: [{ tag: 'hc-button' }] });
    expect(canDraw('button')).toBe(true);
  });

  it('cache-busts on the manifest version, so an update lands on reload', async () => {
    const load = vi.fn(() => import('../extensions/hc-button/button.js'));
    await loadExtension(manifest, '/ext/button/', load);
    expect(load).toHaveBeenCalledWith('/ext/button/button.js?v=1.0.0');
  });

  it('survives a module that throws, and names it', async () => {
    // A wall display that goes blank because an installed widget has a typo
    // is the failure that makes people stop installing things.
    const got = await loadExtension(manifest, '/x', () => Promise.reject(new Error('boom')));
    expect(got).toMatchObject({ error: expect.stringContaining('io.homecore.button') });
    expect(got).toMatchObject({ error: expect.stringContaining('boom') });
  });

  it('catches a tag declared and never defined', async () => {
    // The common typo. Without this the symptom is a widget rendering as
    // unknown with nothing anywhere saying why.
    const bad = {
      ...(manifest as object),
      provides: { widgets: [{ tag: 'hc-never-defined', name: 'x' }] },
    };
    const got = await loadExtension(bad, '/x', () => Promise.resolve({}));
    expect(got).toMatchObject({ error: expect.stringContaining('hc-never-defined') });
  });
});

describe('what the gate proved', () => {
  it('draws from the primitives alone', async () => {
    await import('../extensions/hc-button/button.js');
    const store = new DeviceStore();
    store.reset([lamp]);

    const el = document.createElement('hc-button') as HTMLElement & {
      config: Record<string, unknown>;
      ctx: ReturnType<typeof contextFor>;
      updateComplete: Promise<unknown>;
    };
    el.config = {
      device_id: 'hue_1',
      styles: [{ when: 'isOn(device)', ink: 'var(--hc-accent-active)' }],
    };
    el.ctx = contextFor({ store, context: {} }, { type: 'button', config: el.config });
    document.body.append(el);
    await el.updateComplete;

    // The name and the level come from the presentation primitive, not from
    // the extension reading attributes (§1.1).
    expect(el.shadowRoot?.textContent).toContain('Desk Lamp');
    expect(el.shadowRoot?.textContent).toContain('40%');
    // The state-matching style block, evaluated through P1 and expressed in
    // the shell's two custom properties. The widget says what state it is in;
    // the shell owns what a state looks like.
    expect(el.style.getPropertyValue('--hc-shell-colour')).toContain('accent-active');
    expect(el.style.getPropertyValue('--hc-shell-tint')).toBe('22%');

    // And it is not a <button>: pressing is the seam's job, which attaches
    // role, tabindex and the keyboard when a placement declares `on_tap`
    // (§5.10). A widget that built its own would be a second way to be
    // pressed, with its own idea of what a hold means.
    expect(el.shadowRoot?.querySelector('button')).toBeNull();
  });

  it('takes its label from an expression', async () => {
    await import('../extensions/hc-button/button.js');
    const store = new DeviceStore();
    store.reset([lamp]);

    const el = document.createElement('hc-button') as HTMLElement & {
      config: Record<string, unknown>;
      ctx: ReturnType<typeof contextFor>;
      updateComplete: Promise<unknown>;
    };
    el.config = { device_id: 'hue_1', label: { $expr: "isOn(device) ? 'Lit' : 'Dark'" } };
    el.ctx = contextFor({ store, context: {} }, { type: 'button', config: el.config });
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.textContent).toContain('Lit');
  });
});

describe('what §7.4 asks hc-button to do, and what that cost', () => {
  it('composes custom fields from child widgets, not from markup', async () => {
    // §7.4: "Custom fields composed from child widgets (P4), not raw HTML."
    // This is the capability the acceptance gate found missing — `ctx.child`
    // did not exist, so composition was first-party-only in practice while
    // §5.5 said an extension ships a container like anything else.
    const { contextFor } = await import('../src/sdk/host.js');
    const built: unknown[] = [];
    const ctx = contextFor(
      {
        store: new DeviceStore(),
        context: {},
        mountChild: (spec) => {
          built.push(spec);
          const el = document.createElement('div');
          el.dataset['type'] = spec.type;
          return el;
        },
      },
      { type: 'button', config: {} },
    );

    const child = ctx.child({ type: 'history_chart', config: { device_id: 'lamp' } });
    expect(child?.dataset['type']).toBe('history_chart');
    expect(built).toHaveLength(1);
  });

  it('has no child to give when the host offers none', async () => {
    // A sandboxed widget is exactly this case: §5.5 says a frame cannot mount
    // another frame's element, so slots and isolation are mutually exclusive.
    const { contextFor } = await import('../src/sdk/host.js');
    const ctx = contextFor(
      { store: new DeviceStore(), context: {} },
      { type: 'button', config: {} },
    );
    expect(ctx.child({ type: 'text', config: {} })).toBeUndefined();
  });
});
