/**
 * The four core types about the house rather than about one device.
 *
 * `stat_summary` and `rooms` count; `dashboard_link` navigates; `web_embed`
 * holds somebody else's page. What is worth pinning is that they count the
 * same things the rest of the client counts, that navigation goes through the
 * host, and that the embed's sandbox is decided by the profile rather than by
 * the URL.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import '../src/widgets/hc-stat-summary.js';
import '../src/widgets/hc-rooms.js';
import '../src/widgets/hc-web-embed.js';
import '../src/widgets/hc-dashboard-link.js';

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

const device = (id: string, extra: Partial<DeviceState>): DeviceState => ({
  device_id: id,
  name: id,
  plugin_id: 'test',
  available: true,
  attributes: {},
  last_seen: '2026-09-10T00:00:00Z',
  ...extra,
});

const house: DeviceState[] = [
  device('l1', { device_type: 'light', area: 'office', attributes: { on: true } }),
  device('l2', { device_type: 'light', area: 'office', attributes: { on: false } }),
  device('l3', { device_type: 'light', area: 'hallway', attributes: { on: true } }),
  device('s1', { device_type: 'switch', area: 'hallway', attributes: { on: false } }),
  device('sc', { device_type: 'scene', area: 'office', attributes: {} }),
  device('off', { device_type: 'switch', area: 'attic', available: false, attributes: {} }),
];

describe('stat_summary', () => {
  it('counts what the rest of the client counts', async () => {
    // Two answers to "how many lights are on" is one too many; this client has
    // already shipped a header that disagreed with the room below it.
    const el = await mount('hc-stat-summary', {
      config: { metrics: ['devices', 'lights_on', 'offline'] },
      devices: house,
    });
    expect(text(el)).toContain('5 Devices');
    expect(text(el)).toContain('2 Lights on');
    expect(text(el)).toContain('1 Offline');
  });

  it('counts core’s own `on`, which its vocabulary’s list does not have', async () => {
    // Core seeds a new install with metrics: ["devices", "on", "offline"].
    const el = await mount('hc-stat-summary', { config: { metrics: ['on'] }, devices: house });
    expect(text(el)).toContain('2 On');
  });

  it('names a metric it does not know rather than dropping it', async () => {
    const el = await mount('hc-stat-summary', {
      config: { metrics: ['humidity_average'] },
      devices: house,
    });
    expect(text(el)).toContain('— Humidity average');
  });
});

describe('rooms', () => {
  it('counts the selection, not everything', async () => {
    const el = await mount('hc-rooms', {
      config: { selection_mode: 'facet', facet: 'lights' },
      devices: house,
    });
    // The hallway has a light and a switch; only the light counts here.
    expect(text(el)).toContain('Hallway 1 of 1 on');
    expect(text(el)).toContain('Office 1 of 2 on');
  });

  it('counts on-ness only where it is a question', async () => {
    // A room of temperature sensors is not "0 of 3 on", because none of them
    // can be off (§1.1).
    const el = await mount('hc-rooms', {
      config: {},
      devices: [
        device('t1', {
          device_type: 'temperature_sensor',
          area: 'cellar',
          attributes: { temperature: 12 },
        }),
        device('t2', {
          device_type: 'temperature_sensor',
          area: 'cellar',
          attributes: { temperature: 13 },
        }),
      ],
    });
    expect(text(el)).toContain('Cellar 2 devices');
    expect(text(el)).not.toContain('of 2 on');
  });

  it('says none are on rather than falling back to a bare count', async () => {
    // The bug this pins: a room whose lights are all off read "2 devices",
    // which is what a room of sensors reads. Two rooms in the reference house
    // said that while their lights were merely off.
    const el = await mount('hc-rooms', {
      config: {},
      devices: [
        device('a', { device_type: 'light', area: 'cellar', attributes: { on: false } }),
        device('b', { device_type: 'light', area: 'cellar', attributes: { on: false } }),
      ],
    });
    expect(text(el)).toContain('0 of 2 on');
  });

  it('keeps the order somebody chose, then the rest', async () => {
    const el = await mount('hc-rooms', { config: { room_order: ['hallway'] }, devices: house });
    const names = [...(el.shadowRoot?.querySelectorAll('[part="name"]') ?? [])].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Hallway', 'Attic', 'Office']);
  });

  it('keeps a named room that is empty, and hides one only when asked', async () => {
    const named = { rooms_mode: 'named', rooms: ['office', 'cellar'] };
    const shown = await mount('hc-rooms', { config: named, devices: house });
    expect(text(shown)).toContain('Cellar');

    const hidden = await mount('hc-rooms', {
      config: { ...named, hide_empty: true },
      devices: house,
    });
    expect(text(hidden)).not.toContain('Cellar');
  });
});

describe('dashboard_link', () => {
  it('navigates through the host, not by itself', async () => {
    const action = vi.fn();
    const el = await mount('hc-dashboard-link', {
      config: { dashboard_ids: ['dashboard_house'] },
      pages: [{ id: 'dashboard_house', name: 'Every room' }],
      ctx: { action },
    });
    expect(text(el)).toContain('Every room');
    el.shadowRoot?.querySelector('button')?.click();
    expect(action).toHaveBeenCalledWith({ do: 'page', target: 'dashboard_house' });
  });

  it('still offers a page it cannot name', async () => {
    // A renamed or not-yet-loaded page: the id is what the author typed.
    const el = await mount('hc-dashboard-link', {
      config: { dashboard_ids: ['dashboard_attic'] },
      pages: [],
      ctx: { action: vi.fn() },
    });
    expect(el.shadowRoot?.querySelector('button')).not.toBeNull();
    expect(text(el)).toContain('Dashboard attic');
  });
});

describe('web_embed', () => {
  const sandboxOf = (el: HTMLElement): string | null =>
    el.shadowRoot?.querySelector('iframe')?.getAttribute('sandbox') ?? null;

  it('sandboxes by profile, and defaults to the one that cannot reach this app', async () => {
    const fallback = await mount('hc-web-embed', { config: { url: 'https://example.com' } });
    expect(sandboxOf(fallback)).toBe('allow-scripts');

    const strict = await mount('hc-web-embed', {
      config: { url: 'https://example.com', sandbox_profile: 'strict_isolated' },
    });
    expect(sandboxOf(strict)).toBe('');

    const trusted = await mount('hc-web-embed', {
      config: { url: 'https://example.com', sandbox_profile: 'trusted_internal' },
    });
    expect(sandboxOf(trusted)).toContain('allow-same-origin');
  });

  it('gives a profile it does not know the strictest, not the loosest', async () => {
    const el = await mount('hc-web-embed', {
      config: { url: 'https://example.com', sandbox_profile: 'allow_everything' },
    });
    expect(sandboxOf(el)).toBe('');
  });

  it('refuses an address that would run in this page rather than in the frame', async () => {
    const el = await mount('hc-web-embed', { config: { url: 'javascript:alert(1)' } });
    expect(el.shadowRoot?.querySelector('iframe')).toBeNull();
    expect(text(el)).toContain('not an address');
  });
});
