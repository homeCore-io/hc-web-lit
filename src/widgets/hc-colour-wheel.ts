/**
 * Colour, as the wheel from the mockup.
 *
 * 46×46, a hue ring with a white centre, and a 13px thumb sitting where the
 * light currently is. *"colour_wheel — aimed at the light you picked"*, and on
 * the page only when that light declares `color_xy` (`core/visibility.ts`) —
 * the mockup gates it the same way, on `supports_color_xy`.
 *
 * **CIE xy in, angle and radius out.** A device reports `{x, y}` on the CIE 1931
 * chromaticity diagram, not a hue. Converting properly means going through XYZ
 * to sRGB and back out to a hue angle, which is a real colour-science routine
 * and not one to improvise; what the wheel needs is only *where to put the
 * thumb*, so this maps xy onto the ring relative to white (0.3127, 0.3290) —
 * direction is hue, distance is saturation. That is exact enough to point at
 * and honest about being a position rather than a colour conversion.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from './hc-controls.js';
import { registerWidget } from './registry.js';

/** CIE standard illuminant D65 — what a bulb calls white. */
const WHITE = { x: 0.3127, y: 0.329 };
/** How far from white the ring's edge is, in xy units. Beyond this, clamp. */
const GAMUT = 0.22;

@customElement('hc-colour-wheel')
export class HcColourWheel extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
    }
    .wheel {
      width: 46px;
      height: 46px;
      border-radius: var(--hc-radius-pill, 999px);
      /* Not tokens, for the same reason the warmth strip is not: this is the
         colour of light, and it means the same in every skin. */
      background:
        radial-gradient(circle at 50% 50%, #fff 0%, rgba(255, 255, 255, 0) 62%),
        conic-gradient(#ff6b6b, #ffb661, #f5e86b, #6fd1a6, #7cc4ff, #9e8bff, #ff6b6b);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .thumb {
      position: absolute;
      width: 13px;
      height: 13px;
      margin: -6.5px 0 0 -6.5px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-accent-active, #ffb661);
      border: 2.5px solid #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
    }
    .wheel:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 3px;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  @state() private pending: { x: number; y: number } | undefined;

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('device')) this.pending = undefined;
  }

  private get attribute(): string {
    return typeof this.config['attribute'] === 'string' ? this.config['attribute'] : 'color_xy';
  }

  private xy(): { x: number; y: number } | undefined {
    if (this.pending !== undefined) return this.pending;
    const raw = this.device?.attributes[this.attribute];
    if (typeof raw !== 'object' || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    return typeof o['x'] === 'number' && typeof o['y'] === 'number'
      ? { x: o['x'], y: o['y'] }
      : undefined;
  }

  override render() {
    const xy = this.xy();
    // Centre when the bulb is on white or has not said — the thumb sits where
    // the colour is, and white is the middle of the wheel.
    const dx = xy === undefined ? 0 : (xy.x - WHITE.x) / GAMUT;
    const dy = xy === undefined ? 0 : (xy.y - WHITE.y) / GAMUT;
    const r = Math.min(1, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const left = 50 + Math.cos(angle) * r * 46;
    // y is up in CIE and down in CSS.
    const top = 50 - Math.sin(angle) * r * 46;

    return html`<div
      class="wheel"
      part="wheel"
      role="button"
      tabindex="0"
      aria-label="Colour"
      @pointerdown=${(e: PointerEvent) => this.scrub(e)}
    >
      <span class="thumb" part="knob" style="left:${left}%;top:${top}%"></span>
    </div>`;
  }

  private scrub(e: PointerEvent): void {
    if (this.onCommand === undefined) return;
    const wheel = e.currentTarget as HTMLElement;
    wheel.setPointerCapture(e.pointerId);

    const at = (ev: PointerEvent) => {
      const box = wheel.getBoundingClientRect();
      // -1..1 from the centre, clamped to the ring.
      let nx = ((ev.clientX - box.left) / box.width) * 2 - 1;
      let ny = 1 - ((ev.clientY - box.top) / box.height) * 2;
      const r = Math.hypot(nx, ny);
      if (r > 1) {
        nx /= r;
        ny /= r;
      }
      this.pending = { x: WHITE.x + nx * GAMUT, y: WHITE.y + ny * GAMUT };
    };

    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = (ev: PointerEvent) => {
      at(ev);
      wheel.removeEventListener('pointermove', move);
      wheel.removeEventListener('pointerup', up);
      this.commit();
    };
    wheel.addEventListener('pointermove', move);
    wheel.addEventListener('pointerup', up);
  }

  private commit(): void {
    const id = this.device?.device_id;
    if (id === undefined || this.pending === undefined) return;
    this.onCommand?.({
      deviceId: id,
      patch: {
        [this.attribute]: {
          x: Math.round(this.pending.x * 10000) / 10000,
          y: Math.round(this.pending.y * 10000) / 10000,
        },
      },
    });
  }
}

registerWidget('colour_wheel', 'hc-colour-wheel');

declare global {
  interface HTMLElementTagNameMap {
    'hc-colour-wheel': HcColourWheel;
  }
}
