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

/**
 * Rows whose labels collide, told apart by the key underneath them.
 *
 * **Two attributes can carry one name, and the plugin is where it comes
 * from.** The office fan publishes `speed` and `speed_pct` and *declares*
 * `display_name: "Speed"` for both — so this is not an artifact of inferring a
 * label, it is the plugin's own answer, twice. The sheet listed "Speed — off"
 * above "Speed — 0%" and left a person to guess which was which, or whether
 * the device was contradicting itself.
 *
 * The declaration is still honoured; the key is added only where honouring it
 * leaves two rows indistinguishable. Putting a raw key beside every reading
 * would be noise for the sake of the rare pair, and second-guessing a plugin
 * that named its attributes clearly would be worse.
 */
function named(rows: Row[]): Row[] {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.label, (seen.get(r.label) ?? 0) + 1);
  return rows.map((r) =>
    (seen.get(r.label) ?? 0) > 1 ? { ...r, label: `${r.label} (${r.key})` } : r,
  );
}

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
      min-width: 0;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    /* **The device's own header, and the only one.** The panel it opens in
       draws no title bar of its own, so this is the top of the sheet rather
       than a heading under an empty band. */
    .head {
      display: grid;
      gap: 0.2rem;
      /* Room for the close button, which floats in the corner. */
      padding-right: 2.25rem;
    }
    .name {
      font-size: var(--hc-text-subtitle-size, 15px);
      font-weight: 600;
      line-height: 1.2;
    }
    .where {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    /* The headline: what this device is doing, in the largest type here, with
       the name of the reading beside it rather than under it. */
    /* **The headline, not a poster.** This was display size — 34px of "Off"
       over a panel 500px wide — which is the scale a room page uses for the
       one number somebody reads from across the room, not the scale of a
       sheet somebody has already opened and is standing in front of. */
    .lead {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      font-size: var(--hc-text-title-size, 20px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1.15;
      letter-spacing: -0.01em;
    }
    .lead .of {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .note,
    .offline {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .offline {
      color: var(--hc-status-warn, #ffc861);
    }
    /* Sections are separated by air first and a line second. They were
       0.75rem apart with a rule between each, which at this density is a
       stack of boxes rather than a document. */
    section {
      display: grid;
      min-width: 0;
      gap: 0.35rem;
      padding-top: 0.7rem;
      margin-top: 0.1rem;
      border-top: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    h3 {
      margin: 0;
      font-size: var(--hc-text-caption-size, 11px);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
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
      min-height: 26px;
      padding: 0 0.4rem;
      border-radius: var(--hc-radius-sm, 8px);
      font-size: var(--hc-text-body-small-size, 12.5px);
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
      font-weight: 500;
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
    /* The two fields are one pair of questions, so they line up as one pair:
       the same label column, the same field height, the same box. They were a
       flex row each, so the select and the input started at different xs and
       the input was 44px tall against a 30px menu beside it. */
    /* **A field is as wide as what goes in it.** "Office" in a box the width
       of the sheet is a text input pretending to be a form. */
    .hint {
      display: grid;
      /* Both tracks floored at zero. A bare 1fr is still floored at the
         content's min-content width, so a select with a long option in it
         pushed the panel wider than itself and put a scrollbar under the
         whole sheet. */
      grid-template-columns: minmax(0, 4.5rem) minmax(0, max-content);
      align-items: center;
      gap: 0.75rem;
      min-height: 1.9rem;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
    }
    .hint input,
    .hint select {
      width: auto;
      min-width: 10rem;
      max-width: 100%;
      /* Border-box, or the 100% is 100% *plus* the padding and the border —
         which came to 21px of a field hanging out of the panel and a scrollbar
         under the whole sheet. */
      box-sizing: border-box;
      min-height: 1.9rem;
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0 0.5rem;
      font: inherit;
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .hint input:focus-visible,
    .hint select:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
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

  /**
   * The rest of the house, for the rooms it already has.
   *
   * The host sets this on every widget. Deriving the room list from it rather
   * than fetching `/areas` is not a shortcut: an area *is* the set of devices
   * assigned to it, so the two answers are the same one, and this one cannot
   * be stale relative to what is on screen.
   */
  @property({ attribute: false }) devices: readonly DeviceState[] = [];

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

  /**
   * Which room this device is in.
   *
   * Higher stakes than the hint, and quieter about it: every room page selects
   * with `area_name: "@room"`, so a device in the wrong room is not wrong —
   * it is *absent*, on the one page somebody would look for it.
   *
   * **A combo rather than a select**, because a room that has no devices yet
   * does not exist: an area is the set of devices assigned to it, so the first
   * device moved into a new room is what creates it. A select could never
   * offer that room, and a plain text field would make somebody retype a room
   * that already exists and misspell it.
   *
   * The text is sent as typed and core normalises it — "Front Porch" and
   * "front_porch" are the same room to `normalize_area_name`, so the list can
   * show words a person reads without the value having to be a slug.
   */
  private renderArea(d: DeviceState) {
    if (this.onUpdateDevice === undefined) return nothing;
    if (this.scopes !== undefined && !this.scopes.includes('devices:write')) return nothing;

    const rooms = [
      ...new Set(
        this.devices
          .map((other) => effectiveArea(other))
          .filter((a): a is string => typeof a === 'string' && a !== ''),
      ),
    ].sort();

    return html`<label class="hint" part="controls">
      <span part="heading">Room</span>
      <input
        part="select"
        list="hc-rooms"
        .value=${humanise(effectiveArea(d) ?? '')}
        placeholder=${d.area === null || d.area === undefined ? 'no room' : humanise(d.area)}
        ?disabled=${this.saving}
        @change=${(e: Event) => void this.setArea(d, (e.target as HTMLInputElement).value)}
      />
      <datalist id="hc-rooms">
        ${rooms.map((r) => html`<option value=${humanise(r)}></option>`)}
      </datalist>
    </label>`;
  }

  private async setArea(d: DeviceState, area: string): Promise<void> {
    this.saving = true;
    this.trouble = '';
    try {
      // Empty clears the override, handing the device back to whatever the
      // bridge says — which is what core does with `null` and what the
      // placeholder promises by showing the plugin's own answer.
      await this.onUpdateDevice?.(d.device_id, { area: area.trim() === '' ? null : area });
    } catch (e) {
      this.trouble = e instanceof Error ? e.message : String(e);
    } finally {
      this.saving = false;
    }
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
    // Everything it reports except the one already in the headline.
    const reported = rows.readings.filter((r) => r.key !== lead?.key);
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
        // **Once.** The lead already says it in the largest type on the sheet,
        // and a switch was reading "Off" as its headline, "Off" again as a
        // note, and "Power — Off" a third time under Reports. A device panel
        // that repeats itself three times reads as three different facts that
        // happen to agree.
        power === undefined || lead !== undefined
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
                layout="panel"
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
      ${
        // **A heading over nothing is worse than the repetition it replaced.**
        // Taking the lead reading out of this list empties it for any device
        // whose whole vocabulary is the one thing it leads with — a switch —
        // and the sheet drew "REPORTS" and a rule over empty space. A section
        // with nothing in it is not a section.
        reported.length === 0 && rows.housekeeping.length === 0
          ? nothing
          : html`<section part="section">
              <h3 part="heading">Reports</h3>
              ${
                reported.length === 0
                  ? nothing
                  : html`<div class="rows">${reported.map((r) => this.row(r, charted))}</div>`
              }
              ${
                rows.housekeeping.length === 0
                  ? nothing
                  : html`<details>
                      <summary>
                        ${rows.housekeeping.length} more the plugin called housekeeping
                      </summary>
                      <div class="rows">${rows.housekeeping.map((r) => this.row(r, charted))}</div>
                    </details>`
              }
            </section>`
      }
      ${
        // **Last, because these are settings and everything above is state.**
        // They sat under the header first, which pushed the reading and the
        // controls down the sheet — so opening a lamp to turn it off began
        // with two questions about how to file it. Somebody corrects a room
        // once; they read the state every time.
        this.renderHint(d) === nothing && this.renderArea(d) === nothing
          ? nothing
          : html`<section part="section">
              <h3 part="heading">How this is filed</h3>
              ${this.renderHint(d)} ${this.renderArea(d)}
            </section>`
      }
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
    return {
      readings: named(readings).sort(byLabel),
      housekeeping: named(housekeeping).sort(byLabel),
    };
  }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

registerWidget('device_details', 'hc-device-details');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-details': HcDeviceDetails;
  }
}
