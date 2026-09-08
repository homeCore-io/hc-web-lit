/**
 * A device as a pill — name and on-ness, one line, in a 44px row.
 *
 * `layout: "pills"` on a `device_grid`, which is what the room page's lights
 * row asks for and what its 44px placement requires. A card is 64px of padding
 * and two lines; drawing one there shows the top half of a name and reads as
 * broken. The document said how to draw it.
 *
 * Tapping is a `picks: true` concern — the row aims the colour wheel and
 * sliders beside it at whichever light you touched — so the pill reports the
 * pick rather than commanding anything.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { hasPowerState } from '../core/facet.js';
import { effectiveName, isOn, levelOf } from '../core/present.js';
import { inspect } from './hold.js';

@customElement('hc-device-pill')
export class HcDevicePill extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      min-width: 0;
    }
    button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
      height: 100%;
      min-height: 0;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    button[data-picked] {
      border-color: var(--hc-accent-active, #ffb661);
    }
    .dot {
      flex: none;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--hc-accent-inactive, #2a313b);
    }
    .dot[data-on] {
      background: var(--hc-accent-active, #ffb661);
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .level {
      margin-left: auto;
      flex: none;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ type: Boolean }) picked = false;
  @property({ attribute: false }) onPick: ((deviceId: string) => void) | undefined;
  /** Hold to inspect, without acting on it (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  override render() {
    const d = this.device;
    if (d === undefined) return html``;

    const on = isOn(d);
    const level = on === true ? levelOf(d) : undefined;

    return html`<button
      ${inspect(() => this.onDetails?.(d.device_id))}
      part="pill"
      ?data-picked=${this.picked}
      @click=${() => this.onPick?.(d.device_id)}
    >
      ${hasPowerState(d) ? html`<span class="dot" ?data-on=${on === true}></span>` : ''}
      <span class="name">${effectiveName(d)}</span>
      ${level !== undefined ? html`<span class="level">${Math.round(level)}%</span>` : ''}
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-pill': HcDevicePill;
  }
}
