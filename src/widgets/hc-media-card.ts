/**
 * One media player, as a card in a set.
 *
 * The same curation `hc-media` does, for the case where a `device_grid` of
 * media players would otherwise draw a generic card with every control the
 * schema offers — 27 of them on a Roku, all real, and the card unusable (§7.2).
 *
 * Extends `hc-media` and shows exactly one device, so there is one place that
 * decides what a media player's controls are.
 */
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { HcMedia } from './hc-media.js';

@customElement('hc-media-card')
export class HcMediaCard extends HcMedia {
  /** Set by a device set, in place of a selection. */
  @property({ attribute: false }) device: DeviceState | undefined;

  override render() {
    // The parent selects from `devices` using `config`; here the host has
    // already chosen, so hand it exactly the one.
    this.devices = this.device === undefined ? [] : [this.device];
    this.config = { selection_mode: 'manual', device_ids: [this.device?.device_id ?? ''] };
    return super.render();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-media-card': HcMediaCard;
  }
}
