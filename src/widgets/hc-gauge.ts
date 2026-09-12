/**
 * `gauge` — a reading against the range it is meant to sit in (§7.3).
 *
 * The widget a number needs when the number alone does not say enough: 68 °F
 * means nothing until you know the thermostat is set between 60 and 80, and a
 * battery at 18% is a different fact from a humidity at 18%.
 *
 * **The range is derived before it is configured.** A plugin that declares
 * `min` and `max` on an attribute has already said what the range is, and
 * asking a person to type it again is asking them to get it wrong — the
 * schema is checked first and the config only overrides it. Same for the unit,
 * which `readingAt` resolves from the published `<key>_unit` before the
 * declared one (homeCore#40).
 *
 * Core's config decides everything about the drawing: `shape`, `start`,
 * `sweep`, `thickness`, `cap`, `track`, `glow`, `readout`, `decimals`, and two
 * colour *roles* — never literal colours, so one document reads correctly in
 * all four skins (§15).
 *
 * Angles are degrees clockwise from twelve o'clock, which is what core's
 * defaults describe: 135 through 270 starts at the lower right and ends at the
 * lower left, the shape every dial on a dashboard has.
 */
import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { readingAt } from '../core/facet.js';
import { number as formatNumber, convert } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';
import { roleColor } from '../design/roles.js';
import { arc } from '../design/arc.js';

/** One id per gauge on the page, for the gradient each one owns. */
let gauges = 0;

@customElement('hc-gauge')
export class HcGauge extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    /* The chart's arrangement, for the chart's reason: a flex line gives the
       svg a definite height, where a height of 100% inside an auto-height chain
       resolves to auto and an svg with a viewBox then takes its height from
       its width. On a wide tile that drew a dial half again as tall as the
       placement it was in, spilling over three neighbours. */
    .dial {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 3rem;
      overflow: hidden;
    }
    svg {
      flex: 1;
      min-height: 0;
      width: 100%;
      display: block;
      /* Visible so a glow can bleed past the arc; the box above clips it. */
      overflow: visible;
    }
    .face {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 0.125rem;
      pointer-events: none;
    }
    .value {
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-title-size, 20px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .label {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .bar {
      display: grid;
      gap: 0.25rem;
      align-content: center;
      height: 100%;
      min-width: 0;
    }
    .bar .rail {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    .bar .fill {
      height: 100%;
    }
    .bar .line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.5rem;
    }
    .none {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;

  private readonly gradientId = `hc-gauge-${(gauges += 1)}`;

  private num(key: string, fallback: number): number {
    const v = this.config[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  private str(key: string, fallback: string): string {
    const v = this.config[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
  }

  /** The value, its unit and the range it sits in — schema first, config over it. */
  private dial():
    { value: number; unit?: string; min: number; max: number; fraction: number } | undefined {
    const d = this.device;
    const key = this.str('attribute', '');
    if (d === undefined || key === '') return undefined;

    const reading = readingAt(d, key);
    if (reading === undefined || typeof reading.value !== 'number') return undefined;

    const declared = d.schema?.attributes?.[key];
    // One base unit for the value and both bounds, or a Fahrenheit needle
    // ends up pointing at a Celsius scale.
    const base = this.str('unit', reading.unit ?? '');
    const shown = convert(reading.value, base);
    const min = convert(this.num('min', declared?.min ?? 0), base).value;
    const max = convert(this.num('max', declared?.max ?? 100), base).value;

    const span = max - min;
    const fraction = span === 0 ? 0 : Math.min(1, Math.max(0, (shown.value - min) / span));
    return {
      value: shown.value,
      ...(shown.unit !== undefined && shown.unit !== '' ? { unit: shown.unit } : {}),
      min,
      max,
      fraction,
    };
  }

  private readout(d: { value: number; unit?: string }) {
    if (this.str('readout', 'value') === 'none') return nothing;
    // A configured `decimals` is exact — somebody asking for two wants "20.00"
    // — and the default is a ceiling, so a battery at 25 reads "25%" rather
    // than "25.0%" while a temperature at 20.53 still reads "20.5".
    const asked = this.config['decimals'];
    const text =
      typeof asked === 'number'
        ? formatNumber(d.value, { minimumFractionDigits: asked, maximumFractionDigits: asked })
        : formatNumber(d.value, {
            minimumFractionDigits: 0,
            maximumFractionDigits: Math.abs(d.value) >= 100 ? 0 : 1,
          });
    return html`<span class="value" part="reading"
      >${text}${d.unit === undefined ? '' : d.unit === '%' ? '%' : ` ${d.unit}`}</span
    >`;
  }

  private label() {
    const label = this.str('label', '');
    return label === '' ? nothing : html`<span class="label" part="name">${label}</span>`;
  }

  override render() {
    const d = this.dial();
    if (d === undefined) {
      return html`<div class="dial" part="empty">
        <span class="none"
          >${this.device === undefined ? 'No device' : 'Nothing to gauge here'}</span
        >
      </div>`;
    }

    const ink = roleColor(this.str('color', 'accent'), '--hc-accent-primary');
    const inkEnd = roleColor(
      this.str('color_to', this.str('color', 'accent')),
      '--hc-accent-primary',
    );
    const thickness = this.num('thickness', 10);
    const cap = this.str('cap', 'round') === 'flat' ? 'butt' : 'round';
    const track = this.config['track'] !== false;
    const glow = this.num('glow', 0);
    // A gradient is addressed by id, and two gauges on one page with different
    // colours sharing one would both draw whichever rendered last. Per
    // instance, so there is nothing to collide with.
    const id = this.gradientId;

    if (this.str('shape', 'radial') === 'bar') {
      return html`<div class="bar" part="set">
        <div class="line">${this.label()} ${this.readout(d)}</div>
        <div
          class="rail"
          part="track"
          style="height:${thickness}px;
                 border-radius:${cap === 'round' ? `${thickness}px` : '0'};
                 background:${track ? 'var(--hc-surface-sunken, #0d1116)' : 'transparent'}"
        >
          <div
            class="fill"
            part="indicator"
            style="width:${(d.fraction * 100).toFixed(2)}%;
                   border-radius:inherit;
                   background:linear-gradient(90deg, ${ink}, ${inkEnd});
                   filter:${glow > 0 ? `drop-shadow(0 0 ${glow}px ${ink})` : 'none'}"
          ></div>
        </div>
      </div>`;
    }

    const start = this.num('start', 135);
    const sweep = this.num('sweep', 270);
    const radius = 50 - thickness / 2;

    return html`<div class="dial" part="set">
      <svg viewBox="0 0 100 100" role="img" aria-label=${this.str('label', 'Gauge')}>
        <defs>
          ${svg`<linearGradient id=${id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color=${ink}></stop>
            <stop offset="100%" stop-color=${inkEnd}></stop>
          </linearGradient>`}
        </defs>
        ${
          track
            ? svg`<path
                part="track"
                d=${arc(start, sweep, radius)}
                fill="none"
                stroke="var(--hc-surface-sunken, #0d1116)"
                stroke-width=${thickness}
                stroke-linecap=${cap}
              ></path>`
            : nothing
        }
        ${svg`<path
          part="indicator"
          d=${arc(start, sweep * d.fraction, radius)}
          fill="none"
          stroke=${`url(#${id})`}
          stroke-width=${thickness}
          stroke-linecap=${cap}
          style=${glow > 0 ? `filter:drop-shadow(0 0 ${glow}px ${ink})` : ''}
        ></path>`}
      </svg>
      <div class="face">${this.readout(d)} ${this.label()}</div>
    </div>`;
  }
}

registerWidget('gauge', 'hc-gauge');

declare global {
  interface HTMLElementTagNameMap {
    'hc-gauge': HcGauge;
  }
}
