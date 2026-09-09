/**
 * `scene_button` — one scene, placeable on its own (§7.3).
 *
 * Core declares this type, which settles a question the shell migration
 * raised: is a scene a *widget* or a row inside one? The vocabulary answers —
 * `scene_button` takes a `scene_id`, so a scene is a thing you can put on a
 * page by itself, and `scene_row` is a set that composes it.
 *
 * **Two kinds of scene, one widget** (§7.3). Activating a scene is a device
 * action, and a scene does not meaningfully turn off — but how one reports
 * itself afterwards differs, and both are drawn here. Lutron marks some scenes
 * on so a client can tell which is applied; 13 of the 58 in the reference
 * house report nothing at all, and drawing those as "Off" says a thing about
 * the house that nobody knows.
 */
import { css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { activation, sceneKind } from '../core/scenes.js';
import { noStatusReason } from '../core/present.js';
import { effectiveName, isOn } from '../core/present.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import { icon } from '../design/icons.js';
import { HcLayoutShell } from '../sdk/shell.js';

@customElement('hc-scene-button')
export class HcSceneButton extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      :host {
        display: inline-block;
      }
      .shell {
        border-radius: var(--hc-radius-pill, 999px);
        padding: 0 calc(var(--hc-space-unit, 8px) * 1.5) 0 calc(var(--hc-space-unit, 8px) * 0.75);
        gap: 0.5rem;
        cursor: pointer;
        background: color-mix(
          in srgb,
          var(--hc-shell-colour) var(--hc-shell-tint),
          var(--hc-surface-raised, #141922)
        );
        transition:
          background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
          border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
      }
      .shell:hover {
        border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 40%, transparent);
      }
      /* A wash and a lit mark rather than a solid fill: an applied scene is a
         state the house is in, and a slab of accent reads as the primary
         button on the page — which is a different claim. */
      :host([data-applied]) .shell {
        border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 55%, transparent);
      }
      :host(:focus-visible) {
        outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
        outline-offset: 2px;
      }
      .tile {
        width: 1.75rem;
        height: 1.75rem;
        border-radius: var(--hc-radius-pill, 999px);
      }
      .tile svg {
        width: 1rem;
        height: 1rem;
      }
      .primary {
        font-weight: 500;
      }
      /* A momentary scene changes nothing a client can see, so the tap has to
         answer for itself — 13 of the 58 scenes here report nothing at all,
         and a button that looks identical after being pressed reads as
         broken. */
      :host([data-fired]) .tile {
        background: var(--hc-accent-active, #ffb661);
        color: var(--hc-accent-on-primary, #06131f);
        transition: none;
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** The scene just fired, for as long as the acknowledgment lasts. */
  @state() private fired = false;

  override firstUpdated(): void {
    this.setAttribute('role', 'button');
    this.tabIndex = 0;
    this.addEventListener('click', () => this.activate());
    this.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.activate();
    });
  }

  override willUpdate(): void {
    this.row = true;
  }

  override updated(): void {
    super.updated();
    const d = this.device;
    const applied = d !== undefined && sceneKind(d) === 'stateful' && isOn(d) === true;

    this.toggleAttribute('data-applied', applied);
    this.toggleAttribute('data-fired', this.fired);
    if (d !== undefined) {
      const reason = noStatusReason(d);
      if (reason !== undefined) this.title = reason;
      // Only a scene that can say. A momentary one never gets a pressed state,
      // because it has no state to be in.
      if (sceneKind(d) === 'stateful') this.setAttribute('aria-pressed', String(applied));
      else this.removeAttribute('aria-pressed');
    }
    this.style.setProperty('--hc-shell-colour', 'var(--hc-accent-active, #ffb661)');
    this.style.setProperty('--hc-shell-tint', applied ? '18%' : '0%');
  }

  protected override renderIcon() {
    return icon('scene');
  }

  protected override renderPrimary(): unknown {
    const d = this.device;
    const label = this.config['label'];
    if (typeof label === 'string' && label !== '') return label;
    return d === undefined ? '' : effectiveName(d);
  }

  protected override renderBadge(): unknown {
    return nothing;
  }

  /**
   * Fire it, and say so.
   *
   * A stateful scene answers on the event stream a moment later. A momentary
   * one never answers — there is nothing to answer with — so the
   * acknowledgment is the client's job, and it is deliberately brief: this
   * says "sent", not "on", because the second would be a claim about the
   * house.
   */
  private activate(): void {
    const d = this.device;
    if (d === undefined) return;
    this.onCommand?.(activation(d));
    this.fired = true;
    globalThis.setTimeout(() => {
      this.fired = false;
    }, 700);
  }
}

registerWidget('scene_button', 'hc-scene-button');

// A set of scenes draws these rather than generic cards: a scene is activated
// rather than switched, and a card offering a toggle would be offering to turn
// off something that does not turn off (§7.3).
registerForDevice('scene', 'hc-scene-button');

declare global {
  interface HTMLElementTagNameMap {
    'hc-scene-button': HcSceneButton;
  }
}
