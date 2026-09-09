/**
 * What a media player is doing (§7.3).
 *
 * Two plugin families publish three spellings of the same facts and nothing
 * declares which is which, so these pin the spellings the reference house
 * actually produces — and, more importantly, what happens to the ones it does
 * not.
 */
import { describe, expect, it } from 'vitest';
import type { DeviceState } from '../src/core/device.js';
import { clock, isPlayer, nowPlaying, progress, summary } from '../src/core/media.js';

const dev = (
  attributes: Record<string, unknown>,
  over: Partial<DeviceState> = {},
): DeviceState => ({
  device_id: 'p',
  name: 'Player',
  plugin_id: 'x',
  available: true,
  last_seen: '2026-09-09T00:00:00Z',
  attributes,
  ...over,
});

describe('reading what is playing', () => {
  it('takes the Sonos spelling', () => {
    const n = nowPlaying(
      dev({
        media_title: 'Ordinary Man',
        media_artist: 'Ozzy Osbourne',
        media_album: 'Ordinary Man',
        media_position: 261,
        media_duration: 400,
        player_state: 'PLAYING',
        volume: 22,
      }),
    );
    expect(n.title).toBe('Ordinary Man');
    expect(n.artist).toBe('Ozzy Osbourne');
    expect(n.state).toBe('playing');
    expect(n.volume).toBe(22);
  });

  it('takes the Roku spelling, where there is no title at all', () => {
    // A television on its home screen is not playing anything and is not
    // broken; what it is *doing* is being on Home.
    const n = nowPlaying(dev({ app_name: null, source: 'Home', state: 'stopped', on: true }));
    expect(n.title).toBeUndefined();
    expect(n.source).toBe('Home');
    expect(n.state).toBe('stopped');
    expect(summary(n)).toBe('Home');
  });

  it('says off when the device says off', () => {
    expect(nowPlaying(dev({ on: false, state: 'stopped' })).state).toBe('off');
  });

  it('says unknown rather than stopped for a word it does not know', () => {
    // "close" is a real value from a Roku soundbar. Calling it stopped would
    // be inventing a fact about the house.
    expect(nowPlaying(dev({ state: 'close' })).state).toBe('unknown');
  });

  it('ignores an empty string, which is not a title', () => {
    expect(nowPlaying(dev({ media_title: '   ' })).title).toBeUndefined();
  });
});

describe('position', () => {
  it('is a fraction where the device counts', () => {
    expect(progress(nowPlaying(dev({ media_position: 100, media_duration: 400 })))).toBe(0.25);
  });

  it('is nothing for a live stream', () => {
    // A bar that never fills is a bar lying about having an end.
    expect(
      progress(nowPlaying(dev({ media_position: 100, media_duration: 400, media_is_live: true }))),
    ).toBeUndefined();
  });

  it('is nothing when the device does not count', () => {
    expect(progress(nowPlaying(dev({ media_title: 'x' })))).toBeUndefined();
    expect(progress(nowPlaying(dev({ media_position: 5, media_duration: 0 })))).toBeUndefined();
  });

  it('reads as a clock', () => {
    expect(clock(187)).toBe('3:07');
    expect(clock(3731)).toBe('1:02:11');
    expect(clock(0)).toBe('0:00');
  });
});

describe('what counts as a player', () => {
  it('is a device that declares transport', () => {
    // Derived, not matched: if it can be told to play, it plays things.
    expect(
      isPlayer(dev({}, { schema: { actions: [{ id: 'play_pause', label: 'Play/pause' }] } })),
    ).toBe(true);
  });

  it('falls back to the type where a plugin declares no schema', () => {
    expect(isPlayer(dev({}, { device_type: 'media_player' }))).toBe(true);
  });

  it('is not a light, however a set was pointed at one', () => {
    // A `media_player` widget with an empty query selects the whole house,
    // and it drew an attic light and a garage door as players until this
    // existed.
    expect(isPlayer(dev({ on: true }, { device_type: 'light' }))).toBe(false);
    expect(isPlayer(dev({}, { device_type: 'switch' }))).toBe(false);
  });
});
