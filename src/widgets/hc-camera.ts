/**
 * `camera_video` — a picture of somewhere (§7.3).
 *
 * Core declares four `source_type`s and this client can draw two of them
 * honestly. A browser plays an MJPEG stream and a refreshing still with no
 * help at all; HLS and WebRTC each need a library and a negotiation, and
 * neither is bundled here.
 *
 * **So it says which two.** A camera tile that renders a broken image icon is
 * indistinguishable from a camera that is down, and somebody will go and check
 * the camera. Naming the source type this client cannot play is the difference
 * between a missing feature and a fault report.
 *
 * **A still is fetched again, not merely re-shown.** `refresh_secs` means a
 * new picture, so the URL carries a changing parameter — without it the
 * browser serves the one it already has and the tile looks live while showing
 * a picture from an hour ago, which is the worst thing a camera can do.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { registerWidget } from '../core/registry.js';

/** What a browser plays without help, and what it does not. */
const PLAYABLE = new Set(['image_refresh', 'mjpeg']);

@customElement('hc-camera')
export class HcCamera extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    .frame {
      position: relative;
      display: grid;
      place-items: center;
      height: 100%;
      min-height: 3rem;
      overflow: hidden;
      border-radius: var(--hc-radius-md, 12px);
      background: var(--hc-surface-sunken, #0d1116);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .note {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      padding: 0.5rem;
      text-align: center;
    }
    .warn {
      color: var(--hc-accent-warn, #ffc978);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  /** Bumped on each refresh; it is what makes the URL a new one. */
  @state() private tick = 0;

  private timer: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.schedule();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop();
  }

  override updated(changed: Map<string, unknown>): void {
    // A property panel changing `refresh_secs` should change the rate, not
    // require a reload.
    if (changed.has('config')) this.schedule();
  }

  private stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    this.stop();
    if (this.config['source_type'] !== 'image_refresh') return;
    const secs = this.config['refresh_secs'];
    const every = typeof secs === 'number' && secs >= 1 ? secs : 10;
    this.timer = setInterval(() => {
      this.tick += 1;
    }, every * 1000);
  }

  /** The URL to ask for, with a cache-buster on a still. */
  private src(url: string, kind: string): string | undefined {
    // Only somewhere a browser will fetch a picture from. A `javascript:` in
    // an `src` is the same mistake as one in a link.
    if (!/^(https?:)?\/\//i.test(url) && !url.startsWith('/')) return undefined;
    if (kind !== 'image_refresh') return url;
    return `${url}${url.includes('?') ? '&' : '?'}hc=${this.tick}`;
  }

  override render() {
    const url = typeof this.config['url'] === 'string' ? this.config['url'] : '';
    const kind = typeof this.config['source_type'] === 'string' ? this.config['source_type'] : '';

    if (url === '') {
      return html`<div class="frame" part="empty"><span class="note">No camera set.</span></div>`;
    }

    if (!PLAYABLE.has(kind)) {
      return html`<div class="frame" part="empty">
        <span class="note warn" part="note">
          ${kind === '' ? 'No source type set' : `This client cannot play ${kind} yet`} — the camera
          is fine, the player is missing.
        </span>
      </div>`;
    }

    const src = this.src(url, kind);
    if (src === undefined) {
      return html`<div class="frame" part="empty">
        <span class="note warn" part="note">That is not an address a picture can come from.</span>
      </div>`;
    }

    return html`<div class="frame" part="card">
      <img
        part="image"
        src=${src}
        alt=${typeof this.config['label'] === 'string' ? this.config['label'] : 'Camera'}
      />
    </div>`;
  }
}

registerWidget('camera_video', 'hc-camera');

declare global {
  interface HTMLElementTagNameMap {
    'hc-camera': HcCamera;
  }
}
