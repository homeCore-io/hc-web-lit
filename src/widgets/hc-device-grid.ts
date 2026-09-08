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
import { registerWidget } from './registry.js';

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

    return html`
      <div class=${this.mode === 'list' ? 'list' : 'grid'} part="set">
        ${chosen.map(
          (d) => html`<hc-device-card .device=${d} .onCommand=${this.onCommand}></hc-device-card>`,
        )}
      </div>
    `;
  }
}

registerWidget('device_grid', 'hc-device-grid');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-grid': HcDeviceGrid;
  }
}
