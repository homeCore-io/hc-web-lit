/**
 * A rule. Six on the house page and six on the room page — the most common
 * element after text, and the thing that turns a composition into sections.
 *
 * Drawn from its placement rather than from an orientation flag: a placement
 * wider than it is tall is a horizontal rule, and the document never says which
 * it is because the rectangle already did.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-line')
export class HcLine extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .rule {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  override render() {
    const thickness = typeof this.config['thickness'] === 'number' ? this.config['thickness'] : 1;
    const ink = typeof this.config['ink'] === 'string' ? this.config['ink'] : 'hairline';

    // The element fills its placement, and the placement is the line: a 1px-tall
    // box is a horizontal rule without anything having to say so. Filling the
    // box rather than centring a hairline in it also means a thicker rule grows
    // the way the designer dragged it.
    return html`<div
      class="rule"
      part="rule"
      style="background:${roleColor(ink, '--hc-stroke-hairline')};
             min-height:${thickness}px"
    ></div>`;
  }
}

registerWidget('line', 'hc-line');

declare global {
  interface HTMLElementTagNameMap {
    'hc-line': HcLine;
  }
}
