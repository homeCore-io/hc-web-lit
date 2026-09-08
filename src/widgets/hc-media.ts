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
import { registerWidget } from './registry.js';

/** Transport, in the order a person expects it, with a label for each. */
const TRANSPORT: { id: string; label: string }[] = [
  { id: 'previous', label: '⏮' },
  { id: 'play_pause', label: '⏯' },
  { id: 'play', label: '▶' },
  { id: 'pause', label: '⏸' },
  { id: 'stop', label: '⏹' },
  { id: 'next', label: '⏭' },
];

const VOLUME: { id: string; label: string }[] = [
  { id: 'volume_down', label: '−' },
  { id: 'mute', label: '🔇' },
  { id: 'volume_up', label: '+' },
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
      gap: 0.5rem;
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-radius-md, 14px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .now {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    button {
      min-width: var(--hc-density-min-tap, 44px);
      min-height: var(--hc-density-min-tap, 44px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: inherit;
      font: inherit;
      cursor: pointer;
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
    const offer = (list: typeof TRANSPORT) => list.filter((b) => declared.has(b.id));

    return html`<div class="player" part="player">
      <div class="name" part="name">${effectiveName(d)}</div>
      <div class="now" part="now">${this.nowPlaying(d)}</div>
      ${this.buttons(d, offer(TRANSPORT))} ${this.buttons(d, offer(VOLUME))}
    </div>`;
  }

  private buttons(d: DeviceState, list: { id: string; label: string }[]) {
    if (list.length === 0) return nothing;
    return html`<div class="buttons">
      ${list.map(
        (b) =>
          html`<button
            part="action"
            title=${b.id.replace(/_/g, ' ')}
            @click=${() =>
            this.onCommand?.({ deviceId: d.device_id, action: { id: b.id, params: {} } })}
          >
            ${b.label}
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

declare global {
  interface HTMLElementTagNameMap {
    'hc-media': HcMedia;
  }
}
