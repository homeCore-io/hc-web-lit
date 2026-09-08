/**
 * A rectangle. Five of the thirty-six elements on the real house page, and it
 * binds to no device.
 *
 * Pure decoration, and load-bearing for the same reason a rule is: these are
 * what group a composed page into regions. They sit at negative `z` under
 * everything else, which is why the page reads as panels rather than as a
 * scatter of cards.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from './registry.js';

/** Core's corner names are token sizes, not pixel values. */
const CORNER: Record<string, string> = {
  xs: 'var(--hc-radius-xs, 4px)',
  sm: 'var(--hc-radius-sm, 8px)',
  md: 'var(--hc-radius-md, 14px)',
  lg: 'var(--hc-radius-lg, 22px)',
  pill: 'var(--hc-radius-pill, 999px)',
};

@customElement('hc-shape')
export class HcShape extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .shape {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  private str(key: string): string | undefined {
    const v = this.config[key];
    return typeof v === 'string' ? v : undefined;
  }

  private num(key: string, fallback: number): number {
    const v = this.config[key];
    return typeof v === 'number' ? v : fallback;
  }

  override render() {
    const fill = roleColor(this.str('fill'), '--hc-surface-raised');
    const fillTo = this.str('fill_to');
    const stroke = this.str('stroke');
    const strokeWidth = this.num('stroke_width', 0);
    const corner = CORNER[this.str('corner') ?? ''] ?? '0';

    // A second colour makes it a gradient. `fill_angle` is degrees, and 0 means
    // top-to-bottom, which is what `to bottom` is in CSS.
    const background =
      fillTo === undefined
        ? fill
        : `linear-gradient(${this.num('fill_angle', 0)}deg, ${fill}, ${roleColor(fillTo)})`;

    return html`<div
      class="shape"
      part="shape"
      style="background:${background};
             border-radius:${corner};
             opacity:${this.num('opacity', 100) / 100};
             ${
               strokeWidth > 0 && stroke !== undefined
                 ? `border:${strokeWidth}px solid ${roleColor(stroke)}`
                 : ''
             }"
    ></div>`;
  }
}

registerWidget('shape', 'hc-shape');

declare global {
  interface HTMLElementTagNameMap {
    'hc-shape': HcShape;
  }
}
