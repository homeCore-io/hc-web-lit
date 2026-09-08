/**
 * One attribute of one device, as a slider.
 *
 * **Drawn to the mockup**, not to a native range input: a 4px track with an
 * amber fill and a 14px knob, and the label and readout on a row above it. A
 * `<input type=range>` cannot be styled to that across browsers, and the shape
 * is the design rather than a decoration — the mockup's whole visual language
 * is thin rules and small solid marks.
 *
 * `.track.cool` — a blue fill — is for warmth, where the value is a colour
 * temperature and amber would say the wrong thing about it.
 *
 * **Range from the schema.** The mockup states it: *"slider — brightness, the
 * plugin's range"*. A `color_temp` slider runs 2000–6535 K on a Hue bulb and
 * something else elsewhere; the device says which, and `min`/`max` in the
 * document are the override for a narrower range than the hardware allows.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from './hc-controls.js';
import { registerWidget } from './registry.js';

@customElement('hc-slider')
export class HcSlider extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: 11.5px;
      color: var(--hc-ink-muted, #8b95a4);
      margin-bottom: 8px;
    }
    .row b {
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-weight: 400;
      color: var(--hc-ink, #e9edf2);
      font-variant-numeric: tabular-nums;
    }
    .track {
      height: 4px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #1e2530);
      position: relative;
      /* The bar is 4px; the thing a finger has to hit is not. */
      padding: 20px 0;
      background-clip: content-box;
      cursor: pointer;
      touch-action: none;
    }
    .bar {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 4px;
      margin-top: -2px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #1e2530);
    }
    .fill {
      position: absolute;
      left: 0;
      top: 50%;
      height: 4px;
      margin-top: -2px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-accent-active, #ffb661);
    }
    .fill[data-cool] {
      background: var(--hc-accent-primary, #7cc4ff);
    }
    .knob {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      margin: -7px 0 0 -7px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-ink, #e9edf2);
    }
    .track:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 4px;
    }
    .idle {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: 11.5px;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /**
   * A colour temperature reads blue, not amber — the mockup's `.track.cool`.
   *
   * Derived from the attribute rather than configured, because the document
   * does not say: the room page's two sliders differ only in which attribute
   * they name, and a warmth track filled amber would be saying the light is
   * warm at every value.
   */
  private get cool(): boolean {
    const declared = this.device?.schema?.attributes?.[this.attribute];
    return declared?.kind === 'color_temp' || /color_temp|warmth|kelvin/.test(this.attribute);
  }

  /** Held until the house confirms, like every other control. */
  @state() private pending: number | undefined;

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('device')) this.pending = undefined;
  }

  private get attribute(): string {
    return typeof this.config['attribute'] === 'string' ? this.config['attribute'] : '';
  }

  override render() {
    const d = this.device;
    const attribute = this.attribute;
    if (d === undefined || attribute === '') return html`<div class="idle">Nothing picked.</div>`;

    const declared = d.schema?.attributes?.[attribute];
    const min = numberOr(this.config['min'], declared?.min ?? 0);
    const max = numberOr(this.config['max'], declared?.max ?? 100);
    const live = d.attributes[attribute];
    const value = this.pending ?? (typeof live === 'number' ? live : min);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    const unit = declared?.unit ?? '';

    return html`
      <div class="row">
        <span>${label(this.config, attribute)}</span>
        <b>${Math.round(value)}${unit === '' ? '' : ` ${unit}`}</b>
      </div>
      <div
        class="track"
        part="track"
        role="slider"
        tabindex="0"
        aria-valuemin=${min}
        aria-valuemax=${max}
        aria-valuenow=${Math.round(value)}
        @pointerdown=${(e: PointerEvent) => this.scrub(e, min, max)}
        @keydown=${(e: KeyboardEvent) => this.key(e, value, min, max)}
      >
        <span class="bar"></span>
        <span class="fill" ?data-cool=${this.cool} style="width:${pct}%"></span>
        <span class="knob" style="left:${pct}%"></span>
      </div>
    `;
  }

  /**
   * Drag anywhere on the track.
   *
   * Pointer capture, so the value keeps following a finger that has slid off
   * the bar — which is most of them, since the bar is 4px tall.
   */
  private scrub(e: PointerEvent, min: number, max: number): void {
    if (this.onCommand === undefined) return;
    const track = e.currentTarget as HTMLElement;
    track.setPointerCapture(e.pointerId);

    const at = (ev: PointerEvent) => {
      const box = track.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      this.pending = Math.round(min + t * (max - min));
    };

    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = (ev: PointerEvent) => {
      at(ev);
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      this.commit();
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  }

  private key(e: KeyboardEvent, value: number, min: number, max: number): void {
    const step = (max - min) / 20;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? value + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? value - step
          : undefined;
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

const numberOr = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

function label(config: Record<string, unknown>, attribute: string): string {
  const given = config['label'];
  return typeof given === 'string' && given !== '' ? given : attribute.replace(/_/g, ' ');
}

registerWidget('slider', 'hc-slider');

declare global {
  interface HTMLElementTagNameMap {
    'hc-slider': HcSlider;
  }
}
