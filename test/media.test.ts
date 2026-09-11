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
import '../src/widgets/hc-media-card.js';
import '../src/widgets/hc-media.js';

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

describe('a media card on a house page (§7.2)', () => {
  const player = (over: Partial<DeviceState> = {}): DeviceState => ({
    device_id: 'roku',
    name: 'Living Room',
    plugin_id: 'roku',
    available: true,
    area: 'living_room',
    device_type: 'media_player',
    attributes: { state: 'playing', media_title: 'Blue Train', volume: 30 },
    last_seen: '2026-09-11T00:00:00Z',
    schema: {
      actions: [
        { id: 'play_pause', label: 'Play' },
        { id: 'next', label: 'Next' },
        { id: 'previous', label: 'Previous' },
        { id: 'volume_up', label: 'Louder' },
      ],
    },
    ...over,
  });

  const card = async (config: Record<string, unknown>) => {
    const el = document.createElement('hc-media-card');
    el.device = player();
    el.config = config;
    document.body.append(el);
    await el.updateComplete;
    return el;
  };

  it('is status and one control when compact', async () => {
    // Seven players each with a transport cluster, a volume row and a progress
    // bar is a page about the stereo.
    const el = await card({ compact: true });
    const root = el.shadowRoot!;
    expect(root.querySelector('.strip')).not.toBeNull();
    expect(root.querySelectorAll('button')).toHaveLength(1);
    expect(root.querySelector('.progress')).toBeNull();
    expect(root.querySelector('.volume')).toBeNull();
    expect(root.querySelector('.wash')).toBeNull();
  });

  it('is a row in a list, not a card of its own', async () => {
    // Seven bordered cards in a column read as seven objects when the point is
    // one list.
    const el = await card({ compact: true });
    expect(el.shadowRoot?.querySelector('.card')).toBeNull();
    expect(el.shadowRoot?.querySelector('button.quiet')).not.toBeNull();
  });

  it('lights its dot only while something is actually playing', async () => {
    // A glyph that is always there says nothing.
    const el = await card({ compact: true });
    expect(el.shadowRoot?.querySelector('.pip')?.hasAttribute('data-on')).toBe(true);

    el.device = player({ attributes: { state: 'paused', media_title: 'Blue Train' } });
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.pip')?.hasAttribute('data-on')).toBe(false);
  });

  it('still says where and what, which is the point of it', async () => {
    const el = await card({ compact: true });
    const text = (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Living Room');
    expect(text).toContain('Blue Train');
  });

  it('keeps the full card when nothing asked for compact', async () => {
    const el = await card({});
    expect(el.shadowRoot?.querySelector('.strip')).toBeNull();
    expect(el.shadowRoot?.querySelector('.card')).not.toBeNull();
    expect((el.shadowRoot?.querySelectorAll('button') ?? []).length).toBeGreaterThan(1);
  });

  it('offers no button for a player that declares no transport', async () => {
    // The curation rule underneath is unchanged: only what the device said.
    const el = document.createElement('hc-media-card');
    el.device = player({ schema: { actions: [] } });
    el.config = { compact: true };
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('what a PLAYING section shows', () => {
  const at = (state: string, title?: string): DeviceState => ({
    device_id: `p-${state}-${title ?? ''}`,
    name: state,
    plugin_id: 'sonos',
    available: true,
    device_type: 'media_player',
    attributes: { player_state: state, ...(title === undefined ? {} : { media_title: title }) },
    last_seen: '2026-09-11T00:00:00Z',
  });

  const shown = async (config: Record<string, unknown>, devices: DeviceState[]) => {
    const el = document.createElement('hc-media');
    el.config = {
      selection_mode: 'manual',
      device_ids: devices.map((d) => d.device_id),
      ...config,
    };
    el.devices = devices;
    document.body.append(el);
    await el.updateComplete;
    return [...(el.shadowRoot?.querySelectorAll('hc-media-card') ?? [])].map((c) => c.device?.name);
  };

  it('shows only what is playing when asked', async () => {
    // A section headed PLAYING that lists a Roku on its home screen and four
    // idle speakers is a list of the house's media devices, which is a
    // different thing.
    const house = [at('playing', 'Blue Train'), at('stopped'), at('off'), at('unknown')];
    expect(await shown({ only_playing: true }, house)).toEqual(['playing']);
  });

  it('does not count paused as playing', async () => {
    // Not a judgement call: a Sonos has play/pause and no stop, so idle and
    // paused-holding-a-track are the same state to it. Counting paused would
    // make every Sonos in the house permanently on.
    const house = [at('paused', 'Crazy Train'), at('paused')];
    expect(await shown({ only_playing: true }, house)).toEqual([]);
  });

  it('shows every player when nothing asked', async () => {
    const house = [at('playing', 'Blue Train'), at('paused'), at('off')];
    expect(await shown({}, house)).toHaveLength(3);
  });
});

describe('a television on an HDMI input', () => {
  const roku = (over: Record<string, unknown>): DeviceState => ({
    device_id: 'tv',
    name: 'Office TV',
    plugin_id: 'roku',
    available: true,
    device_type: 'media_player',
    attributes: over,
    last_seen: '2026-09-11T00:00:00Z',
  });

  it('is playing when its own state says so and it has no media session', () => {
    // **A field that says "nothing" is not an answer.** A Roku on HDMI
    // publishes `player_state: "none"` — no media *session*, because the
    // picture comes from a box plugged into the back — while `state` says
    // playing. Reading `player_state` first and stopping there called a
    // television that was on and showing something "stopped", and the house
    // page left it out of PLAYING entirely.
    const tv = roku({
      on: true,
      power_mode: 'PowerOn',
      state: 'playing',
      player_state: 'none',
      app_name: 'HDMI 1',
    });
    expect(nowPlaying(tv).state).toBe('playing');
  });

  it('still prefers the media session when it has one', () => {
    // A Sonos says `player_state` and means it; the order is unchanged for
    // every device that answers with its first field.
    const sonos = roku({ player_state: 'PAUSED_PLAYBACK', state: 'playing' });
    expect(nowPlaying(sonos).state).toBe('paused');
  });

  it('is off when the set is off, whatever else it says', () => {
    expect(nowPlaying(roku({ on: false, state: 'stopped', source: 'Home' })).state).toBe('off');
  });

  it('is stopped for a device that is on and declines every field', () => {
    // `close` is a player declining to answer, not a player at rest — but a
    // device that is on is doing something, so it is not "unknown" either.
    expect(nowPlaying(roku({ on: true, player_state: 'close', app_name: 'Native UI' })).state).toBe(
      'stopped',
    );
  });

  it('is unknown when nothing says anything at all', () => {
    // A card that says "stopped" about a device it did not understand is
    // inventing a fact.
    expect(nowPlaying(roku({})).state).toBe('unknown');
  });
});
