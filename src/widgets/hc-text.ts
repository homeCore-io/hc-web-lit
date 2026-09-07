/**
 * A text element. The most common thing on a real page — 18 of 36 widgets on
 * the house dashboard, 14 of 35 on the room one — and it binds to no device.
 *
 * Config is core's, read as it is stored: `text`, `scale` (percent of the base
 * size), `weight`, `ink` (a token name, never a literal colour — §15), `align`,
 * `tracking` (letter-spacing in thousandths of an em, as the designer writes it).
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { registerWidget } from './registry.js';

@customElement('hc-text')
export class HcText extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    p {
      margin: 0;
      color: var(--hc-ink, #f5efe8);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  private num(key: string, fallback: number): number {
    const v = this.config[key];
    return typeof v === 'number' ? v : fallback;
  }

  private str(key: string, fallback: string): string {
    const v = this.config[key];
    return typeof v === 'string' ? v : fallback;
  }

  override render() {
    const scale = this.num('scale', 100) / 100;
    const tracking = this.num('tracking', 0) / 1000;
    const ink = this.str('ink', 'foreground');

    return html`
      <p
        style="font-size:${scale}rem;
               font-weight:${this.str('weight', 'normal')};
               letter-spacing:${tracking}em;
               text-align:${this.str('align', 'left')};
               color:var(--hc-ink-${ink}, var(--hc-ink, #f5efe8))"
      >
        ${this.str('text', '')}
      </p>
    `;
  }
}

registerWidget('text', 'hc-text');

declare global {
  interface HTMLElementTagNameMap {
    'hc-text': HcText;
  }
}
