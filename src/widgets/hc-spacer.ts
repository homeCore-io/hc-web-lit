/**
 * `spacer` — deliberate emptiness.
 *
 * It draws nothing, and that is the point: on a composed page a gap is a
 * placement like any other, so it survives an edit and a re-import instead of
 * being a margin somebody has to remember. Rendering it as a real element also
 * means a designer can select it.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { registerWidget } from './registry.js';

@customElement('hc-spacer')
export class HcSpacer extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
  `;

  override render() {
    return html`<div part="spacer" aria-hidden="true"></div>`;
  }
}

registerWidget('spacer', 'hc-spacer');

declare global {
  interface HTMLElementTagNameMap {
    'hc-spacer': HcSpacer;
  }
}
