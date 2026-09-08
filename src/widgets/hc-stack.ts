/**
 * `stack` — widgets in a line, with no double borders (§5.5, §7.3).
 *
 * The container P4 exists to make ordinary. In Home Assistant this is three
 * separate community cards — stack-in-card, vertical-stack-in-card and the
 * rest — which exist only to suppress the chrome the platform insists on. Here
 * suppression is the rule and the container is data: a direction, a gap, and
 * children.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { childrenOf, gapOf } from '../core/compose.js';
import { mountChild, type MountEnv } from '../shell/mount.js';
import { registerWidget } from './registry.js';

@customElement('hc-stack')
export class HcStack extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .stack {
      display: flex;
      height: 100%;
      min-width: 0;
    }
    .stack > * {
      min-width: 0;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) env: MountEnv | undefined;

  override render() {
    const env = this.env;
    if (env === undefined) return html``;

    const row = this.config['direction'] === 'row';
    const align = String(this.config['align'] ?? 'stretch');
    const children = childrenOf(this.config).map((c) => mountChild(c, env));

    return html`<div
      class="stack"
      part="set"
      style="flex-direction:${row ? 'row' : 'column'};
             align-items:${align};
             gap:${gapOf(this.config)}px"
    >
      ${children.map((el) => el ?? html`<div part="empty"></div>`)}
    </div>`;
  }
}

registerWidget('stack', 'hc-stack');

declare global {
  interface HTMLElementTagNameMap {
    'hc-stack': HcStack;
  }
}
