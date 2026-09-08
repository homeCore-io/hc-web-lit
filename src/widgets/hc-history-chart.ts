/**
 * A time series for one attribute.
 *
 * Config is core's: `device_id`, `attribute`, `timeframe_hours`, `bare`.
 *
 * **SVG, not a charting library.** §13 names uPlot for Tier 1 and that is
 * probably right when charts get real — dense series, small, fast on a tablet.
 * A polyline through a hundred points needs none of it, and taking the
 * dependency now would be taking it before knowing what it has to do.
 *
 * The fetch is a widget's own because there is no history primitive yet: §5.9
 * puts `ctx.history` on the capability object so a widget never holds an API
 * client. This one does, temporarily and visibly, via the same `onFetch`
 * callback shape the host already uses for commands — which is the seam that
 * becomes `ctx.history`.
 */
import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HistoryEntry } from '../core/api.js';
import { downsample, pathFor, seriesFor, type Series } from '../core/history.js';
import { registerWidget } from './registry.js';

export type HistoryFetch = (
  deviceId: string,
  opts: { from: Date; to: Date; limit: number },
) => Promise<HistoryEntry[]>;

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
      font-size: var(--hc-text-subtitle-size, 14px);
      font-weight: 600;
    }
    svg {
      /* flex:1 with min-height:0, not height:100%. An SVG with a viewBox has
         an intrinsic aspect ratio, and height:100% had nothing definite to
         resolve against — so the svg took 680 / 2.5 = 272px inside a 116px
         placement and drew its line across three other widgets. Measured in a
         browser, not guessed. */
      flex: 1;
      min-height: 0;
      width: 100%;
      display: block;
      /* Clip to the box. A bare chart has no border to hide behind, so an
         overflowing line lands on whatever is next to it. */
      overflow: hidden;
    }
    path {
      fill: none;
      stroke: var(--hc-metric-reading, #7cc4ff);
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .note {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      align-self: center;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  /** The host's history reader — the seam that becomes `ctx.history` (§5.9). */
  @property({ attribute: false }) onFetch: HistoryFetch | undefined;

  @state() private series: Series | undefined;
  @state() private note = '';

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('config') || changed.has('onFetch')) void this.load();
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
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);

    try {
      // The cap is per row, not per point, and the rows are every attribute
      // interleaved — so ask for the maximum and expect a fraction of it to be
      // the one wanted (§5.9).
      const rows = await this.onFetch(deviceId, { from, to, limit: 1000 });
      const found = seriesFor(rows, attribute);
      if (found === undefined) {
        this.note = `No ${attribute} recorded in the last ${hours}h.`;
        this.series = undefined;
        return;
      }
      this.note = '';
      this.series = { ...found, points: downsample(found.points, 240) };
    } catch {
      // A chart that cannot reach history says so rather than drawing a flat
      // line, which would be a claim about the house.
      this.note = 'History unavailable.';
      this.series = undefined;
    }
  }

  override render() {
    const bare = this.config['bare'] === true;
    const attribute = typeof this.config['attribute'] === 'string' ? this.config['attribute'] : '';
    const s = this.series;

    // `bare` means the composition already provides the chrome. On the real
    // house page the band around this chart carries "INSIDE", the unit and the
    // current reading as their own elements, so drawing a header here puts the
    // attribute name and the value on the page twice.
    return html`<div class="chart" ?data-boxed=${!bare} part="chart">
      ${bare ? nothing : this.head(attribute, s)}
      ${
        s === undefined
          ? html`<div class="note" part="note">${this.note}</div>`
          : html`<svg viewBox="0 0 100 40" preserveAspectRatio="none" part="plot">
              ${svg`<path d=${pathFor(s, 100, 40)} />`}
            </svg>`
      }
    </div>`;
  }

  private head(attribute: string, s: Series | undefined) {
    return html`<div class="head">
      <span>${attribute.replace(/_/g, ' ')}</span>
      ${
        s !== undefined
          ? html`<span class="now" part="value"
              >${round(s.points[s.points.length - 1]?.value)}</span
            >`
          : nothing
      }
    </div>`;
  }
}

const round = (v: number | undefined): string =>
  v === undefined ? '' : String(Math.round(v * 10) / 10);

registerWidget('history_chart', 'hc-history-chart');

declare global {
  interface HTMLElementTagNameMap {
    'hc-history-chart': HcHistoryChart;
  }
}
