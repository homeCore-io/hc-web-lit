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

describe('which room a device is in', () => {
  const house: DeviceState[] = [
    outlet,
    { ...outlet, device_id: 'a', area: 'living_room' },
    { ...outlet, device_id: 'b', area: 'master_bedroom' },
    { ...outlet, device_id: 'c', area: 'living_room' },
  ];

  it('offers the rooms the house already has, once each', async () => {
    const el = await sheet({ devices: house });
    const rooms = [...(el.shadowRoot?.querySelectorAll('datalist option') ?? [])].map((o) =>
      o.getAttribute('value'),
    );
    expect(rooms).toEqual(['Living room', 'Master bedroom']);
  });

  it('takes a room that does not exist yet', async () => {
    // An area *is* the set of devices assigned to it, so a room with no
    // devices does not exist and a select could never offer it. The first
    // device moved into a new room is what creates it.
    const sent = vi.fn(async () => undefined);
    const el = await sheet({ devices: house, onUpdateDevice: sent });
    const input = el.shadowRoot?.querySelector('.hint input') as HTMLInputElement;
    input.value = 'Front Porch';
    input.dispatchEvent(new Event('change'));

    // Sent as typed: core normalises, so the list can show words a person
    // reads without the value having to be a slug.
    expect(sent).toHaveBeenCalledWith('lutron_60', { area: 'Front Porch' });
  });

  it('clears the override with null, handing it back to the bridge', async () => {
    const sent = vi.fn(async () => undefined);
    const el = await sheet({ devices: house, onUpdateDevice: sent });
    const input = el.shadowRoot?.querySelector('.hint input') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new Event('change'));

    expect(sent).toHaveBeenCalledWith('lutron_60', { area: null });
  });

  it('shows the plugin’s own room as the placeholder', async () => {
    // So "empty" reads as "whatever the bridge says" rather than as nothing.
    const el = await sheet({
      device: { ...outlet, area: 'office', area_override: null },
      devices: house,
    });
    const input = el.shadowRoot?.querySelector('.hint input') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('Office');
  });

  it('is not shown to a session that may not write devices', async () => {
    const el = await sheet({ devices: house, scopes: ['devices:read'] });
    expect(el.shadowRoot?.querySelector('datalist')).toBeNull();
  });
});

describe('what the panel says once', () => {
  it('leads with the reading and does not list it again', async () => {
    // A switch read "On" as its headline, "On" again as a note, and
    // "Power — On" a third time under Reports. A panel that repeats itself
    // three times reads as three facts that happen to agree.
    const el = await sheet();
    expect(el.shadowRoot?.querySelector('.lead')?.textContent).toContain('On');
    const labels = [...(el.shadowRoot?.querySelectorAll('.row .k') ?? [])].map((k) =>
      k.textContent?.trim(),
    );
    expect(labels, 'the headline is not also a row').not.toContain('On');
  });

  it('draws no Reports heading over an empty list', async () => {
    // Taking the lead out empties the list for any device whose whole
    // vocabulary is the one thing it leads with. A section with nothing in it
    // is not a section.
    const el = await sheet();
    expect(el.shadowRoot?.textContent).not.toContain('Reports');
  });

  it('still reports everything that is not the headline', async () => {
    const el = await sheet({
      device: { ...outlet, attributes: { on: true, rssi: -61 } },
    });
    expect(el.shadowRoot?.textContent).toContain('Reports');
  });

  it('tells two readings apart when the plugin gave them one name', async () => {
    // The office fan publishes `speed` and `speed_pct` and *declares*
    // `display_name: "Speed"` for both — the plugin's own answer, twice. The
    // sheet listed "Speed off" above "Speed 0%" and left a person to guess
    // which was which, or whether the device was contradicting itself.
    const el = await sheet({
      device: {
        ...outlet,
        attributes: { on: true, speed: 'off', speed_pct: 0 },
        schema: {
          attributes: {
            speed: { kind: 'string', display_name: 'Speed' },
            speed_pct: { kind: 'number', display_name: 'Speed' },
          },
          actions: [],
        },
      },
    });
    const labels = [...(el.shadowRoot?.querySelectorAll('.row .k') ?? [])].map((k) =>
      k.textContent?.trim(),
    );
    expect(labels).toContain('Speed (speed)');
    expect(labels).toContain('Speed (speed_pct)');
  });

  it('lays every state out in a panel, with the one in force marked', async () => {
    // A menu hides every choice behind a click and shows one word with no
    // indication of whether it is the state or the button: "CONTROLS — POWER
    // — Off" could as easily have meant "press to turn off".
    const el = await sheet();
    const controls = el.shadowRoot?.querySelector('hc-controls') as HTMLElement & {
      updateComplete: Promise<unknown>;
      shadowRoot: ShadowRoot | null;
    };
    await controls.updateComplete;
    const choices = [...(controls.shadowRoot?.querySelectorAll('.choices button') ?? [])].map(
      (b) => `${b.textContent?.trim()}:${b.getAttribute('aria-pressed')}`,
    );
    expect(choices).toEqual(['Off:false', 'On:true']);
  });
});
