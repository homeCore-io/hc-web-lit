/**
 * A row of scenes.
 *
 * Activating one is a device *action*, not an attribute write — a scene is a
 * thing you do, and it does not meaningfully turn off. How it reports itself
 * afterwards is the other half: Lutron marks some scenes on so a row can show
 * which is applied; others report nothing at all, and 45 of the 58 scenes in
 * the reference house are that kind (§1.1). A chip for one of those shows no
 * state, because there is none.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { scenesInScope } from '../core/scenes.js';
import type { CommandRequest } from '../core/widget.js';
import { registerWidget } from '../core/registry.js';
import './hc-scene-button.js';

@customElement('hc-scene-row')
export class HcSceneRow extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    h3 {
      margin: 0 0 0.5rem;
      font-size: var(--hc-text-overline-size, 10px);
      font-weight: var(--hc-text-overline-weight, 600);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hc-ink-muted, #8b95a4);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--hc-space-unit, 8px) * 0.75);
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: { room?: string; picked?: string } = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** The scene just fired, for as long as the acknowledgment lasts. */
  @state() private fired: string | undefined;

  override render() {
    const scenes = scenesInScope(this.config, this.devices, this.context.room, this.context.picked);
    const heading = typeof this.config['heading'] === 'string' ? this.config['heading'] : undefined;

    if (scenes.length === 0) {
      // `hide_when_empty` is why a room page can carry a scene row for every
      // room and only show it where there are scenes.
      if (this.config['hide_when_empty'] === true) return nothing;
      return html`<div class="empty" part="empty">No scenes here.</div>`;
    }

    return html`
      ${heading !== undefined ? html`<h3 part="heading">${heading}</h3>` : nothing}
      <div class="row" part="row">
        ${scenes.map(
          (s) =>
            html`<hc-scene-button
              .device=${s}
              .config=${this.config}
              .onCommand=${this.onCommand}
            ></hc-scene-button>`,
        )}
      </div>
    `;
  }
}

registerWidget('scene_row', 'hc-scene-row');

declare global {
  interface HTMLElementTagNameMap {
    'hc-scene-row': HcSceneRow;
  }
}
