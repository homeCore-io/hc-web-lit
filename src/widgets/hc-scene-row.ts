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
import { effectiveName, isOn } from '../core/present.js';
import { noStatusReason } from '../core/present.js';
import { scenesInScope, sceneKind } from '../core/scenes.js';
import type { CommandRequest } from '../core/widget.js';
import { icon } from '../design/icons.js';
import { registerWidget } from '../core/registry.js';

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
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.5) 0 calc(var(--hc-space-unit, 8px) * 0.75);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      transition:
        background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
        border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    button:hover {
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 40%, transparent);
    }
    .tile {
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink-muted, #8b95a4);
      transition: inherit;
    }
    .tile svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* Only a scene that can say. A momentary one never gets this, because it
       has no state to be in.

       A wash and a lit mark rather than a solid fill: an applied scene is a
       state the house is in, and a slab of accent reads as the primary button
       on the page — which is a different claim. */
    button[aria-pressed='true'] {
      background: color-mix(in srgb, var(--hc-accent-active, #ffb661) 18%, transparent);
      border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 55%, transparent);
    }
    button[aria-pressed='true'] .tile {
      background: color-mix(in srgb, var(--hc-accent-active, #ffb661) 22%, transparent);
      color: var(--hc-accent-active, #ffb661);
    }
    /* A momentary scene changes nothing a client can see, so the tap has to
       answer for itself — 45 of the 58 scenes in the reference house report
       nothing at all, and a button that looks identical after being pressed
       reads as broken. */
    button[data-fired] .tile {
      background: var(--hc-accent-active, #ffb661);
      color: var(--hc-accent-on-primary, #06131f);
      transition: none;
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

  /** The scene just fired, for as long as the acknowledgment lasts. */
  @state() private fired: string | undefined;

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
      title=${noStatusReason(scene) ?? nothing}
      aria-pressed=${stateful ? String(applied) : nothing}
      ?data-fired=${this.fired === scene.device_id}
      @click=${(e: Event) => this.activate(e, scene)}
    >
      <span class="tile" part="indicator">${icon('scene')}</span>
      ${effectiveName(scene)}
    </button>`;
  }

  /**
   * Fire it, and say so.
   *
   * A stateful scene answers on the event stream a moment later. A momentary
   * one never answers — there is nothing to answer with — so the acknowledgment
   * is the client's job, and it is deliberately brief: this says "sent", not
   * "on", because the second would be a claim about the house.
   */
  private activate(_e: Event, scene: DeviceState): void {
    this.onCommand?.(activation(scene));
    this.fired = scene.device_id;
    globalThis.setTimeout(() => {
      if (this.fired === scene.device_id) this.fired = undefined;
    }, 700);
  }
}

/**
 * How to apply a scene: **the action it declares.**
 *
 * Every scene in the reference house now declares `activate`, which is the
 * model — applying a scene is a thing you do, and a scene does not
 * meaningfully turn off. The `on: true` write is kept only for a plugin that
 * has not restarted since the upgrade and still declares nothing.
 */
function activation(scene: DeviceState): CommandRequest {
  const declared = (scene.schema?.actions ?? []).find((a) => a.id === 'activate');
  if (declared !== undefined) {
    return { deviceId: scene.device_id, action: { id: declared.id, params: {} } };
  }
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
