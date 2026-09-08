/**
 * Colour temperature, as the vertical strip from the mockup.
 *
 * 18×46, cool at the top and warm at the bottom, with a 14px knob. The mockup's
 * mapping is `(6500 - K) / (6500 - 2000)`, so the top of the strip is the
 * coolest the bulb goes — which is the right way round: the gradient runs from
 * daylight blue down to candle amber, and the strip reads like a thermometer of
 * light.
 *
 * *"warmth — the same light, tunable white only"*, so it is on the page only
 * when the picked device declares `color_temp` (`core/visibility.ts`).
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from './hc-controls.js';
import { registerWidget } from './registry.js';

@customElement('hc-warmth')
export class HcWarmth extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
    }
    .strip {
      width: 18px;
      height: 100%;
      min-height: 46px;
      flex: none;
      border-radius: var(--hc-radius-pill, 999px);
      /* Not tokens: this is the colour of light itself, and it means the same
         thing in every skin. A warmth strip tinted by the theme would be
         telling the truth about the theme and a lie about the bulb. */
      background: linear-gradient(#bcd4ff, #fff5ea 52%, #ffb26e);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .knob {
      position: absolute;
      left: 50%;
      width: 14px;
      height: 14px;
      margin: -7px 0 0 -7px;
      border-radius: var(--hc-radius-pill, 999px);
      background: #ffd9ae;
      border: 2.5px solid #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
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
    if (d === undefined) return html`<div class="strip"></div>`;

    const { min, max } = this.range();
    const live = d.attributes[this.attribute];
    const k = this.pending ?? (typeof live === 'number' ? live : undefined);
    // Cool at the top: the mockup's (6500 - K) / (6500 - 2000).
    const pos = k === undefined ? 55 : ((max - k) / (max - min)) * 100;

    return html`<div
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
      <span class="knob" style="top:${Math.min(100, Math.max(0, pos))}%"></span>
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
