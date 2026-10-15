/**
 * Putting the house on a page, device first (§ insert.ts).
 *
 * The editor offers devices, and these pin the answer it gives on the
 * person's behalf: which widget a device becomes when dropped, what else it
 * could be shown as, and that it arrives bound — never as an empty box.
 */
import { describe, expect, it } from 'vitest';
import {
  deviceOfTool,
  deviceTool,
  firstWay,
  startSize,
  wayIndex,
  waysToShow,
} from '../src/core/insert.js';
import { reshapeWidget } from '../src/core/pages.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import type { DeviceState } from '../src/core/device.js';
import type { DeviceSchema } from '../src/core/api.js';
import '../src/widgets/hc-lock.js';
import '../src/widgets/hc-scene-button.js';
import '../src/widgets/hc-device-card.js';

const device = (over: Partial<DeviceState> & { schema?: DeviceSchema | null }): DeviceState => ({
  device_id: 'd',
  name: 'Device',
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-10-15T00:00:00Z',
  ...over,
});

const lamp = device({
  device_id: 'lamp',
  device_type: 'light',
  attributes: { on: false, brightness_pct: 30 },
  schema: {
    attributes: {
      on: { kind: 'bool', writable: true },
      brightness_pct: { kind: 'integer', writable: true, min: 0, max: 100 },
    },
  },
});

const door = device({
  device_id: 'front_door',
  device_type: 'zwave',
  attributes: { locked: true },
  schema: { attributes: { locked: { kind: 'bool', writable: true } } },
});

const scene = device({
  device_id: 'evening',
  device_type: 'scene',
  attributes: { active: false },
  schema: { attributes: { active: { kind: 'bool' } }, actions: [{ id: 'activate' } as never] },
});

const thermometer = device({
  device_id: 'temp',
  device_type: 'temperature_sensor',
  attributes: { temperature: 21.5 },
  schema: { attributes: { temperature: { kind: 'float', unit: '°C' } } },
});

describe('what a device becomes when it is dropped', () => {
  it('is drawn the way the house draws it — a lock as a lock, whatever its type says', () => {
    expect(firstWay(door).type).toBe('lock');
    expect(firstWay(door).config).toEqual({ device_id: 'front_door' });
  });

  it('is a card when nothing more particular draws it', () => {
    const way = firstWay(lamp);
    expect(way.type).toBe('device_tile');
    // Bound both ways: what the host resolves and what core's vocabulary requires.
    expect(way.config).toEqual({
      device_id: 'lamp',
      selection_mode: 'manual',
      device_ids: ['lamp'],
    });
  });

  it('names a scene by scene_id, which is what a scene button requires', () => {
    const way = firstWay(scene);
    expect(way.type).toBe('scene_button');
    expect(way.config['scene_id']).toBe('evening');
  });

  it('starts at a size for what it is, not one size for everything', () => {
    expect(firstWay(door).size).toEqual(startSize('lock'));
    expect(startSize('device_pill').free.h).toBeLessThan(startSize('lock').free.h);
  });
});

describe('the other ways to show it', () => {
  it('offers only controls the device can fill', () => {
    const lampWays = waysToShow(lamp).map((w) => w.label);
    expect(lampWays).toContain('Switch');
    expect(lampWays).toContain('Brightness slider');
    expect(lampWays).not.toContain('Colour wheel');

    const doorWays = waysToShow(door).map((w) => w.label);
    expect(doorWays[0]).toBe('Lock');
    expect(doorWays).not.toContain('Brightness slider');
  });

  it('charts a reading that is a number, on that reading', () => {
    const chart = waysToShow(thermometer).find((w) => w.type === 'history_chart');
    expect(chart?.config['attribute']).toBe('temperature');
  });

  it('knows which way a widget already is, by attribute where a type serves twice', () => {
    const ways = waysToShow(lamp);
    const slider = ways.findIndex((w) => w.label === 'Brightness slider');
    expect(wayIndex(ways, 'slider', { attribute: 'brightness_pct' })).toBe(slider);
    expect(wayIndex(ways, 'gauge', {})).toBe(-1);
  });
});

describe('the tool that carries a device', () => {
  it('round-trips, and a widget tool carries none', () => {
    expect(deviceOfTool(deviceTool('front_door'))).toBe('front_door');
    expect(deviceOfTool('heading')).toBeUndefined();
    expect(deviceOfTool(undefined)).toBeUndefined();
  });
});

describe('showing a widget another way', () => {
  const doc: DashboardDefinition = {
    id: 'p',
    name: 'P',
    widgets: [
      {
        id: 'w',
        type: 'device_tile',
        title: 'Desk',
        config: {
          device_id: 'lamp',
          selection_mode: 'manual',
          device_ids: ['lamp'],
          group: 'Office',
        },
      },
    ],
    layouts: [],
  } as unknown as DashboardDefinition;

  it('keeps what the widget is and drops what only the old type read', () => {
    const next = reshapeWidget(doc, 'w', 'toggle', { device_id: 'lamp', attribute: 'on' });
    const w = next.widgets?.[0];
    expect(w?.type).toBe('toggle');
    expect(w?.title).toBe('Desk');
    expect(w?.config).toEqual({ group: 'Office', device_id: 'lamp', attribute: 'on' });
  });
});
