/**
 * `divider` — a rule between things.
 *
 * Core's own type, beside the `line` this client already draws: `line` carries
 * a length, an angle and a colour and is a *drawn* element on a composed page,
 * where a divider is structural and takes the width it is given.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-divider')
export class HcDivider extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      height: 100%;
    }
    hr {
      width: 100%;
      margin: 0;
      border: 0;
      border-top: var(--hc-stroke-width, 1px) solid currentColor;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  override render() {
    const ink = typeof this.config['ink'] === 'string' ? this.config['ink'] : 'hairline';
    return html`<hr part="rule" style="color:${roleColor(ink, '--hc-stroke-hairline')}" />`;
  }
}

registerWidget('divider', 'hc-divider');

declare global {
  interface HTMLElementTagNameMap {
    'hc-divider': HcDivider;
  }
}
