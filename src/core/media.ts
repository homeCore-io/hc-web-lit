/**
 * What a media player is doing, from whatever its plugin calls it.
 *
 * **Two plugin families, two vocabularies, and nothing declaring which is
 * which.** Sonos publishes `media_title`, `media_artist`, `media_album`,
 * `media_duration`, `media_position` and `player_state`; Roku publishes
 * `app_name`, `source`, `state` and `power_mode`; and a few devices publish
 * the unprefixed `title`, `artist`, `album`, `duration_secs`, `position_secs`.
 * `DeviceSchema.primary` ranks *readings* and says nothing about which of
 * three spellings of "what is playing" a device uses, so this reads the
 * spellings the house actually produces and treats the rest as absent.
 *
 * That is a client convention, and it is deliberately in one place: three
 * widgets guessing at `media_title` separately is how they end up disagreeing
 * about whether a television is idle.
 */
import type { DeviceState } from './device.js';

/** What a player is doing, in the words a card needs. */
export interface NowPlaying {
  title?: string;
  artist?: string;
  album?: string;
  /** The app or input, for a device showing something rather than playing it. */
  source?: string;
  /** Seconds in, and seconds long, when the device counts. */
  position?: number;
  duration?: number;
  /** A live stream has a position and no end worth drawing. */
  live: boolean;
  state: 'playing' | 'paused' | 'stopped' | 'off' | 'unknown';
  volume?: number;
  muted: boolean;
}

const str = (d: DeviceState, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = d.attributes[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
};

const num = (d: DeviceState, ...keys: string[]): number | undefined => {
  for (const k of keys) {
    const v = d.attributes[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
};

/**
 * The transport state, which is the one thing every family spells differently.
 *
 * A Roku says `state: "stopped"` and carries `on: false` when the set is off;
 * a Sonos says `player_state: "PLAYING"`. Anything unrecognised is `unknown`
 * rather than `stopped`, because a card that says "stopped" about a device it
 * did not understand is inventing a fact.
 */
function transport(d: DeviceState): NowPlaying['state'] {
  if (d.attributes['on'] === false) return 'off';
  const raw = str(d, 'player_state', 'state');
  if (raw === undefined) return 'unknown';
  const s = raw.toLowerCase();
  if (s.startsWith('play')) return 'playing';
  if (s.startsWith('paus')) return 'paused';
  if (s.startsWith('stop') || s === 'idle' || s === 'none') return 'stopped';
  return 'unknown';
}

export function nowPlaying(d: DeviceState): NowPlaying {
  const title = str(d, 'media_title', 'title');
  const artist = str(d, 'media_artist', 'artist');
  const album = str(d, 'media_album', 'album');
  // `app_name` is what a Roku is *showing*; `source` is the input it is on.
  // Either is the answer to "what is this doing" when nothing is playing.
  const source = str(d, 'app_name', 'source');

  return {
    ...(title !== undefined ? { title } : {}),
    ...(artist !== undefined ? { artist } : {}),
    ...(album !== undefined ? { album } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(num(d, 'media_position', 'position_secs') !== undefined
      ? { position: num(d, 'media_position', 'position_secs')! }
      : {}),
    ...(num(d, 'media_duration', 'duration_secs') !== undefined
      ? { duration: num(d, 'media_duration', 'duration_secs')! }
      : {}),
    live: d.attributes['media_is_live'] === true,
    state: transport(d),
    ...(num(d, 'volume') !== undefined ? { volume: num(d, 'volume')! } : {}),
    muted: d.attributes['muted'] === true,
  };
}

/** `3:07`, and `1:02:11` where an hour is worth the space. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(rest)}` : `${m}:${pad(rest)}`;
}

/** How far through, 0–1, where the device counts and the track ends. */
export function progress(n: NowPlaying): number | undefined {
  if (n.live || n.position === undefined || n.duration === undefined || n.duration <= 0) {
    return undefined;
  }
  return Math.min(1, Math.max(0, n.position / n.duration));
}

/** One line for what it is doing, when there is no title to lead with. */
export function summary(n: NowPlaying): string {
  if (n.title !== undefined) return [n.artist, n.album].filter(Boolean).join(' · ');
  if (n.state === 'off') return 'Off';
  if (n.source !== undefined) return n.source;
  return n.state === 'unknown' ? '' : n.state === 'playing' ? 'Playing' : 'Nothing playing';
}

/**
 * Whether a device is a media player.
 *
 * **Derived, not matched.** A player is a device that declares transport — if
 * it can be told to play or pause, it plays things. `device_type` is the
 * fallback for a device whose plugin publishes no schema, and `ui_hint` wins
 * over both because refining the type is what that field is for.
 *
 * This exists because a set can be pointed at anything: `media_player` with an
 * empty query selects the whole house, and the widget drew an attic light and
 * a garage door as players. A widget that curates is the answer §7.2 gives —
 * the schema offers everything a device can do, and a type-specific widget
 * picks — and it has to apply to *which* devices as much as to which controls.
 */
const TRANSPORT_ACTIONS = ['play', 'pause', 'play_pause', 'stop', 'next', 'previous'];

export function isPlayer(d: DeviceState): boolean {
  const hint = d.ui_hint ?? d.device_type;
  if (hint === 'media_player' || hint === 'tv' || hint === 'speaker') return true;

  const declared = new Set((d.schema?.actions ?? []).map((a) => a.id));
  return TRANSPORT_ACTIONS.some((a) => declared.has(a));
}
