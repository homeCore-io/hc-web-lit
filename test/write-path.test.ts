import { describe, expect, it, vi } from 'vitest';
import { HcApi } from '../src/core/api.js';
import { controlsFor } from '../src/core/controls.js';
import type { DeviceState } from '../src/core/device.js';
import '../src/widgets/hc-controls.js';
import '../src/widgets/hc-device-card.js';
import '../src/widgets/hc-keypad.js';
import type { HcControls } from '../src/widgets/hc-controls.js';

const light = (attrs: Record<string, unknown>): DeviceState => ({
  device_id: 'hue_1',
  name: 'Lamp',
  plugin_id: 'hue',
  available: true,
  attributes: attrs,
  last_seen: '2026-09-07T00:00:00Z',
  schema: {
    attributes: {
      on: { kind: 'bool', writable: true, display_name: 'Power' },
      brightness_pct: { kind: 'integer', writable: true, min: 0, max: 100, unit: '%' },
    },
  },
});

async function mount(device: DeviceState, onCommand?: HcControls['onCommand']) {
  const el = document.createElement('hc-controls');
  el.device = device;
  el.controls = controlsFor(device);
  if (onCommand !== undefined) el.onCommand = onCommand;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('the write path', () => {
  it('asks the host to toggle, and never reaches the API itself', async () => {
    const sent = vi.fn();
    const el = await mount(light({ on: false, brightness_pct: 0 }), sent);

    const toggle = el.shadowRoot?.querySelector('button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();

    expect(sent).toHaveBeenCalledWith({ deviceId: 'hue_1', patch: { on: true } });
  });

  it('holds the moved value until the house confirms it', async () => {
    // A command is accepted, not applied — the real value comes back on the
    // event stream. Without this the control snaps back under the finger for
    // the length of a round trip and reads as broken.
    const el = await mount(light({ on: false }), vi.fn());
    (el.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('drops the pending value the moment the device actually changes', async () => {
    const el = await mount(light({ on: false }), vi.fn());
    (el.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
    await el.updateComplete;

    // The house says no — a bulb that did not respond, or a rule that turned it
    // straight back off. Whatever arrives wins.
    el.device = light({ on: false });
    el.controls = controlsFor(el.device);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('sends a slider change as an attribute write', async () => {
    // The generated row draws `hc-slider` rather than a range input, so the
    // control the schema produced and the one the room page shows are the same
    // control. The write still leaves through the host's sink.
    const sent = vi.fn();
    const el = await mount(light({ on: true, brightness_pct: 20 }), sent);

    const slider = el.shadowRoot?.querySelector('hc-slider') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    expect(slider).toBeTruthy();
    await slider.updateComplete;

    const track = slider.shadowRoot?.querySelector('[role="slider"]') as HTMLElement;
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // One arrow is a twentieth of the range: 20 + 5.
    expect(sent).toHaveBeenCalledWith({ deviceId: 'hue_1', patch: { brightness_pct: 25 } });
  });

  it('is read-only with no command sink, and says so by disabling', async () => {
    // The absence of a host to send to is not an error and not a silent
    // no-op: the controls are visible and plainly inert.
    const el = await mount(light({ on: true }));
    const toggle = el.shadowRoot?.querySelector('button') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it('sends an action with its parameter, resolved from the device', async () => {
    const sent = vi.fn();
    const keypad: DeviceState = {
      device_id: 'lutron_52',
      name: 'Keypad',
      plugin_id: 'lutron',
      available: true,
      last_seen: '2026-09-07T00:00:00Z',
      attributes: {
        available_buttons: [
          { name: 'OH Door 1', number: 1 },
          { name: 'Lights', number: 3 },
        ],
      },
      schema: {
        actions: [
          {
            id: 'press_button',
            label: 'Press a button',
            sentence: 'press button {button} on {device}',
            params: [
              {
                name: 'button',
                kind: 'int',
                options_from: {
                  attribute: {
                    attribute: 'available_buttons',
                    label_key: 'name',
                    value_key: 'number',
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const el = await mount(keypad, sent);
    const buttons = [...(el.shadowRoot?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];

    // One button per engraved label, straight off the wall.
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['OH Door 1', 'Lights']);

    buttons[1]?.click();
    expect(sent).toHaveBeenCalledWith({
      deviceId: 'lutron_52',
      action: { id: 'press_button', params: { button: '3' } },
    });
  });
});

describe('the action wire format', () => {
  it('goes to the same endpoint as an attribute write, with an action key', async () => {
    // Core: "an attribute write is {source: ...}; an action is {action: ...}.
    // Both reach the plugin through the same devices/{id}/cmd topic."
    let body: unknown;
    const api = new HcApi({
      baseUrl: '/api/v1',
      token: 't',
      fetch: vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Promise.resolve(new Response(null, { status: 202 }));
      }) as unknown as typeof globalThis.fetch,
    });

    await api.callAction('lutron_52', 'press_button', { button: 3 });
    expect(body).toEqual({ action: 'press_button', button: 3 });
  });
});

describe('a list row that can act', () => {
  const mountRow = async (device: DeviceState, onCommand?: (r: unknown) => void) => {
    const el = document.createElement('hc-device-card');
    el.device = device;
    el.compact = true;
    if (onCommand !== undefined) el.onCommand = onCommand as HcControls['onCommand'];
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const sensor = (): DeviceState => ({
    device_id: 'ecowitt_1',
    name: 'Temp Sensor',
    plugin_id: 'ecowitt',
    available: true,
    attributes: { temperature: 21.5 },
    last_seen: '2026-09-08T00:00:00Z',
    schema: { attributes: { temperature: { kind: 'float', unit: 'C' } }, primary: ['temperature'] },
  });

  it('offers a switch where the device declared one', async () => {
    // The working client puts a toggle in the row, and a list of switches you
    // cannot switch is a list of labels.
    const sent = vi.fn();
    const el = await mountRow(light({ on: false }), sent);
    const sw = el.shadowRoot?.querySelector('.switch') as HTMLButtonElement;
    expect(sw).toBeTruthy();

    sw.click();
    expect(sent).toHaveBeenCalledWith({ deviceId: 'hue_1', patch: { on: true } });
  });

  it('offers none to a device that has no power state', async () => {
    // A thermometer cannot be turned off, so there is nothing to draw (§1.1).
    const el = await mountRow(sensor(), vi.fn());
    expect(el.shadowRoot?.querySelector('.switch')).toBeNull();
    expect(el.shadowRoot?.textContent).toContain('21.5');
  });

  it('holds the moved switch until the house confirms', async () => {
    const el = await mountRow(light({ on: false }), vi.fn());
    (el.shadowRoot?.querySelector('.switch') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.switch')?.getAttribute('aria-pressed')).toBe('true');

    // The house says otherwise; whatever arrives wins.
    el.device = light({ on: false });
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.switch')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('is inert with no host to send to, and looks it', async () => {
    const el = await mountRow(light({ on: false }));
    expect((el.shadowRoot?.querySelector('.switch') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a keypad and a remote, from one widget', () => {
  const mountKeypad = async (device: DeviceState, onCommand?: (r: unknown) => void) => {
    const el = document.createElement('hc-keypad');
    el.device = device;
    if (onCommand !== undefined) el.onCommand = onCommand as HcControls['onCommand'];
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  const keypad = (): DeviceState => ({
    device_id: 'lutron_36',
    name: 'Entry Keypad',
    plugin_id: 'lutron',
    available: true,
    device_type: 'vcrx',
    last_seen: '2026-09-09T00:00:00Z',
    attributes: {
      available_buttons: [
        { name: 'OH Door 1', number: 1 },
        { name: 'Lights', number: 3 },
      ],
      led_1: 0,
      led_3: 1,
    },
    schema: {
      actions: [
        {
          id: 'press_button',
          label: 'Press a button',
          params: [
            {
              name: 'button',
              kind: 'int',
              options_from: {
                attribute: {
                  attribute: 'available_buttons',
                  label_key: 'name',
                  value_key: 'number',
                },
              },
            },
          ],
        },
      ],
    },
  });

  const pico = (): DeviceState => ({
    device_id: 'caseta_6',
    name: 'Pico',
    plugin_id: 'caseta',
    available: true,
    device_type: 'pico_remote',
    last_seen: '2026-09-09T00:00:00Z',
    attributes: { available_buttons: [2, 3, 4] },
    schema: { actions: [] },
  });

  it('presses the button the bridge engraved', async () => {
    const sent = vi.fn();
    const el = await mountKeypad(keypad(), sent);

    const buttons = [...(el.shadowRoot?.querySelectorAll('button.key') ?? [])] as HTMLElement[];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['OH Door 1', 'Lights']);

    buttons[1]?.click();
    expect(sent).toHaveBeenCalledWith({
      deviceId: 'lutron_36',
      action: { id: 'press_button', params: { button: '3' } },
    });
  });

  it('shows which LED the device reports lit', async () => {
    const el = await mountKeypad(keypad(), vi.fn());
    const leds = [...(el.shadowRoot?.querySelectorAll('.led') ?? [])];
    expect(leds.map((l) => l.hasAttribute('data-lit'))).toEqual([false, true]);
  });

  it('lists a remote’s buttons without offering to press them', async () => {
    // A Pico transmits and declares no action. Same widget, opposite answer,
    // and the plugin said so — no type table involved (§7.3).
    const el = await mountKeypad(pico(), vi.fn());
    expect(el.shadowRoot?.querySelectorAll('button.key')).toHaveLength(0);
    expect(el.shadowRoot?.querySelectorAll('.key')).toHaveLength(3);
    expect(el.shadowRoot?.textContent).toContain('Sends only');
  });
});
