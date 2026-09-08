/**
 * `grid` — widgets in columns (§5.5, §7.3).
 *
 * The same container as `stack` with a second axis. Declarative for the reason
 * §5.5 gives: a container whose behaviour is data is expressible as a portable
 * render tree, so a client that cannot run this code can still draw the
 * arrangement. A coded container is web-only by construction.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { childrenOf, gapOf } from '../core/compose.js';
import { mountChild, type MountEnv } from '../shell/mount.js';
import { registerWidget } from './registry.js';

@customElement('hc-grid')
export class HcGrid extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .grid {
      display: grid;
      min-width: 0;
    }
    .grid > * {
      min-width: 0;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) env: MountEnv | undefined;

  override render() {
    const env = this.env;
    if (env === undefined) return html``;

    const columns = this.config['columns'];
    // A number is that many equal columns; anything else fits as many as the
    // width allows, which is what a container on an unknown screen wants.
    const template =
      typeof columns === 'number' && columns > 0
        ? `repeat(${columns}, minmax(0, 1fr))`
        : 'repeat(auto-fill, minmax(11rem, 1fr))';

    return html`<div
      class="grid"
      part="set"
      style="grid-template-columns:${template};gap:${gapOf(this.config)}px"
    >
      ${childrenOf(this.config).map((c) => mountChild(c, env) ?? html`<div part="empty"></div>`)}
    </div>`;
  }
}

registerWidget('grid', 'hc-grid');

declare global {
  interface HTMLElementTagNameMap {
    'hc-grid': HcGrid;
  }
}
