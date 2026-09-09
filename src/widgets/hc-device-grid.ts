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
import type { CommandRequest } from '../core/widget.js';
import './hc-device-card.js';
import './hc-device-pill.js';
import './hc-media-card.js';
import { attachInspect } from './hold.js';
import { registerWidget, tagForDevice } from '../core/registry.js';

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
  /** Hold to inspect, without acting on it (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  /** Album art, for a set that happens to contain a media player (§19.4). */
  @property({ attribute: false }) onArt:
    ((deviceId: string) => Promise<string | undefined>) | undefined;

  /**
   * The type-specific elements, kept.
   *
   * These are built imperatively rather than from a template, and rebuilding
   * one on every render restarts whatever it was doing — with 184 devices on
   * the stream that is continuous. Keyed by device, which is what identifies
   * one here.
   */
  private readonly cells = new Map<string, HTMLElement>();
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
                .onDetails=${this.onDetails}
                .room=${this.context.room}
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
      // Compact in a set, always. A set's job is to show *many* devices, so a
      // row is the right unit: twelve generated control rows in one placement
      // put a colour wheel and three sliders in a 212px box, and the working
      // client's equivalent grid is tiles with a name, a state and a toggle.
      // The full card, with its generated controls, is for a placement that
      // names one device.
      return html`<hc-device-card
        .device=${d}
        .onCommand=${this.onCommand}
        .onDetails=${this.onDetails}
        .room=${this.context.room}
        compact
      ></hc-device-card>`;
    }
    const cached = this.cells.get(d.device_id);
    const el = (cached ?? document.createElement(tag)) as HTMLElement & {
      device?: DeviceState;
      onCommand?: (r: CommandRequest) => void;
      onArt?: (deviceId: string) => Promise<string | undefined>;
      row?: boolean;
      nested?: boolean;
    };
    if (cached === undefined) {
      this.cells.set(d.device_id, el);
      // The gesture is the host's, not the widget's (§5.10): a type-specific
      // card written by anyone — us today, an extension later — gets hold to
      // inspect without having implemented it, and cannot decline to have it.
      attachInspect(el, () => this.onDetails?.(d.device_id));
    }
    el.device = d;

    // **It is in a set, and has to be told.** The generic card is handed
    // `compact` a few lines up; a type-specific one built on `HcLayoutShell`
    // takes `row` for the same fact. Without it a fan drew a full 123px card
    // in a column of 52px rows: the right content, visibly not part of the
    // list.
    //
    // Set on every widget rather than only on shell-derived ones. A widget
    // that does not know the name ignores it, which is the contract `compact`
    // already relies on, and an extension that *does* honour it then fits a
    // set without having been told this rule exists.
    //
    // **`nested` is deliberately not set.** §5.5 suppresses chrome for a
    // widget inside a *container*, so two borders do not stack. A device set
    // is not that: it draws a column of rows, and the row's own surface is
    // what makes it read as one. Setting it left the presence rows
    // transparent between two rows that were not — the same "widgets escaping
    // their placement" look that gave the card a surface in the first place.
    el.row = this.mode === 'list';

    if (this.onCommand !== undefined) el.onCommand = this.onCommand;
    // A type-specific card gets what the host gave the set. The media card
    // needs the art callback, and a set that kept it drew a player with no
    // cover for no reason a person could see.
    if (this.onArt !== undefined) el.onArt = this.onArt;
    return el;
  }
}

registerWidget('device_grid', 'hc-device-grid');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-grid': HcDeviceGrid;
  }
}
