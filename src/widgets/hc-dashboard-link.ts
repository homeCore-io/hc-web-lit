/**
 * `dashboard_link` — the way to another page.
 *
 * A dashboard with no way off it is a dashboard somebody reaches by using the
 * chrome, and a wall panel in kiosk mode has no chrome (§18.2). So this is not
 * decoration: on a panel it is the navigation.
 *
 * **It goes through the action model** (§5.10). A link is `{do: "page"}` and
 * the host performs it, which is the same dispatch a tap on any other widget
 * uses — so a page change is one thing that happens in one place, and a widget
 * cannot navigate a panel by other means.
 *
 * **A page it cannot name is still offered.** The list of pages arrives from
 * the host and a document may name one that has been renamed or not loaded
 * yet; showing the id is worse than showing a name and much better than
 * showing nothing, because the id is what the author typed.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { HcContext } from '../sdk/context.js';
import { icon, iconFor } from '../design/icons.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

@customElement('hc-dashboard-link')
export class HcDashboardLink extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    .set {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 0.75rem;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 12px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 1.25rem;
      height: 1.25rem;
      flex: none;
    }
    .mark svg {
      width: 1.1rem;
      height: 1.1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .unknown {
      color: var(--hc-ink-muted, #8b95a4);
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) pages: readonly { id: string; name: string; icon?: string }[] =
    [];
  @property({ attribute: false }) ctx: HcContext | undefined;

  override render() {
    const raw = this.config['dashboard_ids'];
    const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
    if (ids.length === 0) {
      return html`<span class="none" part="empty">No pages linked.</span>`;
    }

    return html`<div class="set" part="set">
      ${ids.map((id) => {
        const page = this.pages.find((p) => p.id === id);
        const mark = page?.icon ?? iconFor({ device_type: 'dashboard' });
        return html`<button
          part="action"
          aria-label=${page === undefined ? `Open ${id}` : `Open ${page.name}`}
          @click=${() => this.ctx?.action({ do: 'page', target: id })}
        >
          <span class="mark" part="indicator">${icon(mark)}</span>
          ${
            page === undefined
              ? html`<span class="unknown" part="name">${humanise(id)}</span>`
              : html`<span part="name">${page.name}</span>`
          }
        </button>`;
      })}
    </div>`;
  }
}

registerWidget('dashboard_link', 'hc-dashboard-link');

declare global {
  interface HTMLElementTagNameMap {
    'hc-dashboard-link': HcDashboardLink;
  }
}
