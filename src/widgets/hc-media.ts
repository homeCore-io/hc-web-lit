/**
 * A media player.
 *
 * **The widget curates; the primitive offers.** A Roku declares 34 actions and
 * four writable attributes — 27 controls on a card is not a card (§7.2). So
 * this shows transport and volume, which is what somebody standing in the room
 * reaches for, and leaves `install_app`, `find_remote` and the thirty others to
 * a full control sheet. That is the division P10 exists to make possible: the
 * schema says everything the device can do, and a type-specific widget picks.
 *
 * It only offers a control the device actually declared, so a Sonos speaker
 * that has no `channel_up` shows no channel button, and nothing here knows what
 * either device is.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName } from '../core/present.js';
import { selectDevices, type SelectionContext } from '../core/selection.js';
import type { CommandRequest } from './hc-controls.js';
import { icon, iconFor } from '../design/icons.js';
import { registerForDevice, registerWidget } from './registry.js';
import { humanise } from '../core/text.js';

/**
 * Transport, in the order a person expects it, with the mark for each.
 *
 * `primary` is the one a person reaches for without looking — it gets the
 * accent and the larger target, and the rest sit quietly beside it. Which
 * buttons actually appear is still the device's decision: a Sonos with no
 * `channel_up` shows no channel button, and nothing here knows what a Sonos is.
 */
const TRANSPORT: { id: string; mark: string; primary?: boolean }[] = [
  { id: 'previous', mark: 'prev' },
  { id: 'play_pause', mark: 'play_pause', primary: true },
  { id: 'play', mark: 'play', primary: true },
  { id: 'pause', mark: 'pause' },
  { id: 'stop', mark: 'stop' },
  { id: 'next', mark: 'next' },
];

const VOLUME: { id: string; mark: string }[] = [
  { id: 'volume_down', mark: 'volume_down' },
  { id: 'mute', mark: 'mute' },
  { id: 'volume_up', mark: 'volume_up' },
];

@customElement('hc-media')
export class HcMedia extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .players {
      display: grid;
      gap: calc(var(--hc-space-unit, 8px));
    }
    .player {
      display: grid;
      gap: 0.75rem;
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-radius-md, 14px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink-muted, #8b95a4);
    }
    /* Playing is the one state a media player has that is worth a colour. */
    .player[data-playing] .tile {
      background: color-mix(in srgb, var(--hc-accent-active, #ffb661) 20%, transparent);
      color: var(--hc-accent-active, #ffb661);
    }
    svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* A filled triangle reads as play; an outlined one reads as a cursor. */
    .fill svg {
      fill: currentColor;
      stroke-width: 1.2;
    }
    .lines {
      min-width: 0;
      display: grid;
      gap: 0.125rem;
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .now {
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      justify-content: space-between;
    }
    .buttons {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    button {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
      transition:
        background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out),
        border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    button:hover {
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 45%, transparent);
    }
    /* The one a person reaches for without looking. */
    button[data-primary] {
      width: 2.75rem;
      height: 2.75rem;
      background: color-mix(in srgb, var(--hc-accent-active, #ffb661) 16%, transparent);
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 40%, transparent);
      color: var(--hc-accent-active, #ffb661);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: SelectionContext = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  override render() {
    const players = selectDevices(this.config, this.devices, this.context);
    if (players.length === 0)
      return html`<div class="empty" part="empty">Nothing playing here.</div>`;

    return html`<div class="players" part="players">${players.map((p) => this.player(p))}</div>`;
  }

  private player(d: DeviceState) {
    const declared = new Set((d.schema?.actions ?? []).map((a) => a.id));
    const offer = <T extends { id: string }>(list: readonly T[]): T[] =>
      list.filter((b) => declared.has(b.id));
    // A Roku declares `play_pause` *and* `play`, and two accented buttons is
    // two answers to "which one do I press". Only the first primary the device
    // actually offers keeps the accent; the other stays an ordinary button,
    // because it is still a thing the device can do.
    let claimed = false;
    const transport = offer(TRANSPORT).map((b) => {
      if (b.primary !== true || claimed) return { ...b, primary: false };
      claimed = true;
      return b;
    });
    const volume = offer(VOLUME);

    return html`<div class="player" part="player" ?data-playing=${isPlaying(d)}>
      <div class="head">
        <span class="tile ${isPlaying(d) ? 'fill' : ''}" part="indicator">
          ${icon(isPlaying(d) ? 'play' : iconFor(d))}
        </span>
        <div class="lines">
          <div class="name" part="name">${effectiveName(d)}</div>
          <div class="now" part="now">${this.nowPlaying(d)}</div>
        </div>
      </div>
      ${
        transport.length === 0 && volume.length === 0
          ? nothing
          : html`<div class="controls">
              ${this.buttons(d, transport)}${this.buttons(d, volume)}
            </div>`
      }
    </div>`;
  }

  private buttons(d: DeviceState, list: { id: string; mark: string; primary?: boolean }[]) {
    if (list.length === 0) return nothing;
    return html`<div class="buttons">
      ${list.map(
        (b) =>
          html`<button
            part="action"
            class=${b.mark === 'play' || b.mark === 'play_pause' ? 'fill' : ''}
            title=${humanise(b.id)}
            aria-label=${humanise(b.id)}
            ?data-primary=${b.primary === true}
            @click=${() =>
              this.onCommand?.({ deviceId: d.device_id, action: { id: b.id, params: {} } })}
          >
            ${icon(b.mark)}
          </button>`,
      )}
    </div>`;
  }

  /**
   * What it is doing, in the device's own words where it has them.
   *
   * A Roku reports `app_name` and `source`; a Sonos reports a title and artist.
   * Neither is declared as *the* thing to show (homeCore#29), so this takes the
   * most specific it finds and falls back to the transport state.
   */
  private nowPlaying(d: DeviceState): string {
    const a = d.attributes;
    const str = (k: string): string | undefined => (typeof a[k] === 'string' ? a[k] : undefined);

    const title = str('title') ?? str('media_title');
    const artist = str('artist') ?? str('media_artist');
    if (title !== undefined) return artist === undefined ? title : `${title} — ${artist}`;

    return str('app_name') ?? str('source') ?? str('state') ?? '';
  }
}

registerWidget('media_player', 'hc-media');

// A set of devices that happen to be media players gets this rather than a
// generic card with 27 generated controls on it (§7.2).
registerForDevice('media_player', 'hc-media-card');

declare global {
  interface HTMLElementTagNameMap {
    'hc-media': HcMedia;
  }
}

/**
 * Whether it is playing, from whatever word the plugin uses.
 *
 * A Roku says `state: "play"`, a Sonos `"playing"`. Neither declares which
 * value means what (homeCore#29), so this reads the two spellings the house
 * actually produces and treats anything else as not playing — which shows a
 * quiet card rather than a wrong one.
 */
function isPlaying(d: DeviceState): boolean {
  const s = d.attributes['state'];
  return typeof s === 'string' && /^play/i.test(s);
}
