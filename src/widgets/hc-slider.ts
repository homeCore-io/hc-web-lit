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
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

@customElement('hc-slider')
export class HcSlider extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    /* **The placement is the slider.** The track used to carry 36px of
       invisible padding to make a 4px bar hittable, which is a reasonable
       trick right up until the padding is taller than the box: on this
       household's room page a slider is placed 54px tall and wanted 73, so
       the bottom of the bar and half the knob were clipped off. A whole
       placement dedicated to one control *is* the hit target — it is wider
       and taller than the padding ever was, and it cannot overflow the box it
       is measured against. */
    .slider {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 0;
    }
    .row {
      flex: none;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: var(--hc-text-label-size, 12px);
      color: var(--hc-ink-muted, #8b95a4);
      margin-bottom: 6px;
      letter-spacing: 0.01em;
    }
    .row b {
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-weight: 500;
      font-size: var(--hc-text-body-size, 13px);
      color: var(--hc-ink, #e9edf2);
      font-variant-numeric: tabular-nums;
    }
    .track {
      flex: 1 1 auto;
      min-height: 1.25rem;
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .bar {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 8px;
      margin-top: -4px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #1e2530);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    }
    .fill {
      position: absolute;
      left: 0;
      top: 50%;
      height: 8px;
      margin-top: -4px;
      border-radius: var(--hc-radius-pill, 999px);
      /* Lit along its length rather than flat, so the filled part reads as the
         quantity it is and not as a coloured rule. */
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--hc-accent-active, #ffb661) 70%, transparent),
        var(--hc-accent-active, #ffb661)
      );
    }
    .fill[data-cool] {
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--hc-accent-primary, #7cc4ff) 70%, transparent),
        var(--hc-accent-primary, #7cc4ff)
      );
    }
    /* **It travels between the stops, not past them.** Positioned at a plain
       percentage the knob hangs half its width off each end — at zero it sat
       outside the track, clipped by whatever was drawn beside it, which is
       what a household reading "Warmth 0" with half a knob saw. The centre
       runs from one radius in to one radius short of the end, so the control
       is whole at both extremes and the fill still reaches them. */
    .knob {
      position: absolute;
      top: 50%;
      left: calc(var(--hc-slider-at, 0) * (100% - 20px) + 10px);
      width: 20px;
      height: 20px;
      margin: -10px 0 0 -10px;
      border-radius: var(--hc-radius-pill, 999px);
      background: #fff;
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(0, 0, 0, 0.18);
      transition: transform 90ms ease-out;
    }
    .track:active .knob {
      transform: scale(1.12);
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

    // **A control for something this device does not have is not a control.**
    // The room page gives the warmth and brightness sliders one shared
    // `hide_unless` — brightness_pct, color_temp or color_xy, any of the three
    // — so a dimmer that reports only brightness kept the *warmth* slider too:
    // a colour-temperature control on a light with no colour temperature,
    // reading "Warmth 0" with its knob against the stop. Dragging it would
    // have sent `color_temp` to a device that has never heard of it.
    //
    // Asked of the attribute this slider actually drives rather than of a list
    // beside it, because the widget is the only thing that knows which one
    // that is — and a declaration kept in two places is one that eventually
    // disagrees with itself. Declared *or* reported, the same order every
    // other reader here uses (§ visibility.ts): a bulb that can take a colour
    // temperature and has not published one yet still gets the control.
    const declared = d.schema?.attributes?.[attribute];
    if (declared === undefined && !(attribute in d.attributes)) return nothing;
    const min = numberOr(this.config['min'], declared?.min ?? 0);
    const max = numberOr(this.config['max'], declared?.max ?? 100);
    const live = d.attributes[attribute];
    const value = this.pending ?? (typeof live === 'number' ? live : min);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    const unit = declared?.unit ?? '';

    return html`
      <div class="slider">
        <div class="row" part="label">
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
          <span class="fill" part="fill" ?data-cool=${this.cool} style="width:${pct}%"></span>
          <span class="knob" part="knob" style="--hc-slider-at:${pct / 100}"></span>
        </div>
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
  return typeof given === 'string' && given !== '' ? given : humanise(attribute);
}

registerWidget('slider', 'hc-slider');

declare global {
  interface HTMLElementTagNameMap {
    'hc-slider': HcSlider;
  }
}
