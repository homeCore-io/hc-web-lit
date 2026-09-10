/**
 * Correcting what a plugin could not know (§1.1, §19.9).
 *
 * An outlet cannot know what is plugged into it — a lamp, a fan, a radio — so
 * a plugin safely reports `switch` and a person says what it really is.
 * `ui_hint` is that correction, every facet and icon and type-specific widget
 * in this client reads it first, and until now nothing here could set it.
 */
import { describe, expect, it, vi } from 'vitest';
import '../src/widgets/hc-device-details.js';
import { drawableHints } from '../src/core/registry.js';
import { facetHints } from '../src/core/selection.js';
import type { DeviceState } from '../src/core/device.js';

const outlet: DeviceState = {
  device_id: 'lutron_60',
  name: 'Outlet - Office AC',
  plugin_id: 'plugin.lutron',
  available: true,
  attributes: { on: true },
  last_seen: '2026-09-10T00:00:00Z',
  device_type: 'switch',
  schema: { attributes: { on: { kind: 'bool', writable: true } }, actions: [] },
};

async function sheet(over: Record<string, unknown> = {}) {
  const el = document.createElement('hc-device-details') as HTMLElement & {
    device: DeviceState;
    updateComplete: Promise<unknown>;
  };
  Object.assign(el, { device: outlet, onUpdateDevice: async () => undefined }, over);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('the hints on offer', () => {
  it('includes the ones that change an icon or a facet, not only a widget', async () => {
    // The first attempt read only the widget registry, so `light`, `switch`
    // and `outlet` were missing — the three a person reaches for most, and the
    // three that draw as the generic card while changing plenty else.
    const el = await sheet();
    const options = [...(el.shadowRoot?.querySelectorAll('.hint option') ?? [])].map((o) =>
      o.getAttribute('value'),
    );
    for (const wanted of ['light', 'switch', 'outlet', 'fan', 'lock']) {
      expect(options).toContain(wanted);
    }
  });

  it('offers nothing this client would ignore', async () => {
    // The legal set is defined nowhere (homeCore#30), so offering a value that
    // changes nothing would be inventing a vocabulary and disappointing
    // whoever picked from it.
    const known = new Set([...drawableHints(), ...facetHints()]);
    const el = await sheet();
    const options = [...(el.shadowRoot?.querySelectorAll('.hint option') ?? [])]
      .map((o) => o.getAttribute('value'))
      .filter((v) => v !== '');
    for (const o of options) expect(known.has(o!)).toBe(true);
  });

  it('names the default after what the plugin actually said', async () => {
    const el = await sheet();
    const first = el.shadowRoot?.querySelector('.hint option');
    expect(first?.textContent?.trim()).toBe('Default (Switch)');
  });
});

describe('setting one', () => {
  it('sends the hint the person chose', async () => {
    const sent = vi.fn(async () => undefined);
    const el = await sheet({ onUpdateDevice: sent });
    const select = el.shadowRoot?.querySelector('.hint select') as HTMLSelectElement;
    select.value = 'fan';
    select.dispatchEvent(new Event('change'));

    expect(sent).toHaveBeenCalledWith('lutron_60', { ui_hint: 'fan' });
  });

  it('clears it with null, so Default means going back', async () => {
    // Core reads `null` and an empty string alike as "no hint"; sending the
    // empty string would leave somebody unable to undo their own choice.
    const sent = vi.fn(async () => undefined);
    const el = await sheet({ device: { ...outlet, ui_hint: 'fan' }, onUpdateDevice: sent });
    const select = el.shadowRoot?.querySelector('.hint select') as HTMLSelectElement;
    select.value = '';
    select.dispatchEvent(new Event('change'));

    expect(sent).toHaveBeenCalledWith('lutron_60', { ui_hint: null });
  });

  it('says so when the house refuses', async () => {
    const el = await sheet({
      onUpdateDevice: async () => {
        throw new Error('read only');
      },
    });
    const select = el.shadowRoot?.querySelector('.hint select') as HTMLSelectElement;
    select.value = 'fan';
    select.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;

    expect(el.shadowRoot?.querySelector('.trouble')?.textContent).toContain('read only');
  });
});

describe('who is offered it', () => {
  it('is not shown to a session that may not write devices', async () => {
    // A control whose only outcome is a refusal is worse than no control.
    const el = await sheet({ scopes: ['devices:read'] });
    expect(el.shadowRoot?.querySelector('.hint')).toBeNull();
  });

  it('is not shown where the host offers no way to save', async () => {
    const el = await sheet({ onUpdateDevice: undefined });
    expect(el.shadowRoot?.querySelector('.hint')).toBeNull();
  });
});
