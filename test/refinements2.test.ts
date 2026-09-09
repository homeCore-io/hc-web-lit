/**
 * The three §7.3 widgets the reference house asks for: fan, contact, presence.
 *
 * Each one exists because the generic card gets something specific wrong, so
 * each test says what that was. The house is the evidence throughout — these
 * are not hypotheses about what a fan might declare.
 */
import { describe, expect, it } from 'vitest';
import '../src/widgets/hc-fan.js';
import '../src/widgets/hc-contact.js';
import '../src/widgets/hc-presence.js';
import '../src/widgets/hc-device-card.js';
import { tagForDevice } from '../src/core/registry.js';
import { formatReading, readingAt, readingOf } from '../src/core/facet.js';
import type { DeviceState } from '../src/core/device.js';
import type { HcFan } from '../src/widgets/hc-fan.js';
import type { HcContact } from '../src/widgets/hc-contact.js';
import type { HcPresence } from '../src/widgets/hc-presence.js';

const base = (over: Partial<DeviceState>): DeviceState => ({
  device_id: 'd',
  name: 'Device',
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-09T00:00:00Z',
  ...over,
});

/** A fan exactly as all four in the reference house declare themselves. */
const fan = (over: Partial<DeviceState> = {}): DeviceState =>
  base({
    device_id: 'fan_1',
    name: 'Ceiling Fan',
    device_type: 'fan',
    area: 'office',
    attributes: { on: true, speed: 'medium', speed_pct: 50.6 },
    schema: {
      primary: ['on', 'speed', 'speed_pct'],
      attributes: {
        on: { kind: 'bool', writable: true },
        speed: {
          kind: 'enum',
          writable: true,
          options: ['off', 'low', 'medium', 'medium-high', 'high'],
        },
        speed_pct: { kind: 'integer', writable: true, min: 0, max: 100 },
      },
      actions: [],
    },
    ...over,
  } as Partial<DeviceState>);

async function mount<T extends HTMLElement>(
  tag: string,
  props: Record<string, unknown>,
): Promise<T> {
  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

/**
 * What a person would read off the widget.
 *
 * Style elements excluded deliberately: Lit puts `static styles` into the
 * shadow root as `<style>` in dev mode, so plain `textContent` returns the
 * whole stylesheet too — and `height: 100%` then satisfies an assertion about
 * a battery reading 100%. That is a test passing for a reason that has nothing
 * to do with the widget.
 */
const text = (el: HTMLElement): string => {
  const root = el.shadowRoot;
  if (root === null || root === undefined) return '';
  // Cloned, stripped of `<style>`, then read whole. Lit puts `static styles`
  // into the shadow root as a `<style>` in dev mode, so plain `textContent`
  // returns the stylesheet too — and `height: 100%` then satisfies an
  // assertion about a battery reading 100%.
  //
  // Whole, rather than node by node with a separator: `12` and `%` are two
  // adjacent text nodes, and anything joining them produces "12 %".
  const holder = document.createElement('div');
  for (const child of [...root.childNodes]) holder.append(child.cloneNode(true));
  for (const style of [...holder.querySelectorAll('style')]) style.remove();
  return (holder.textContent ?? '').replace(/\s+/g, ' ').trim();
};

describe('a fan', () => {
  it('is claimed by its type, so a device grid draws it without being told', () => {
    expect(tagForDevice({ device_type: 'fan' })).toBe('hc-fan');
  });

  it('offers the speeds the plugin declared, not a slider', async () => {
    // The house has four steps and a `speed_pct` of 50.6 for "medium". A
    // generated slider would offer 101 positions for a device with four,
    // nearly all of which it cannot hold (§7.2).
    const el = await mount<HcFan>('hc-fan', { device: fan() });
    const buttons = [...(el.shadowRoot?.querySelectorAll('button') ?? [])];

    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Off',
      'Low',
      'Medium',
      'Medium high',
      'High',
    ]);
    expect(el.shadowRoot?.querySelector('input[type=range]')).toBeNull();
  });

  it('marks the speed it is actually on', async () => {
    const el = await mount<HcFan>('hc-fan', { device: fan() });
    const pressed = [...(el.shadowRoot?.querySelectorAll('button[aria-pressed=true]') ?? [])];
    expect(pressed.map((b) => b.textContent?.trim())).toEqual(['Medium']);
  });

  it('sends the plugin’s own word back, not the humanised one', async () => {
    const sent: unknown[] = [];
    const el = await mount<HcFan>('hc-fan', {
      device: fan(),
      onCommand: (r: unknown) => sent.push(r),
    });
    const high = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Medium high',
    );
    high?.click();

    // "Medium high" is for a person; `medium-high` is what the bridge knows.
    expect(sent).toEqual([{ deviceId: 'fan_1', patch: { speed: 'medium-high' } }]);
  });

  it('shows the percentage as a reading beside the named speed', async () => {
    const el = await mount<HcFan>('hc-fan', { device: fan() });
    expect(text(el)).toContain('Medium');
    expect(text(el)).toContain('51%');
  });

  it('falls back to generated controls when a plugin declares no named speeds', async () => {
    // Not a special case — the schema said what it has, and a fan that only
    // exposes a percentage should get the percentage control.
    const el = await mount<HcFan>('hc-fan', {
      device: fan({
        schema: {
          primary: ['on'],
          attributes: { on: { kind: 'bool', writable: true } },
          actions: [],
        },
      } as Partial<DeviceState>),
    });
    expect(el.shadowRoot?.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('a contact sensor', () => {
  const contact = (over: Record<string, unknown> = {}): DeviceState =>
    base({
      device_id: 'door_1',
      name: 'Bathroom Door Sensor',
      device_type: 'contact_sensor',
      attributes: { open: true, battery: 75 },
      schema: {
        primary: ['open'],
        attributes: {
          open: { kind: 'bool' },
          battery: { kind: 'integer', category: 'diagnostic' },
        },
        actions: [],
      },
      ...over,
    } as Partial<DeviceState>);

  it('says Open and Closed, never On and Off', async () => {
    // `isOn` is right that an open door is on — `open` is an on-ness
    // attribute — and "On" beside a door is still an invented fact.
    expect(text(await mount<HcContact>('hc-contact', { device: contact() }))).toContain('Open');

    const shut = await mount<HcContact>('hc-contact', {
      device: contact({ attributes: { open: false, battery: 100 } }),
    });
    expect(text(shut)).toContain('Closed');
    expect(text(shut)).not.toContain('On');
  });

  it('shows a battery only when it is worth reading', async () => {
    // Eight sensors all reading 100% is eight numbers nobody reads.
    const full = await mount<HcContact>('hc-contact', {
      device: contact({ attributes: { open: false, battery: 100 } }),
    });
    expect(text(full)).not.toContain('100%');

    const low = await mount<HcContact>('hc-contact', {
      device: contact({ attributes: { open: false, battery: 12 } }),
    });
    expect(text(low)).toContain('12%');
  });

  it('takes its face from ui_hint, and never from the name', async () => {
    // Every one of the eight in the house is named "… Door Sensor" and sets
    // no `ui_hint`. Reading the name would work here and be wrong in general:
    // a name is a person's words, not a declaration.
    expect(tagForDevice({ device_type: 'contact_sensor' })).toBe('hc-contact');
    expect(tagForDevice({ ui_hint: 'garage', device_type: 'contact_sensor' })).toBe('hc-contact');
  });
});

describe('presence', () => {
  const occupancy = base({
    device_id: 'occ_1',
    name: 'Office Occupancy',
    device_type: 'occupancy_sensor',
    // The house publishes both names for one fact.
    attributes: { occupancy: true, occupied: true },
    schema: { primary: ['occupied', 'occupancy'], attributes: {}, actions: [] },
  } as Partial<DeviceState>);

  const motion = base({
    device_id: 'mot_1',
    name: 'Office Motion',
    device_type: 'motion_sensor',
    attributes: { motion: false, illuminance: 27.66, temperature: 71.33, temperature_unit: 'F' },
    schema: {
      primary: ['motion', 'temperature', 'illuminance'],
      attributes: {},
      actions: [],
    },
  } as Partial<DeviceState>);

  it('is one widget for two device families', () => {
    expect(tagForDevice({ device_type: 'occupancy_sensor' })).toBe('hc-presence');
    expect(tagForDevice({ device_type: 'motion_sensor' })).toBe('hc-presence');
  });

  it('uses the word the device family actually means', async () => {
    // "Motion" and "Occupied" are not interchangeable to a reader: one goes
    // quiet a moment later, the other holds while somebody is in the room.
    expect(text(await mount<HcPresence>('hc-presence', { device: occupancy }))).toContain(
      'Occupied',
    );
    expect(text(await mount<HcPresence>('hc-presence', { device: motion }))).toContain('No motion');
  });

  it('shows the other instruments in the housing', async () => {
    // A Hue motion sensor declares illuminance and temperature in `primary`.
    // A card showing only "Clear" hides two thirds of what it is for.
    const el = await mount<HcPresence>('hc-presence', { device: motion });
    expect(text(el)).toContain('71.3');
    expect(text(el)).toContain('27.7');
  });

  it('invents no duration, because core cannot yet answer one', async () => {
    // `last_change.changed_at` advances on every report (homeCore#39), so
    // "clear for 40 minutes" would be a number this client cannot stand behind.
    const el = await mount<HcPresence>('hc-presence', {
      device: { ...motion, last_change: { changed_at: '2026-09-09T22:00:00Z', kind: 'unknown' } },
    });
    expect(text(el)).not.toMatch(/\bago\b|\bfor \d/);
  });
});

describe('a unit a device states twice, differently', () => {
  it('believes the reading over the schema', () => {
    // The Hue motion sensor declares °C and publishes Fahrenheit
    // (homeCore#40). Following the declaration renders "71.3 °C", which is not
    // a rounding slip — it is a house on fire, drawn calmly on a wall panel.
    const sensor = base({
      device_type: 'motion_sensor',
      attributes: { temperature: 71.33, temperature_unit: 'F', temperature_c: 21.85 },
      schema: {
        primary: ['temperature'],
        attributes: { temperature: { kind: 'float', unit: '°C', display_name: 'Temperature' } },
        actions: [],
      },
    } as Partial<DeviceState>);

    expect(formatReading(readingAt(sensor, 'temperature')!)).toBe('71.3 °F');
    expect(formatReading(readingOf(sensor)!)).toBe('71.3 °F');
  });

  it('uses the declaration when the device publishes no unit beside the value', () => {
    // The exception is narrow: it applies only where the device has said the
    // unit twice and disagreed with itself.
    const sensor = base({
      attributes: { temperature: 21.5 },
      schema: {
        primary: ['temperature'],
        attributes: { temperature: { kind: 'float', unit: '°C' } },
        actions: [],
      },
    } as Partial<DeviceState>);

    expect(formatReading(readingAt(sensor, 'temperature')!)).toBe('21.5 °C');
  });

  it('leaves a unit that is already a word alone', () => {
    const sensor = base({
      attributes: { illuminance: 27.66, illuminance_unit: 'lux' },
    } as Partial<DeviceState>);
    expect(formatReading(readingAt(sensor, 'illuminance')!)).toBe('27.7 lux');
  });
});

describe('a device_tile that names its device the plural way', () => {
  it('draws it, because that is how the reference house stores one', async () => {
    // The authored dashboard carries
    //   { selection_mode: "manual", device_ids: ["hue_…"] }
    // because `dashboard_vocabulary`'s naming ratchet requires `device_ids`
    // for a reference list, and a manual selection of one is still a list.
    // `mountWidget` resolves only the singular, so this placement arrived with
    // no device and drew "No device" on a page somebody had authored.
    const lamp = base({ device_id: 'hue_1', name: 'Attic Light', attributes: { on: false } });
    const el = await mount<HTMLElement>('hc-device-card', {
      config: { selection_mode: 'manual', device_ids: ['hue_1'] },
      devices: [lamp, base({ device_id: 'other', name: 'Not This One' })],
    });

    expect(text(el)).toContain('Attic Light');
    expect(text(el)).not.toContain('No device');
  });

  it('still prefers a device the host resolved for it', async () => {
    const named = base({ device_id: 'a', name: 'Named' });
    const el = await mount<HTMLElement>('hc-device-card', {
      device: named,
      config: { selection_mode: 'manual', device_ids: ['b'] },
      devices: [named, base({ device_id: 'b', name: 'Selected' })],
    });
    expect(text(el)).toContain('Named');
  });

  it('says nothing at all when neither names a device', async () => {
    const el = await mount<HTMLElement>('hc-device-card', { config: {}, devices: [] });
    expect(text(el)).toContain('No device');
  });
});

describe('a type-specific widget inside a device set', () => {
  it('is told it is a row, so it draws like its neighbours', async () => {
    // A fan drew a full 123px card, with its own chrome, in a column of 52px
    // rows: the right content, visibly not part of the list. The generic card
    // was already handed `compact` for the same fact.
    const el = await mount<HcFan>('hc-fan', { device: fan(), row: true });
    expect(el.hasAttribute('data-row')).toBe(true);
  });

  it('keeps its surface, because a set is not a container', async () => {
    // §5.5 suppresses chrome for a widget nested in a *container*, so borders
    // do not stack. A device set draws a column of rows, and the row's own
    // surface is what makes it read as one.
    const el = await mount<HcFan>('hc-fan', { device: fan(), row: true });
    expect(el.hasAttribute('data-bare')).toBe(false);
  });

  it('shows its state at the far edge when it has no badge of its own', async () => {
    // The row form hides `.secondary` because a column of rows reads down the
    // left and across to the right. That erased the state of every widget
    // without a badge: presence in a device list showed "Office Motion" and
    // nothing else.
    const sensor = base({
      device_id: 'occ',
      name: 'Office Occupancy',
      device_type: 'occupancy_sensor',
      attributes: { occupied: true },
    } as Partial<DeviceState>);

    const el = await mount<HcPresence>('hc-presence', { device: sensor, row: true });
    const trailing = el.shadowRoot?.querySelector('.badge');
    expect(trailing?.textContent?.trim()).toBe('Occupied');
  });

  it('leaves a widget that has a badge alone', async () => {
    // A fan's badge is its percentage; the fallback must not replace it.
    const el = await mount<HcFan>('hc-fan', { device: fan(), row: true });
    expect(el.shadowRoot?.querySelector('.badge')?.textContent?.trim()).toBe('51%');
  });
});
