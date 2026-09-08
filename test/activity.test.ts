import { describe, expect, it } from 'vitest';
import { activityFrom, newsIn, type LogEntry } from '../src/core/activity.js';
import type { DeviceState } from '../src/core/device.js';

const device = (id: string, over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: id,
  name: id,
  plugin_id: 'p',
  available: true,
  attributes: {},
  last_seen: '2026-09-08T00:00:00Z',
  ...over,
});

const changed = (
  seq: number,
  deviceId: string,
  keys: string[],
  current: Record<string, unknown> = {},
): LogEntry => ({
  seq,
  event_type: 'device_state_changed',
  device_id: deviceId,
  event: {
    changed: keys,
    current,
    change: { changed_at: '2026-09-08T16:15:02Z', kind: 'unknown' },
  },
});

describe('newsIn', () => {
  it('drops a field that ticks because it holds a clock', () => {
    // 158 of 300 consecutive events on the reference house are one Roku
    // republishing device_info. A feed that prints those is a feed nobody
    // reads.
    expect(newsIn(['device_info'])).toEqual([]);
    expect(newsIn(['available_apps', 'media_position'])).toEqual([]);
  });

  it('collapses the same reading arriving five ways', () => {
    // A Hue motion sensor publishes all of these in one change. Listing five
    // is listing one thing five times.
    expect(
      newsIn([
        'temperature',
        'temperature_f',
        'temperature_c',
        'temperature_valid',
        'temperature_unit',
      ]),
    ).toEqual(['temperature']);
  });

  it('keeps a suffixed reading when the bare stem never arrives', () => {
    expect(newsIn(['illuminance_lux'])).toEqual(['illuminance_lux']);
  });

  it('drops housekeeping but keeps the reading beside it', () => {
    expect(newsIn(['battery_pct', 'motion'])).toEqual(['motion']);
  });
});

describe('activityFrom', () => {
  const house = [
    device('lamp', { name: 'Desk Lamp', area: 'office' }),
    device('roku', { name: 'Office TV', area: 'office' }),
    device('kitchen', { name: 'Kitchen Light', area: 'kitchen' }),
  ];

  it('says what changed, not that something did', () => {
    // "Desk Lamp changed" costs a reader the same attention as the useful
    // version and gives them nothing.
    const got = activityFrom({}, [changed(1, 'lamp', ['on'], { on: true })], house);
    expect(got[0]).toMatchObject({ who: 'Desk Lamp', what: 'on' });
  });

  it('names a value where there is one worth saying', () => {
    const got = activityFrom(
      {},
      [changed(1, 'lamp', ['brightness_pct'], { brightness_pct: 40 })],
      house,
    );
    expect(got[0]?.what).toBe('brightness pct 40');
  });

  it('drops an entry whose only changes were noise', () => {
    const got = activityFrom({}, [changed(1, 'roku', ['device_info'], {})], house);
    expect(got).toEqual([]);
  });

  it('keeps a rule firing, which is the question a feed exists to answer', () => {
    const got = activityFrom(
      {},
      [{ seq: 9, event_type: 'rule_fired', event: { rule_name: 'Evening lights' } }],
      house,
    );
    expect(got[0]).toMatchObject({ who: 'the house', what: 'rule Evening lights' });
  });

  it('reads an availability change in plain words', () => {
    const got = activityFrom(
      {},
      [
        {
          seq: 3,
          event_type: 'device_availability_changed',
          device_id: 'lamp',
          event: { available: false },
        },
      ],
      house,
    );
    expect(got[0]?.what).toBe('went offline');
  });

  it('narrows to a room, and shows nothing for a room it does not know', () => {
    const log = [
      changed(1, 'lamp', ['on'], { on: true }),
      changed(2, 'kitchen', ['on'], { on: true }),
    ];
    expect(activityFrom({ area_name: '@room' }, log, house, 'office').map((r) => r.who)).toEqual([
      'Desk Lamp',
    ]);
    expect(activityFrom({ area_name: '@room' }, log, house)).toEqual([]);
  });

  it('narrows by type and by device when asked', () => {
    const log = [
      changed(1, 'lamp', ['on'], { on: true }),
      { seq: 2, event_type: 'rule_fired', event: { rule_name: 'X' } },
    ];
    expect(activityFrom({ types: ['rule_fired'] }, log, house)).toHaveLength(1);
    expect(activityFrom({ device_ids: ['lamp'] }, log, house).map((r) => r.who)).toEqual([
      'Desk Lamp',
    ]);
  });

  it('names a device the house no longer has by its id', () => {
    const got = activityFrom({}, [changed(1, 'ghost', ['on'], { on: true })], house);
    expect(got[0]?.who).toBe('ghost');
  });

  it('limits after filtering, so a limit of five is five useful lines', () => {
    const log = [
      changed(1, 'roku', ['device_info']),
      changed(2, 'lamp', ['on'], { on: true }),
      changed(3, 'roku', ['device_info']),
      changed(4, 'kitchen', ['on'], { on: false }),
    ];
    expect(activityFrom({ limit: 2 }, log, house).map((r) => r.who)).toEqual([
      'Desk Lamp',
      'Kitchen Light',
    ]);
  });
});

describe('a device reporting a lot at once', () => {
  it('names a readable few and counts the rest', () => {
    // Measured before choosing this: across 300 consecutive events, once the
    // name rules have run, exactly one exceeds five readings — the weather
    // station honestly reporting thirteen. Dropping it as "a state dump" would
    // have been the only case such a rule ever fired on, and wrong.
    const got = activityFrom(
      {},
      [
        changed(
          1,
          'weather',
          ['temperature', 'humidity', 'wind_speed', 'gust_speed', 'uvi', 'vpd'],
          { temperature: 71.8, humidity: 60 },
        ),
      ],
      [device('weather', { name: 'Weather Station' })],
    );
    expect(got[0]?.what).toContain('temperature 71.8');
    expect(got[0]?.what).toContain('and 2 more');
  });

  it('still names the three things a light does when it comes on', () => {
    const got = activityFrom(
      {},
      [
        changed(1, 'lamp', ['on', 'brightness_pct', 'color_temp'], {
          on: true,
          brightness_pct: 80,
          color_temp: 2700,
        }),
      ],
      [device('lamp', { name: 'Lamp' })],
    );
    expect(got[0]?.what).toContain('on');
    expect(got[0]?.what).toContain('brightness pct 80');
    expect(got[0]?.what).not.toContain('more');
  });

  it('drops a nested subsystem reporting on itself, by name not by count', () => {
    // The genuine dumps go here rather than at the count: a WLED republishing
    // wifi.rssi, led.count, uptime_secs, arch, ip and mac has nothing in it a
    // person wants, whatever the number.
    expect(newsIn(['wifi.rssi', 'led.count', 'peers.count'])).toEqual([]);
    expect(newsIn(['uptime_secs', 'free_heap', 'arch', 'ip', 'mac'])).toEqual([]);
    // A clock that ticks is not an event either.
    expect(newsIn(['datetime', 'device_time'])).toEqual([]);
  });
});
