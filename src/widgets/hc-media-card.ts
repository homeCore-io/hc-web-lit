/**
 * One media player, with its art — `media_tile`.
 *
 * The single-thing widget that `media_player` composes, the same way
 * `scene_row` composes `scene_button` and `device_grid` composes the card.
 *
 * **Not on `HcLayoutShell`, and that is the point of having a shell.** Its
 * structure is a 2.25rem mark beside two lines; a media player leads with
 * album art, which is the largest thing on the card rather than an indicator
 * beside it. Forcing this through the shell would mean widening the shell
 * until it described nothing in particular. A shell that fits three widgets
 * and admits a fourth is honest; one that fits everything is a `<div>`.
 *
 * **The art comes from the host** (§19.4). Core proxies it at
 * `/devices/{id}/media/art` deliberately — so a browser renders it without
 * reaching the device and without the device's URL leaking into a page — and
 * that needs the bearer, which a widget never holds.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { clock, nowPlaying, progress, summary, type NowPlaying } from '../core/media.js';
import { effectiveName } from '../core/present.js';
import { registerWidget } from '../core/registry.js';
import { icon } from '../design/icons.js';
import { humanise } from '../core/text.js';

/** Transport, in the order a person expects it, with the mark for each. */
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

@customElement('hc-media-card')
export class HcMediaCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .card {
      position: relative;
      display: grid;
      gap: 0.75rem;
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-radius-md, 14px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      overflow: hidden;
    }
    /* The art again, blurred and dimmed, so the card takes the colour of what
       is playing. It is decoration over the real thing, which is why it sits
       behind the surface rather than replacing it. */
    .wash {
      position: absolute;
      inset: -20%;
      background-size: cover;
      background-position: center;
      filter: blur(28px) saturate(1.4);
      opacity: 0.28;
      pointer-events: none;
    }
    .head {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.875rem;
      min-width: 0;
    }
    .art {
      flex: none;
      display: grid;
      place-items: center;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: var(--hc-radius-sm, 8px);
      overflow: hidden;
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink-muted, #8b95a4);
      box-shadow: var(--hc-elevation-card, 0 6px 18px rgb(0 0 0 / 0.35));
    }
    .art img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .art svg {
      width: 1.5rem;
      height: 1.5rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .lines {
      min-width: 0;
      display: grid;
      gap: 0.15rem;
      flex: 1 1 auto;
    }
    .title {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub,
    .where {
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .where {
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    /* Position, where the device counts. A live stream gets none: a bar that
       never fills is a bar that is lying about having an end. */
    .progress {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
    }
    .track {
      height: 4px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-accent-active, #ffb661);
    }
    .controls {
      position: relative;
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
    button svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .fill-mark svg {
      fill: currentColor;
      stroke-width: 1.2;
    }
    .volume {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  @property({ attribute: false }) onArt:
    ((deviceId: string) => Promise<string | undefined>) | undefined;

  @state() private art: string | undefined;

  /** What art was last fetched for, so a re-render does not re-fetch. */
  private fetched = '';

  override willUpdate(): void {
    void this.loadArt();
  }

  override disconnectedCallback(): void {
    // An object URL is a reference the browser keeps until it is told
    // otherwise; a wall display cycling players for a month would hold every
    // cover it ever showed.
    if (this.art !== undefined) URL.revokeObjectURL(this.art);
    super.disconnectedCallback();
  }

  /**
   * Fetch the art, keyed on what is playing rather than on the device.
   *
   * A television on its home screen has none, and the next track has
   * different art with the same device id — so the key is the title, which is
   * what actually changes.
   */
  private async loadArt(): Promise<void> {
    const d = this.device;
    if (d === undefined || this.onArt === undefined) return;
    const n = nowPlaying(d);
    const want = `${d.device_id}/${n.title ?? n.source ?? ''}/${n.state}`;
    if (want === this.fetched) return;
    this.fetched = want;

    const got = await this.onArt(d.device_id);
    if (this.art !== undefined && this.art !== got) URL.revokeObjectURL(this.art);
    this.art = got;
  }

  override render() {
    const d = this.device;
    if (d === undefined) return nothing;

    const n = nowPlaying(d);
    const declared = new Set((d.schema?.actions ?? []).map((a) => a.id));
    const offer = <T extends { id: string }>(list: readonly T[]): T[] =>
      list.filter((b) => declared.has(b.id));

    // A Roku declares `play_pause` *and* `play`, and two accented buttons is
    // two answers to "which one do I press".
    let claimed = false;
    const transport = offer(TRANSPORT).map((b) => {
      if (b.primary !== true || claimed) return { ...b, primary: false };
      claimed = true;
      return b;
    });

    return html`<div class="card" part="player">
      ${this.art === undefined ? nothing : html`<div class="wash" style="background-image:url(${this.art})"></div>`}
      <div class="head" part="head">
        <span class="art" part="indicator">
          ${
            this.art === undefined
              ? icon(n.state === 'playing' ? 'play' : 'media')
              : html`<img src=${this.art} alt="" />`
          }
        </span>
        <span class="lines">
          <span class="where" part="state">${effectiveName(d)}</span>
          <span class="title" part="name">${n.title ?? n.source ?? summary(n)}</span>
          <span class="sub">${n.title === undefined ? nothing : summary(n)}</span>
        </span>
      </div>
      ${this.renderProgress(n)}
      ${
        transport.length === 0 && offer(VOLUME).length === 0
          ? nothing
          : html`<div class="controls">
              ${this.buttons(d, transport)}
              <span class="buttons">
                ${this.buttons(d, offer(VOLUME))}
                ${n.volume === undefined ? nothing : html`<span class="volume">${Math.round(n.volume)}</span>`}
              </span>
            </div>`
      }
    </div>`;
  }

  private renderProgress(n: NowPlaying) {
    const done = progress(n);
    if (done === undefined) {
      // A live stream says so instead of drawing a bar that never fills.
      return n.live ? html`<div class="progress" part="note"><span>Live</span></div>` : nothing;
    }
    return html`<div class="progress" part="note">
      <span>${clock(n.position ?? 0)}</span>
      <span class="track"><span class="fill" style="width:${done * 100}%"></span></span>
      <span>${clock(n.duration ?? 0)}</span>
    </div>`;
  }

  private buttons(d: DeviceState, list: { id: string; mark: string; primary?: boolean }[]) {
    if (list.length === 0) return nothing;
    return html`<div class="buttons">
      ${list.map(
        (b) =>
          html`<button
            part="action"
            class=${b.mark === 'play' || b.mark === 'play_pause' ? 'fill-mark' : ''}
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
}

registerWidget('media_tile', 'hc-media-card');

declare global {
  interface HTMLElementTagNameMap {
    'hc-media-card': HcMediaCard;
  }
}
