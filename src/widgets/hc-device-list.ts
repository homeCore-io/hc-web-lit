/**
 * `device_list` — the same element as `device_grid`, in one column.
 *
 * A separate tag because the document names two types and core validates both;
 * the behaviour difference is a layout mode, not a different widget.
 */
import { customElement } from 'lit/decorators.js';
import { HcDeviceGrid } from './hc-device-grid.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-device-list')
export class HcDeviceList extends HcDeviceGrid {
  constructor() {
    super();
    this.mode = 'list';
  }
}

registerWidget('device_list', 'hc-device-list');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-list': HcDeviceList;
  }
}
