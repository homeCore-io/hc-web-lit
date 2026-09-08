/**
 * A set of devices, drawn as a grid or a list.
 *
 * One element behind both `device_grid` and `device_list`: the difference is
 * how many columns, which is a `layout` value, not a different card type. Seven
 * `device_grid` and three `device_list` placements across the real dashboards
 * make this the most-used device widget in the house.
 *
 * Selection is `core/selection.ts` — core's declared vocabulary, not this
 * widget's idea of one — so the same config selects the same devices whichever
 * widget reads it.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { SelectionContext } from '../core/selection.js';
import { selectDevices } from '../core/selection.js';
import type { CommandRequest } from './hc-controls.js';
import './hc-device-card.js';
import './hc-device-pill.js';
import './hc-media-card.js';
import { registerWidget, tagForDevice } from './registry.js';

@customElement('hc-device-grid')
export class HcDeviceGrid extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .grid {
      display: grid;
      gap: calc(var(--hc-space-unit, 8px));
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    }
    .list {
      display: grid;
      gap: calc(var(--hc-space-unit, 8px) * 0.5);
      grid-template-columns: 1fr;
    }
    /* One row, filling the height it was given. The room page asks for these
       in a 44px placement, which is a pill and not a card. */
    .pills {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: calc(var(--hc-space-unit, 8px) * 0.75);
      height: 100%;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
      padding: 0.5rem 0;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: SelectionContext = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  /** `picks: true` — the row aims the controls beside it at what you touch. */
  @property({ attribute: false }) onPick: ((deviceId: string) => void) | undefined;
  /** `grid` packs columns; `list` is one per row. */
  @property({ type: String }) mode: 'grid' | 'list' = 'grid';

  override render() {
    const chosen = selectDevices(this.config, this.devices, this.context);

    if (chosen.length === 0) {
      // Named, because an empty set is usually a selection that matched nothing
      // rather than a house with nothing in it, and the difference is what a
      // person needs to know.
      return html`<div class="empty" part="empty">
        No devices match this
        selection${
          this.config['area_name'] !== undefined
            ? html` in ${String(this.config['area_name'])}`
            : nothing
        }.
      </div>`;
    }

    // `layout` is core's, and "pills" is what the room page's lights row asks
    // for. Ignoring it drew 64px cards into a 44px placement, which shows the
    // top half of a name and reads as broken.
    if (this.config['layout'] === 'pills') {
      return html`
        <div class="pills" part="set">
          ${chosen.map(
            (d) =>
              html`<hc-device-pill
                .device=${d}
                .picked=${this.context.picked === d.device_id}
                .onPick=${this.onPick}
              ></hc-device-pill>`,
          )}
        </div>
      `;
    }

    return html`
      <div class=${this.mode === 'list' ? 'list' : 'grid'} part="set">
        ${chosen.map((d) => this.cardFor(d))}
      </div>
    `;
  }

  /**
   * The element that draws one device in a set.
   *
   * A type-specific widget when the registry has one, because the generic card
   * builds its controls from the schema and a Roku's schema is 34 actions long
   * — every control real, and the card unusable (§7.2). Otherwise the generic
   * card, which is the base case rather than a fallback: three devices in the
   * reference house declare no type at all.
   */
  private cardFor(d: DeviceState) {
    const tag = tagForDevice(d);
    if (tag === undefined) {
      return html`<hc-device-card
        .device=${d}
        .onCommand=${this.onCommand}
        ?compact=${this.mode === 'list'}
      ></hc-device-card>`;
    }
    const el = document.createElement(tag) as HTMLElement & {
      device?: DeviceState;
      onCommand?: (r: CommandRequest) => void;
    };
    el.device = d;
    if (this.onCommand !== undefined) el.onCommand = this.onCommand;
    return el;
  }
}

registerWidget('device_grid', 'hc-device-grid');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-grid': HcDeviceGrid;
  }
}
