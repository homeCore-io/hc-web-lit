/**
 * Everything one device has to say — the sheet behind `hold` (§5.10, §5.6).
 *
 * §5.10 says `hold` defaults to `details` everywhere so there is always a
 * non-actuating way to inspect a device. This is what it opens, and it is
 * deliberately the one surface that shows a device *whole*: the reading it
 * leads with, the controls its plugin declared, its history, and then every
 * remaining attribute — because the dashboard's job is to show the four things
 * that matter and this one's is to answer "what else does it know".
 *
 * **It is a widget like any other**, mounted through the same `mountWidget`
 * a page uses, so it takes `onCommand` and `onFetch` from the host rather than
 * holding an API client (§19.4). That also means it can be *placed* on a
 * dashboard by anyone who wants a permanent inspector.
 *
 * **The attribute list is where the September schema shows its worth.** The
 * declaration decides what is a reading and what is housekeeping, so a battery
 * sits under the fold because its plugin said `category: diagnostic` — not
 * because this client recognised the word (homeCore#29).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { controlsFor } from '../core/controls.js';

import type { DeviceState } from '../core/device.js';
import { formatReading, isHousekeeping, readingOf, roleOf } from '../core/facet.js';
import { effectiveArea, effectiveName, isOn, noStatusReason } from '../core/present.js';
import type { CommandRequest } from '../core/widget.js';
import type { HistoryFetch } from './hc-history-chart.js';
import { drawableHints, registerWidget } from '../core/registry.js';
import { facetHints } from '../core/selection.js';
import './hc-controls.js';
import './hc-history-chart.js';
import { humanise } from '../core/text.js';

/** One attribute as the sheet lists it. */
interface Row {
  key: string;
  label: string;
  value: string;
  /** Charts are only offered for what a chart can draw. */
  numeric: boolean;
}

@customElement('hc-device-details')
export class HcDeviceDetails extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    .head {
      display: grid;
      gap: 0.15rem;
      margin-bottom: 0.75rem;
    }
    .name {
      font-size: var(--hc-text-title-size, 18px);
      font-weight: 600;
    }
    .where {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .lead {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      font-size: var(--hc-text-display-size, 30px);
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .lead .of {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .note,
    .offline {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .offline {
      color: var(--hc-status-warn, #ffc861);
    }
    section {
      display: grid;
      gap: 0.4rem;
      padding-top: 0.75rem;
      border-top: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    h3 {
      margin: 0;
      font-size: var(--hc-text-caption-size, 11px);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--hc-ink-muted, #8b95a4);
    }
    .rows {
      display: grid;
      gap: 0.1rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 0.75rem;
      min-height: 30px;
      padding: 0 0.25rem;
      border-radius: var(--hc-radius-sm, 8px);
      font-size: var(--hc-text-body-size, 13px);
    }
    .row.pickable {
      cursor: pointer;
    }
    .row.pickable:hover,
    .row[aria-selected='true'] {
      background: var(--hc-surface-sunken, #0d1116);
    }
    .row .k {
      color: var(--hc-ink-muted, #8b95a4);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row .v {
      font-variant-numeric: tabular-nums;
    }
    details summary {
      cursor: pointer;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      list-style: none;
    }
    details summary::-webkit-details-marker {
      display: none;
    }
    details summary::before {
      content: '▸ ';
    }
    details[open] summary::before {
      content: '▾ ';
    }
    .chart {
      height: 140px;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    [hidden] {
      display: none !important;
    }
    .hint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .hint select {
      min-height: var(--hc-density-min-tap, 44px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0 0.5rem;
      font: inherit;
    }
    .hint select:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .trouble {
      color: var(--hc-accent-danger, #ff7b72);
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;

  /** The host's device-correction capability (§1.1). Absent means read-only. */
  @property({ attribute: false }) onUpdateDevice:
    ((deviceId: string, patch: Record<string, unknown>) => Promise<void>) | undefined;

  /** What this session may do, so a refused control is not offered. */
  @property({ attribute: false }) scopes: readonly string[] | undefined;

  @state() private saving = false;
  @state() private trouble = '';
  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  @property({ attribute: false }) onFetch: HistoryFetch | undefined;

  /** Which attribute the chart is showing. The lead reading, until asked. */
  @state() private charted: string | undefined;

  /** Whether the chart found anything. A section captioning nothing is noise. */
  @state() private noHistory = false;

  override willUpdate(changed: Map<string, unknown>): void {
    // A different device is a different set of attributes; keeping the old
    // selection would chart a name this device does not have.
    if (changed.has('device')) {
      this.charted = undefined;
      this.noHistory = false;
    }
  }

  /**
   * What this device should be shown as, when its plugin could not know.
   *
   * **An outlet cannot know what is plugged into it.** A lamp, a fan, a
   * radio — the endpoint is unknowable from the socket, so a plugin safely
   * reports `switch` and a person says what it really is. `ui_hint` is that
   * correction, it is read first by every facet, icon and type-specific widget
   * in this client (§1.1), and until now nothing here could set it.
   *
   * The options are the hints this client *draws differently*, taken from its
   * own registry rather than from a list somebody typed. The legal set is
   * defined nowhere (homeCore#30), so offering a value that changes nothing
   * would be inventing a vocabulary and disappointing whoever picked from it.
   *
   * Hidden where the session may not write devices: a control whose only
   * outcome is a refusal is worse than no control (§5.10's reasoning).
   */
  private renderHint(d: DeviceState) {
    if (this.onUpdateDevice === undefined) return nothing;
    if (this.scopes !== undefined && !this.scopes.includes('devices:write')) return nothing;

    // Both halves of "what this client draws differently": the hints that
    // select a type-specific widget, and the hints that decide an icon and a
    // facet. The second half is the one a person reaches for — `light`,
    // `switch` and `outlet` draw as the generic card and still change plenty.
    const options = [...new Set([...drawableHints(), ...facetHints()])].sort();
    const current = d.ui_hint ?? '';

    return html`<label class="hint" part="controls">
      <span part="heading">Show as</span>
      <select
        part="select"
        .value=${current}
        ?disabled=${this.saving}
        @change=${(e: Event) => void this.setHint(d, (e.target as HTMLSelectElement).value)}
      >
        <option value="">
          ${d.device_type === undefined ? 'Default' : `Default (${humanise(d.device_type)})`}
        </option>
        ${options.map((o) => html`<option value=${o}>${humanise(o)}</option>`)}
      </select>
      ${this.trouble !== '' ? html`<span class="trouble" part="note">${this.trouble}</span>` : nothing}
    </label>`;
  }

  private async setHint(d: DeviceState, hint: string): Promise<void> {
    this.saving = true;
    this.trouble = '';
    try {
      // Empty clears it: core reads `null` and an empty string both as "no
      // hint", and "Default" has to mean going back rather than being stuck.
      await this.onUpdateDevice?.(d.device_id, { ui_hint: hint === '' ? null : hint });
    } catch (e) {
      this.trouble = e instanceof Error ? e.message : String(e);
    } finally {
      this.saving = false;
    }
  }

  override render() {
    const d = this.device;
    if (d === undefined) return html`<div class="empty">That device is not in the house.</div>`;

    const lead = readingOf(d);
    const rows = this.rows(d);
    const controls = controlsFor(d, d.schema);
    const reason = noStatusReason(d);
    const power = isOn(d);
    // What to chart, unasked: the lead reading when a chart can draw it, and
    // otherwise the first one that can be. A lamp leads with `on`, which is not
    // a series — but its brightness over the day is worth seeing.
    const charted =
      this.charted ??
      (lead !== undefined && isNumber(lead.value)
        ? lead.key
        : rows.readings.find((r) => r.numeric)?.key);

    return html`
      <div class="head" part="head">
        <span class="name" part="name">${effectiveName(d)}</span>
        <span class="where" part="state">
          ${humanise(effectiveArea(d) ?? 'no area')} · ${humanise(d.device_type ?? 'no type')} ·
          ${humanise(roleOf(d))}
        </span>
      </div>
      ${this.renderHint(d)}
      ${
        lead === undefined
          ? nothing
          : html`<div class="lead" part="reading">
              <span>${formatReading(lead)}</span>
              <span class="of">${lead.label}</span>
            </div>`
      }
      ${
        // A momentary scene has no state, and saying why beats saying nothing
        // — `led_component` is the plugin explaining itself (homeCore#28).
        reason === undefined ? nothing : html`<div class="note">${reason}</div>`
      }
      ${
        power === undefined || lead?.key === 'on'
          ? nothing
          : html`<div class="note">${power ? 'On' : 'Off'}</div>`
      }
      ${d.available === false ? html`<div class="offline">Not responding.</div>` : nothing}
      ${
        controls.length === 0
          ? nothing
          : html`<section part="section">
              <h3 part="heading">Controls</h3>
              <hc-controls
                .device=${d}
                .controls=${controls}
                .onCommand=${this.onCommand}
              ></hc-controls>
            </section>`
      }
      ${
        charted === undefined || this.onFetch === undefined
          ? nothing
          : html`<section part="section" ?hidden=${this.noHistory}>
              <h3 part="heading">History</h3>
              <div class="chart">
                <hc-history-chart
                  .config=${{ device_id: d.device_id, attribute: charted, timeframe_hours: 24 }}
                  .onFetch=${this.onFetch}
                  @hc-history-drawn=${(e: CustomEvent<{ empty: boolean }>) => {
                    this.noHistory = e.detail.empty;
                  }}
                ></hc-history-chart>
              </div>
            </section>`
      }

      <section part="section">
        <h3 part="heading">Reports</h3>
        <div class="rows">${rows.readings.map((r) => this.row(r, charted))}</div>
        ${
          rows.housekeeping.length === 0
            ? nothing
            : html`<details>
                <summary>${rows.housekeeping.length} more the plugin called housekeeping</summary>
                <div class="rows">${rows.housekeeping.map((r) => this.row(r, charted))}</div>
              </details>`
        }
      </section>
    `;
  }

  private row(r: Row, charted: string | undefined) {
    // A numeric attribute is chartable, so the row is the way to chart it.
    const pickable = r.numeric && this.onFetch !== undefined;
    return html`<div
      part="row"
      class=${pickable ? 'row pickable' : 'row'}
      aria-selected=${r.key === charted ? 'true' : 'false'}
      role=${pickable ? 'button' : 'presentation'}
      tabindex=${pickable ? '0' : '-1'}
      @click=${() => {
        if (pickable) this.charted = r.key;
      }}
    >
      <span class="k">${r.label}</span><span class="v">${r.value}</span>
    </div>`;
  }

  private rows(d: DeviceState): { readings: Row[]; housekeeping: Row[] } {
    const declared = d.schema?.attributes;
    const readings: Row[] = [];
    const housekeeping: Row[] = [];

    for (const [key, value] of Object.entries(d.attributes)) {
      // A nested object is a subsystem reporting on itself; the sheet is a list
      // of readings, not a JSON viewer.
      if (value === null || typeof value === 'object') continue;
      const dec = declared?.[key];
      const row: Row = {
        key,
        label: dec?.display_name ?? humanise(key),
        value: formatReading({
          key,
          value,
          label: dec?.display_name ?? humanise(key),
          ...(dec?.unit !== undefined ? { unit: dec.unit } : {}),
          ...(dec?.states !== undefined ? { states: dec.states } : {}),
        }),
        numeric: isNumber(value),
      };
      (isHousekeeping(key, dec) ? housekeeping : readings).push(row);
    }

    const byLabel = (a: Row, b: Row): number => a.label.localeCompare(b.label);
    return { readings: readings.sort(byLabel), housekeeping: housekeeping.sort(byLabel) };
  }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

registerWidget('device_details', 'hc-device-details');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-details': HcDeviceDetails;
  }
}
