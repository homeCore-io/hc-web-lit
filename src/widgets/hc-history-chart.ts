/**
 * A time series for one attribute — `history_chart`.
 *
 * Config is core's: `device_id`, `attribute`, `timeframe_hours`, `bare`.
 *
 * **Axes, because a line with no scale is a shape rather than a reading.** The
 * reference house's indoor sensor swings 71.4 to 77.4 within minutes, and drawn
 * against its own min and max that fills the plot and reads as chaos. On a
 * rounded 68–78 axis the same data is visibly a six-degree oscillation. The
 * scale is the difference between showing the data and explaining it.
 *
 * **The viewBox is measured pixels, not an arbitrary unit box.** A fixed
 * `viewBox` with `preserveAspectRatio="none"` is the obvious way to make an SVG
 * fill its container, and it stretches the type with it: in the hero, 680×116px
 * of chart drawn in a 100×44 box smears every label 6× wide and turns the dots
 * into ellipses. So the element measures itself and one user unit is one pixel,
 * which also means font sizes and stroke widths are the numbers they say.
 *
 * **SVG, not a charting library.** §13 names uPlot and that is probably right
 * when charts get dense; a hundred points with gridlines and a hover readout
 * needs none of it, and the dependency would arrive before its requirements do.
 */
import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HistoryEntry } from '../core/api.js';
import {
  clockLabel,
  downsample,
  nearest,
  niceScale,
  seriesFor,
  type Point,
  type Series,
} from '../core/history.js';
import { registerWidget } from '../core/registry.js';
import { humanise, words } from '../core/text.js';

export type HistoryFetch = (
  deviceId: string,
  opts: { from: Date; to: Date; limit: number },
) => Promise<HistoryEntry[]>;

/** Room for the axis labels, in px: the value column and the clock row. */
const PAD = { l: 36, r: 8, t: 10, b: 16 };

@customElement('hc-history-chart')
export class HcHistoryChart extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .chart {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      height: 100%;
      box-sizing: border-box;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .chart[data-boxed] {
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-radius-md, 14px);
      background: var(--hc-surface-raised, #141922);
    }
    .head {
      flex: none;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.5rem;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .now {
      color: var(--hc-ink, #e9edf2);
      font-variant-numeric: tabular-nums;
      font-size: var(--hc-text-subtitle-size, 16px);
      font-weight: 600;
    }
    svg {
      flex: 1;
      min-height: 0;
      width: 100%;
      display: block;
      overflow: hidden;
      touch-action: none;
    }
    .grid {
      stroke: var(--hc-stroke-hairline, #262d38);
      stroke-width: 1;
    }
    .axis {
      fill: var(--hc-ink-muted, #8b95a4);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .line {
      fill: none;
      stroke: var(--hc-metric-reading, #7cc4ff);
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .dot {
      fill: var(--hc-metric-reading, #7cc4ff);
    }
    .hit {
      stroke: var(--hc-ink-muted, #8b95a4);
      stroke-width: 1;
    }
    .mark {
      fill: var(--hc-ink, #e9edf2);
    }
    /* A halo in the page's own ground, so the readout stays legible wherever
       the line happens to be; paint-order puts the stroke behind the fill. */
    .readout {
      fill: var(--hc-ink, #e9edf2);
      stroke: var(--hc-surface-ground, #0a0e13);
      stroke-width: 3px;
      paint-order: stroke fill;
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .note {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      align-self: center;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) onFetch: HistoryFetch | undefined;

  @state() private series: Series | undefined;
  @state() private note = '';
  @state() private hover: Point | undefined;
  /** The plot's own pixel size, so one user unit is one pixel. */
  @state() private size = { w: 0, h: 0 };

  /** What was last fetched, so a re-render does not re-fetch. */
  private fetched = '';
  private readonly ro = new ResizeObserver(() => this.measure());

  override connectedCallback(): void {
    super.connectedCallback();
    this.ro.observe(this);
    void this.load();
  }

  override disconnectedCallback(): void {
    this.ro.disconnect();
    super.disconnectedCallback();
  }

  override willUpdate(): void {
    // Keyed on what actually determines the request. The page hands a fresh
    // config object on every render, so comparing objects would re-fetch six
    // hours of readings every time a light changed anywhere in the house.
    void this.load();
  }

  override updated(): void {
    // The svg only exists once there is a series to draw.
    this.measure();
  }

  private measure(): void {
    const el = this.renderRoot.querySelector('svg');
    if (el === null) return;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w !== this.size.w || h !== this.size.h) this.size = { w, h };
  }

  private async load(): Promise<void> {
    const deviceId = this.config['device_id'];
    const attribute = this.config['attribute'];
    if (typeof deviceId !== 'string' || typeof attribute !== 'string') {
      this.note = 'Not configured.';
      return;
    }
    if (this.onFetch === undefined) return;

    const hours =
      typeof this.config['timeframe_hours'] === 'number' ? this.config['timeframe_hours'] : 6;
    const want = `${deviceId}/${attribute}/${hours}`;
    if (want === this.fetched) return;
    this.fetched = want;

    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);

    try {
      const rows = await this.onFetch(deviceId, { from, to, limit: 1000 });
      const found = seriesFor(rows, attribute);
      if (found === undefined) {
        this.note = `No ${words(attribute)} recorded in the last ${hours}h.`;
        this.series = undefined;
        this.announce(true);
        return;
      }
      this.note = '';
      this.series = { ...found, points: downsample(found.points, 240) };
      this.announce(false);
    } catch {
      this.note = 'History unavailable.';
      this.series = undefined;
      // Let a later render try again rather than sticking on the failure.
      this.fetched = '';
      this.announce(true);
    }
  }

  /**
   * Whether there was anything to draw.
   *
   * A placement gives this a box and the box stays whichever way the fetch
   * goes, which is right on a dashboard — a chart that resized the page every
   * time a sensor went quiet would be worse. A container that *composed* this
   * one, though, wants to drop the whole section rather than caption 140px of
   * nothing, so this says which happened and lets the caller decide.
   *
   * More often than it should, for now: `GET /devices/{id}/history` returns
   * every attribute interleaved with no filter, so a thousand rows over 24h can
   * run out before reaching the one asked for (homeCore#31).
   */
  private announce(empty: boolean): void {
    this.dispatchEvent(
      new CustomEvent('hc-history-drawn', { detail: { empty }, bubbles: true, composed: true }),
    );
  }

  override render() {
    const bare = this.config['bare'] === true;
    const attribute = typeof this.config['attribute'] === 'string' ? this.config['attribute'] : '';
    const s = this.series;

    return html`<div class="chart" ?data-boxed=${!bare} part="chart">
      ${bare ? nothing : this.head(attribute, s)}
      ${s === undefined ? html`<div class="note" part="note">${this.note}</div>` : this.plot(s)}
    </div>`;
  }

  private head(attribute: string, s: Series | undefined) {
    return html`<div class="head">
      <span>${humanise(attribute)}</span>
      ${
        s !== undefined
          ? html`<span class="now" part="value"
              >${trim(s.points[s.points.length - 1]?.value)}</span
            >`
          : nothing
      }
    </div>`;
  }

  private plot(s: Series) {
    const { w, h } = this.size;
    // First paint: the element has not been measured yet, so there is no
    // geometry to draw in. The ResizeObserver brings it back a frame later.
    const empty = w < PAD.l + PAD.r + 20 || h < PAD.t + PAD.b + 20;

    const left = PAD.l;
    const top = PAD.t;
    const width = Math.max(1, w - PAD.l - PAD.r);
    const height = Math.max(1, h - PAD.t - PAD.b);

    const scale = niceScale(s.min, s.max);
    const t0 = s.points[0]!.at;
    const t1 = s.points[s.points.length - 1]!.at;
    const span = t1 - t0 || 1;

    const x = (at: number) => left + ((at - t0) / span) * width;
    const y = (v: number) => top + height - ((v - scale.lo) / (scale.hi - scale.lo)) * height;

    const d = s.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');
    // Dots only where they would not merge into the line anyway: a point every
    // four pixels is a thick line, not a set of readings.
    const dots = width / s.points.length >= 8 ? s.points : [];
    const hover = this.hover;

    return html`<svg
      viewBox="0 0 ${w} ${h}"
      part="plot"
      @pointermove=${(e: PointerEvent) => this.track(e, s, t0, span)}
      @pointerleave=${() => {
        this.hover = undefined;
      }}
    >
      ${
        empty
          ? nothing
          : svg`
        ${scale.lines.map(
          (v) => svg`
            <line class="grid" x1=${left} y1=${y(v)} x2=${left + width} y2=${y(v)} />
            <text class="axis" x=${left - 6} y=${y(v) + 3.5} text-anchor="end">${trim(v)}</text>`,
        )}
        <text class="axis" x=${left} y=${h - 4} text-anchor="start">${clockLabel(t0, span)}</text>
        <text class="axis" x=${left + width} y=${h - 4} text-anchor="end">
          ${clockLabel(t1, span)}
        </text>
        <path class="line" d=${d} />
        ${dots.map((p) => svg`<circle class="dot" cx=${x(p.at)} cy=${y(p.value)} r="2" />`)}
        ${
          hover === undefined
            ? nothing
            : svg`
            <line class="hit" x1=${x(hover.at)} y1=${top} x2=${x(hover.at)} y2=${top + height} />
            <circle class="mark" cx=${x(hover.at)} cy=${y(hover.value)} r="3" />
            <text
              class="readout"
              x=${x(hover.at) + (x(hover.at) > left + width / 2 ? -8 : 8)}
              y=${top + 9}
              text-anchor=${x(hover.at) > left + width / 2 ? 'end' : 'start'}
            >${trim(hover.value)} · ${clockLabel(hover.at, span)}</text>`
        }
      `
      }
    </svg>`;
  }

  /**
   * The point under the pointer.
   *
   * By time rather than by pixel distance: the nearest sample to where the
   * finger is horizontally is the one somebody means, even when the line has
   * climbed away from it vertically.
   */
  private track(e: PointerEvent, s: Series, t0: number, span: number): void {
    const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const width = Math.max(1, box.width - PAD.l - PAD.r);
    const at = t0 + ((e.clientX - box.left - PAD.l) / width) * span;
    this.hover = nearest(s.points, at);
  }
}

/** A reading without trailing zeros: 72, not 72.0. */
const trim = (v: number | undefined): string =>
  v === undefined ? '' : String(Math.round(v * 10) / 10);

registerWidget('history_chart', 'hc-history-chart');

declare global {
  interface HTMLElementTagNameMap {
    'hc-history-chart': HcHistoryChart;
  }
}
