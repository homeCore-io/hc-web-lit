/**
 * A text element. The most common thing on a real page — 18 of 36 widgets on
 * the house dashboard, 14 of 35 on the room one — and it binds to no device.
 *
 * Config is core's, read as it is stored: `text`, `scale` (percent of the base
 * size), `weight`, `ink` (a token name, never a literal colour — §15), `align`,
 * `tracking` (letter-spacing in thousandths of an em, as the designer writes it).
 *
 * **`scale` is a percentage of the page's body size, not of the browser root.**
 * It was `rem`, which made the most-used widget in the product the one thing
 * that could not see the type ramp: an author picked a percentage of whatever
 * the browser happened to be set to, so the same number meant a different size
 * on a different machine and no number landed on the scale. Measured on the
 * household's room page, `hc-text` was the source of every one of the seven
 * off-ramp sizes rendering there — 10.88, 14.08, 11.52, 10.24, 14.4.
 *
 * Against the body **token** rather than against `em`, which was the first
 * attempt and is the classic version of this mistake: `em` is the inherited
 * size, so it compounds through every wrapper that sets one, and the same
 * `scale` came out 8.84px in one placement and 11.44 in another. A calc on the
 * token is the size the ramp says, multiplied once. So `scale: 100` is body,
 * `scale: 160` is a little over subtitle, and a number an author writes means
 * something in the system rather than against the browser.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-text')
export class HcText extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    p {
      margin: 0;
      color: var(--hc-ink, #e9edf2);
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
    const ink = roleColor(this.str('ink', 'foreground'));

    return html`
      <p
        part="text"
        style="font-size:calc(var(--hc-text-body-size, 13px) * ${scale});
               font-weight:${this.str('weight', 'normal')};
               letter-spacing:${tracking}em;
               text-align:${this.str('align', 'left')};
               color:${ink}"
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
