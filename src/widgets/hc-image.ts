/**
 * `image` — a picture on the page.
 *
 * Core's fields: `url` (required) and `fit`. The url is whatever the document
 * says, which will be an asset store address once §9 exists; until then it is
 * taken as given rather than rewritten, because a client that "helpfully"
 * mangles a url breaks the one thing the author could verify.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-image')
export class HcImage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: var(--hc-radius-md, 14px);
    }
    .missing {
      display: grid;
      place-items: center;
      height: 100%;
      border-radius: var(--hc-radius-md, 14px);
      border: var(--hc-stroke-width, 1px) dashed var(--hc-stroke-hairline, #262d38);
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  override render() {
    const url = this.config['url'];
    if (typeof url !== 'string' || url === '') {
      // A dashed box rather than a broken-image glyph: the placement is real
      // and its picture is missing, and saying so is better than a browser
      // icon nobody chose.
      return html`<div class="missing" part="empty">No image</div>`;
    }
    const fit = String(this.config['fit'] ?? 'cover');
    return html`<img part="image" src=${url} alt="" style="object-fit:${fit}" />`;
  }
}

registerWidget('image', 'hc-image');

declare global {
  interface HTMLElementTagNameMap {
    'hc-image': HcImage;
  }
}
