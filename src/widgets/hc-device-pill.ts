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
import { effectiveName, isOn, levelOf } from '../core/present.js';
import { withoutRoom } from '../core/text.js';
import { icon, iconFor } from '../design/icons.js';
import { inspect } from './hold.js';

@customElement('hc-device-pill')
export class HcDevicePill extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      min-width: 0;
      container-type: inline-size;
      /* How lit the chip is, from the light's own level (set per instance). */
      --tint: 0%;
      --tint-colour: var(--hc-ink-muted, #8b95a4);
    }
    :host([data-lit]) {
      --tint-colour: var(--hc-accent-active, #ffb661);
    }
    button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 0 calc(var(--hc-space-unit, 8px));
      height: 100%;
      min-height: 0;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 14px);
      background: color-mix(
        in srgb,
        var(--tint-colour) calc(var(--tint) / 2),
        var(--hc-surface-raised, #141922)
      );
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
      text-align: left;
      transition:
        background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
        border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    button:hover {
      border-color: color-mix(in srgb, var(--tint-colour) 40%, var(--hc-stroke-hairline, #262d38));
    }
    /* Picked is what the sliders below are aimed at, so it is a stronger
       statement than lit — a ring rather than a wash. */
    button[data-picked] {
      border-color: var(--hc-accent-active, #ffb661);
      box-shadow: 0 0 0 1px var(--hc-accent-active, #ffb661);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: var(--hc-radius-xs, 6px);
      background: color-mix(
        in srgb,
        var(--tint-colour) var(--tint),
        var(--hc-surface-sunken, #0d1116)
      );
      /* Toward the skin's own ink, which helps in both directions: on a dark
         skin the ink is light and the mark lifts off its tile, on a light one
         the ink is dark and the mark deepens. Measured at 3.01 against a lit
         tile in soft_home before this, which passes and is one rounding away
         from not. */
      color: color-mix(in srgb, var(--tint-colour) 85%, var(--hc-ink, #e9edf2));
      transition: inherit;
    }
    .tile svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .level {
      margin-left: auto;
      flex: none;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
    }
    :host([data-lit]) .level {
      color: var(--hc-ink, #e9edf2);
    }
    /* Four lights share one 44px row, so a narrow chip spends its width on the
       name. The level is not lost — the chip's own tint is carrying it. */
    @container (max-width: 11rem) {
      .level {
        display: none;
      }
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ type: Boolean }) picked = false;
  /** The room this pill is shown in, if the page is scoped to one. */
  @property({ attribute: false }) room: string | undefined;
  @property({ attribute: false }) onPick: ((deviceId: string) => void) | undefined;
  /** Hold to inspect, without acting on it (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  override render() {
    const d = this.device;
    if (d === undefined) return html``;

    const on = isOn(d);
    const level = on === true ? levelOf(d) : undefined;

    // The chip carries the light's own level: 14% at the bottom of the dimmer,
    // 32% at the top. A row of these reads as a room at a glance, which a row
    // of identical rectangles with a dot on them never did.
    this.toggleAttribute('data-lit', on === true);
    this.style.setProperty(
      '--tint',
      on === true ? `${14 + Math.round((Math.min(level ?? 100, 100) / 100) * 18)}%` : '0%',
    );

    return html`<button
      ${inspect(() => this.onDetails?.(d.device_id))}
      part="pill"
      ?data-picked=${this.picked}
      @click=${() => this.onPick?.(d.device_id)}
    >
      <span class="tile" part="indicator">${icon(iconFor(d))}</span>
      <span class="name">${withoutRoom(effectiveName(d), this.room)}</span>
      ${level !== undefined ? html`<span class="level">${Math.round(level)}%</span>` : ''}
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-pill': HcDevicePill;
  }
}
