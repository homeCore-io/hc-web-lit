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
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { selectDevices, type SelectionContext } from '../core/selection.js';
import { isPlayer, nowPlaying } from '../core/media.js';
import type { CommandRequest } from '../core/widget.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import './hc-media-card.js';

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
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: SelectionContext = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  @property({ attribute: false }) onArt:
    ((deviceId: string) => Promise<string | undefined>) | undefined;

  override render() {
    // Curated, not just selected. A `media_player` widget with an empty query
    // selects the whole house — the same emptiness that makes a device grid
    // show everything — and a set that drew an attic light as a player would
    // be right about the selection and wrong about the widget (§7.2).
    let players = selectDevices(this.config, this.devices, this.context).filter(isPlayer);

    // **Playing means playing.** A section headed PLAYING that lists a Roku on
    // its home screen and four idle speakers is a list of the house's media
    // devices, which is a different thing and one nobody asked to see there.
    //
    // Paused is not playing either, and that is not a judgement call: a Sonos
    // has play/pause and no stop, so *idle* and *paused holding a track* are
    // the same state to it. Counting paused as playing would make every Sonos
    // in the house permanently "on".
    if (this.config['only_playing'] === true) {
      players = players.filter((d) => nowPlaying(d).state === 'playing');
    }

    if (players.length === 0)
      return html`<div class="empty" part="empty">Nothing playing here.</div>`;

    return html`<div class="players" part="players">
      ${players.map(
        (p) =>
          html`<hc-media-card
            .device=${p}
            .config=${this.config}
            .onCommand=${this.onCommand}
            .onArt=${this.onArt}
          ></hc-media-card>`,
      )}
    </div>`;
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
