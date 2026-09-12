/**
 * Colour, as a wheel the size its placement says.
 *
 * A hue wheel with a white centre and a thumb sitting where the light
 * currently is. *"colour_wheel — aimed at the light you picked"*, and on the
 * page only when that light declares `color_xy` (`core/visibility.ts`).
 *
 * **It is as big as the box its author drew.** This was 46×46 whatever it was
 * given, and the household's room page draws it at 132 — so the wheel was
 * rendering at about a third of its placement, in the corner of an empty
 * square, which is most of why it read as a washed-out dot next to the
 * client this replaced. §14.1's rule is the general one and it applies here:
 * a placement is the size the author drew and a widget does not get to
 * disagree. Square, because a hue wheel is, and centred in whatever
 * rectangle it was actually handed.
 *
 * **Hues every 30°, not every 60°.** A six-stop conic gradient interpolates
 * through the middle of sRGB and comes out muddy — cyan and magenta in
 * particular arrive as grey. Twelve stops plus the repeat is the whole colour
 * circle at even spacing, which is what a wheel is for. The white centre is
 * pulled in to a quarter of the radius too: at 62% it bleached everything
 * inside the rim, so most of the wheel was a pale wash rather than colour.
 *
 * **The thumb is the colour it is pointing at**, which the accent token
 * cannot be: a control for choosing a colour that shows the same orange
 * wherever you put it is not showing you anything. Derived from the same
 * angle and radius that place it, so the swatch and the position cannot
 * disagree.
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
import type { CommandRequest } from '../core/widget.js';
import { registerWidget } from '../core/registry.js';

/** CIE standard illuminant D65 — what a bulb calls white. */
const WHITE = { x: 0.3127, y: 0.329 };
/** How far from white the ring's edge is, in xy units. Beyond this, clamp. */
const GAMUT = 0.22;

@customElement('hc-colour-wheel')
export class HcColourWheel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      container-type: size;
    }
    .box {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
    }
    .wheel {
      /* Square, and as large as the shorter side of the box allows. A hue
         wheel that stretched to a rectangle would put the same hue at two
         distances from the centre. */
      aspect-ratio: 1;
      width: 100%;
      max-width: 100%;
      max-height: 100%;
      min-width: 36px;
      border-radius: var(--hc-radius-pill, 999px);
      /* Not tokens, for the same reason the warmth strip is not: this is the
         colour of light, and it means the same in every skin. */
      background:
        radial-gradient(
          circle at 50% 50%,
          #fff 0%,
          rgba(255, 255, 255, 0.85) 12%,
          rgba(255, 255, 255, 0) 26%
        ),
        conic-gradient(
          from 90deg,
          #ff3b3b,
          #ff7a1a 30deg,
          #ffb300 60deg,
          #e8e021 90deg,
          #8ede2b 120deg,
          #2fd36f 150deg,
          #17d6b4 180deg,
          #1fb6ff 210deg,
          #3d7bff 240deg,
          #8a5cff 270deg,
          #d64cff 300deg,
          #ff3fa4 330deg,
          #ff3b3b 360deg
        );
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.15),
        var(--hc-elevation-card, 0 8px 20px rgb(0 0 0 / 0.35));
      position: relative;
      cursor: pointer;
      touch-action: none;
    }
    .thumb {
      position: absolute;
      /* Scales with the wheel: a 13px thumb that was right at 46px is a speck
         at 132, and the grab target goes with it. */
      width: 16cqmin;
      height: 16cqmin;
      min-width: 14px;
      min-height: 14px;
      max-width: 22px;
      max-height: 22px;
      translate: -50% -50%;
      border-radius: var(--hc-radius-pill, 999px);
      border: 3px solid #fff;
      box-shadow: var(--hc-elevation-control, 0 2px 6px rgb(0 0 0 / 0.45));
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
    // 46 was the wheel's old pixel size used as a percentage, which held the
    // thumb inside the rim by accident. 47 of the 50% radius is the same inset
    // said on purpose, and it no longer changes if the wheel is resized.
    const left = 50 + Math.cos(angle) * r * 47;
    // y is up in CIE and down in CSS.
    const top = 50 - Math.sin(angle) * r * 47;
    // The swatch, from the position — 90° is where the gradient starts, and
    // the wheel runs clockwise from it, which is what `from 90deg` above says.
    const hue = (((90 - (angle * 180) / Math.PI) % 360) + 360) % 360;

    return html`<div class="box">
      <div
        class="wheel"
        part="wheel"
        role="button"
        tabindex="0"
        aria-label="Colour"
        @pointerdown=${(e: PointerEvent) => this.scrub(e)}
      >
        <span
          class="thumb"
          part="knob"
          style="left:${left}%;top:${top}%;background:hsl(${Math.round(hue)} ${Math.round(
            r * 100,
          )}% ${Math.round(72 - r * 22)}%)"
        ></span>
      </div>
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
