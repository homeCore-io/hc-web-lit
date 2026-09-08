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
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName, isOn } from '../core/present.js';
import { scenesInScope, sceneKind } from '../core/scenes.js';
import type { CommandRequest } from './hc-controls.js';
import { registerWidget } from './registry.js';

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
    button {
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.5);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
      transition: background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    /* Only a scene that can say. A momentary one never gets this, because it
       has no state to be in. */
    button[aria-pressed='true'] {
      background: var(--hc-accent-active, #ffb661);
      color: var(--hc-accent-on-primary, #06131f);
      border-color: transparent;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) context: { room?: string } = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  override render() {
    const scenes = scenesInScope(this.config, this.devices, this.context.room);
    const heading = typeof this.config['heading'] === 'string' ? this.config['heading'] : undefined;

    if (scenes.length === 0) {
      // `hide_when_empty` is why a room page can carry a scene row for every
      // room and only show it where there are scenes.
      if (this.config['hide_when_empty'] === true) return nothing;
      return html`<div class="empty" part="empty">No scenes here.</div>`;
    }

    return html`
      ${heading !== undefined ? html`<h3 part="heading">${heading}</h3>` : nothing}
      <div class="row" part="row">${scenes.map((s) => this.chip(s))}</div>
    `;
  }

  private chip(scene: DeviceState) {
    const stateful = sceneKind(scene) === 'stateful';
    const applied = stateful && isOn(scene) === true;

    return html`<button
      part="scene"
      aria-pressed=${stateful ? String(applied) : nothing}
      @click=${() => this.onCommand?.(activation(scene))}
    >
      ${effectiveName(scene)}
    </button>`;
  }
}

/**
 * How to apply a scene — **best-effort, because nothing declares it yet.**
 *
 * No scene in the reference house publishes a schema at all (homeCore#28), so
 * neither branch here is reading a declaration; both read the shape. A scene
 * that publishes `on` is one whose plugin models it as a state, so writing
 * `on: true` is the request it is most likely to accept. One that publishes
 * nothing gets the `activate` action, which is the model the plugins are meant
 * to declare.
 *
 * When they do, this collapses to the action and the guessing stops.
 */
function activation(scene: DeviceState): CommandRequest {
  return typeof scene.attributes['on'] === 'boolean'
    ? { deviceId: scene.device_id, patch: { on: true } }
    : { deviceId: scene.device_id, action: { id: 'activate', params: {} } };
}

registerWidget('scene_row', 'hc-scene-row');

declare global {
  interface HTMLElementTagNameMap {
    'hc-scene-row': HcSceneRow;
  }
}
