/**
 * The three core types bound to one writable attribute.
 *
 * What is worth pinning is shared: a command is *accepted*, not applied, so a
 * control that shows only the live value snaps back under the finger; and the
 * bounds a plugin declared decide which presses are offered, because a press
 * that sends a command core will refuse is a control that lies.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import type { CommandRequest } from '../src/core/widget.js';
import '../src/widgets/hc-toggle.js';
import '../src/widgets/hc-stepper.js';
import '../src/widgets/hc-thermostat.js';

async function mount<T extends HTMLElement>(
  tag: string,
  props: Record<string, unknown>,
): Promise<T & { updateComplete: Promise<unknown> }> {
  const el = document.createElement(tag) as T & { updateComplete: Promise<unknown> };
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const text = (el: HTMLElement): string =>
  [...(el.shadowRoot?.childNodes ?? [])]
    .filter((n) => (n as Element).tagName !== 'STYLE')
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const press = (el: HTMLElement, label: string): void =>
  el.shadowRoot?.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click() ?? undefined;

const device = (
  attributes: Record<string, unknown>,
  schema?: DeviceState['schema'],
): DeviceState => ({
  device_id: 'dev_1',
  name: 'Hall',
  plugin_id: 'test',
  available: true,
  attributes,
  last_seen: '2026-09-10T00:00:00Z',
  ...(schema !== undefined ? { schema } : {}),
});

describe('the toggle', () => {
  it('asks the host, and never acts itself', async () => {
    const sent = vi.fn<(r: CommandRequest) => void>();
    const el = await mount('hc-toggle', {
      config: { attribute: 'on' },
      device: device({ on: false }),
      onCommand: sent,
    });
    el.shadowRoot?.querySelector('button')?.click();
    expect(sent).toHaveBeenCalledWith({ deviceId: 'dev_1', patch: { on: true } });
  });

  it('holds the moved value until the house confirms it', async () => {
    const el = await mount('hc-toggle', {
      config: { attribute: 'on' },
      device: device({ on: false }),
      onCommand: vi.fn(),
    });
    el.shadowRoot?.querySelector('button')?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('button')?.getAttribute('aria-checked')).toBe('true');
  });

  it('uses the device’s own words for its two states', async () => {
    // A contact sensor's `open` is not "On/Off", and the schema says so.
    const el = await mount('hc-toggle', {
      config: { attribute: 'open' },
      device: device(
        { open: true },
        {
          attributes: {
            open: {
              kind: 'bool',
              writable: true,
              states: { when_true: { label: 'ajar' }, when_false: { label: 'shut' } },
            },
          },
        },
      ),
      onCommand: vi.fn(),
    });
    expect(text(el)).toContain('Ajar');
  });

  it('is not pressable without a host to press for it', async () => {
    const el = await mount('hc-toggle', {
      config: { attribute: 'on' },
      device: device({ on: false }),
    });
    expect(el.shadowRoot?.querySelector('button')?.disabled).toBe(true);
  });
});

describe('the stepper', () => {
  const dimmer = () =>
    device(
      { brightness_pct: 40 },
      {
        attributes: {
          brightness_pct: { kind: 'integer', writable: true, min: 0, max: 100, unit: '%', step: 5 },
        },
      },
    );

  it('moves by the step the plugin declared', async () => {
    const sent = vi.fn<(r: CommandRequest) => void>();
    const el = await mount('hc-stepper', {
      config: { attribute: 'brightness_pct' },
      device: dimmer(),
      onCommand: sent,
    });
    press(el, 'More Brightness pct');
    expect(sent).toHaveBeenCalledWith({ deviceId: 'dev_1', patch: { brightness_pct: 45 } });
  });

  it('does not offer a press core would refuse', async () => {
    // §5.10's rule about not offering what cannot happen, applied to a number.
    const el = await mount('hc-stepper', {
      config: { attribute: 'brightness_pct' },
      device: device(
        { brightness_pct: 100 },
        { attributes: { brightness_pct: { kind: 'integer', writable: true, min: 0, max: 100 } } },
      ),
      onCommand: vi.fn(),
    });
    expect(
      el.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="More Brightness pct"]')
        ?.disabled,
    ).toBe(true);
    expect(
      el.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Less Brightness pct"]')
        ?.disabled,
    ).toBe(false);
  });

  it('does not send a number nobody typed', async () => {
    // 20.5 + 0.1 is 20.599999999999998, and a setpoint stored to that many
    // places is one no person chose.
    const sent = vi.fn<(r: CommandRequest) => void>();
    const el = await mount('hc-stepper', {
      config: { attribute: 'level', step: 0.1 },
      device: device({ level: 20.5 }, { attributes: { level: { kind: 'float', writable: true } } }),
      onCommand: sent,
    });
    press(el, 'More Level');
    expect(sent).toHaveBeenCalledWith({ deviceId: 'dev_1', patch: { level: 20.6 } });
  });
});

describe('the thermostat', () => {
  const stat = (attrs: Record<string, unknown> = { temperature: 68, setpoint: 70 }) =>
    device(attrs, {
      primary: ['temperature'],
      attributes: {
        temperature: { kind: 'float', unit: '°F' },
        setpoint: { kind: 'float', writable: true, unit: '°F', min: 50, max: 90 },
      },
    });

  it('finds the setpoint the plugin declared, without being told', async () => {
    // One writable number beside a reading has already said which is which.
    const sent = vi.fn<(r: CommandRequest) => void>();
    const el = await mount('hc-thermostat', { config: {}, device: stat(), onCommand: sent });
    expect(text(el)).toContain('68 °F');
    press(el, 'Warmer');
    expect(sent).toHaveBeenCalledWith({ deviceId: 'dev_1', patch: { setpoint: 71 } });
  });

  it('asks rather than guesses when there are two', async () => {
    // Picking the alphabetically-first of two setpoints would be a client
    // deciding what a house wants.
    const el = await mount('hc-thermostat', {
      config: {},
      device: device(
        { temperature: 68, cooling_setpoint: 74, heating_setpoint: 68 },
        {
          primary: ['temperature'],
          attributes: {
            temperature: { kind: 'float', unit: '°F' },
            cooling_setpoint: { kind: 'float', writable: true },
            heating_setpoint: { kind: 'float', writable: true },
          },
        },
      ),
      onCommand: vi.fn(),
    });
    expect(text(el)).toContain('No setpoint declared');
  });

  it('takes the one it is told about', async () => {
    const sent = vi.fn<(r: CommandRequest) => void>();
    const el = await mount('hc-thermostat', {
      config: { target: 'heating_setpoint' },
      device: device(
        { temperature: 68, cooling_setpoint: 74, heating_setpoint: 68 },
        {
          primary: ['temperature'],
          attributes: {
            temperature: { kind: 'float', unit: '°F' },
            cooling_setpoint: { kind: 'float', writable: true },
            heating_setpoint: { kind: 'float', writable: true },
          },
        },
      ),
      onCommand: sent,
    });
    press(el, 'Cooler');
    expect(sent).toHaveBeenCalledWith({ deviceId: 'dev_1', patch: { heating_setpoint: 67 } });
  });

  it('says the setpoint is missing rather than drawing a dash somebody may press', async () => {
    const el = await mount('hc-thermostat', {
      config: {},
      device: stat({ temperature: 68 }),
      onCommand: vi.fn(),
    });
    expect(text(el)).toContain('not reported yet');
    expect(el.shadowRoot?.querySelector('[aria-label="Warmer"]')).toBeNull();
  });
});
