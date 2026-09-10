/**
 * `stat_summary` — how many, in a row.
 *
 * The widget core seeds a new install with, so it is the first thing anybody
 * sees on a dashboard they did not author. Its `metrics` are house tallies,
 * and the counting is `bindings.ts`'s `houseTally` — the same function the
 * `count` placeholder resolves through, because two answers to "how many
 * lights are on" is one too many and this client has already shipped a header
 * that disagreed with the room below it.
 *
 * **An unrecognised metric is named rather than dropped.** A document from a
 * newer core can carry a tally this build has not learned; showing the name
 * with no number says which one, where a silently missing column says only
 * that something is wrong.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { houseTally } from '../core/bindings.js';
import type { DeviceState } from '../core/device.js';
import { number as formatNumber } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

@customElement('hc-stat-summary')
export class HcStatSummary extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
      height: 100%;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-around;
      flex-wrap: wrap;
      gap: 0.75rem 1.25rem;
      height: 100%;
      min-width: 0;
    }
    .stat {
      display: grid;
      justify-items: center;
      gap: 0.125rem;
      min-width: 0;
    }
    .value {
      font-size: var(--hc-text-display-size, 30px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      color: var(--hc-ink, #e9edf2);
    }
    .unknown .value {
      color: var(--hc-ink-muted, #8b95a4);
    }
    .name {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];

  override render() {
    const raw = this.config['metrics'];
    const metrics = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
    if (metrics.length === 0) {
      return html`<div class="row" part="empty"><span class="none">Nothing to count.</span></div>`;
    }

    return html`<div class="row" part="set">
      ${metrics.map((m) => {
        const value = houseTally(m, this.devices);
        return html`<div class="stat ${value === undefined ? 'unknown' : ''}" part="row">
          <span class="value" part="reading"
            >${value === undefined ? '—' : formatNumber(value)}</span
          >
          <span class="name" part="name">${humanise(m)}</span>
        </div>`;
      })}
    </div>`;
  }
}

registerWidget('stat_summary', 'hc-stat-summary');

declare global {
  interface HTMLElementTagNameMap {
    'hc-stat-summary': HcStatSummary;
  }
}
