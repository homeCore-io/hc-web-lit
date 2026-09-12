/**
 * Colour temperature, as a column the width its placement says.
 *
 * Cool at the top and warm at the bottom, with the value in kelvin written
 * above it. The mapping is `(6500 - K) / (6500 - 2000)`, so the top of the
 * column is the coolest the bulb goes — which is the right way round: the
 * gradient runs from daylight blue down to candle amber, and it reads like a
 * thermometer of light.
 *
 * **It is as wide as the box its author drew.** This was an 18px strip
 * whatever it was given, and the household's room page draws it at 52 — a
 * third of its placement, leaving a column of empty page beside it. Same rule
 * and same fix as the wheel next to it (§14.1): a placement is the size the
 * author drew.
 *
 * **The number belongs on the control.** A tunable-white bulb's whole
 * vocabulary is one number, and it was written only in the slider further
 * along the row — so the column somebody actually drags said nothing about
 * where it had got to. It is the reading, in the unit the bulb reports.
 *
 * *"warmth — the same light, tunable white only"*, so it is on the page only
 * when the picked device declares `color_temp` (`core/visibility.ts`).
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-warmth')
export class HcWarmth extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .column {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .reading {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-dim, #93a0b4);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      line-height: 1;
    }
    .strip {
      width: 100%;
      max-width: 44px;
      flex: 1 1 auto;
      min-height: 46px;
      border-radius: var(--hc-radius-pill, 999px);
      /* Not tokens: this is the colour of light itself, and it means the same
         thing in every skin. A warmth strip tinted by the theme would be
         telling the truth about the theme and a lie about the bulb. */
      background: linear-gradient(#bcd4ff, #fff5ea 52%, #ffb26e);
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.16),
        0 6px 18px rgba(0, 0, 0, 0.45);
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .knob {
      position: absolute;
      left: 50%;
      /* A ring across the column rather than a dot in the middle of it: on a
         44px strip a 14px dot reads as a bead somebody dropped in. */
      width: calc(100% + 6px);
      height: 18px;
      translate: -50% -50%;
      border-radius: var(--hc-radius-pill, 999px);
      background: transparent;
      border: 3px solid #fff;
      box-shadow:
        0 2px 6px rgba(0, 0, 0, 0.6),
        inset 0 0 0 1px rgba(0, 0, 0, 0.2);
    }
    .strip:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 3px;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  @state() private pending: number | undefined;

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('device')) this.pending = undefined;
  }

  private get attribute(): string {
    return typeof this.config['attribute'] === 'string' ? this.config['attribute'] : 'color_temp';
  }

  private range(): { min: number; max: number } {
    const declared = this.device?.schema?.attributes?.[this.attribute];
    return { min: declared?.min ?? 2000, max: declared?.max ?? 6500 };
  }

  override render() {
    const d = this.device;
    if (d === undefined) return html`<div class="column"><div class="strip"></div></div>`;

    const { min, max } = this.range();
    const live = d.attributes[this.attribute];
    const k = this.pending ?? (typeof live === 'number' ? live : undefined);
    // Cool at the top: the mockup's (6500 - K) / (6500 - 2000).
    const pos = k === undefined ? 55 : ((max - k) / (max - min)) * 100;

    return html`<div class="column">
      <span class="reading" part="value">${k === undefined ? '' : `${Math.round(k)} K`}</span>
      <div
        class="strip"
        part="strip"
        role="slider"
        tabindex="0"
        aria-label="Warmth"
        aria-valuemin=${min}
        aria-valuemax=${max}
        aria-valuenow=${Math.round(k ?? (min + max) / 2)}
        @pointerdown=${(e: PointerEvent) => this.scrub(e, min, max)}
        @keydown=${(e: KeyboardEvent) => this.key(e, k ?? (min + max) / 2, min, max)}
      >
        <span class="knob" part="knob" style="top:${Math.min(100, Math.max(0, pos))}%"></span>
      </div>
    </div>`;
  }

  private scrub(e: PointerEvent, min: number, max: number): void {
    if (this.onCommand === undefined) return;
    const strip = e.currentTarget as HTMLElement;
    strip.setPointerCapture(e.pointerId);

    const at = (ev: PointerEvent) => {
      const box = strip.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
      // Top is coolest, so the axis runs backwards from the value.
      this.pending = Math.round(max - t * (max - min));
    };

    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = (ev: PointerEvent) => {
      at(ev);
      strip.removeEventListener('pointermove', move);
      strip.removeEventListener('pointerup', up);
      this.commit();
    };
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', up);
  }

  private key(e: KeyboardEvent, k: number, min: number, max: number): void {
    const step = (max - min) / 20;
    const to = e.key === 'ArrowUp' ? k + step : e.key === 'ArrowDown' ? k - step : undefined;
    if (to === undefined) return;
    e.preventDefault();
    this.pending = Math.round(Math.min(max, Math.max(min, to)));
    this.commit();
  }

  private commit(): void {
    const id = this.device?.device_id;
    if (id === undefined || this.pending === undefined) return;
    this.onCommand?.({ deviceId: id, patch: { [this.attribute]: this.pending } });
  }
}

registerWidget('warmth', 'hc-warmth');

declare global {
  interface HTMLElementTagNameMap {
    'hc-warmth': HcWarmth;
  }
}
