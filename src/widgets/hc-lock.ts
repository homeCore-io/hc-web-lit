/**
 * A lock — `lock` (§7.3, §11.3).
 *
 * The generic card gives a lock nothing to press, and correctly: its switch is
 * built from a writable `on`, and a lock's writable is `locked`. So the row
 * showed a state and no way to change it, which is the case §7.2 means by "a
 * type-specific widget overrides where it can do better".
 *
 * **It offers two buttons rather than a toggle, deliberately.** §11.3 is
 * blunt: locks never actuate from a plain tap, under any setting. A toggle is
 * a single gesture whose meaning depends on a state you may have misread; Lock
 * and Unlock are two gestures that each say what they do. The confirmation
 * itself is the host's — `safety.check` returns one for any `locked` write —
 * so this widget cannot skip it and neither can anything else.
 *
 * And it says when the *device* failed. A YoLink lock reports
 * `last_alert: "UnLockFailed"`, which is the house telling you something a
 * state alone cannot: the command was accepted and the bolt did not move.
 */
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { effectiveName } from '../core/present.js';
import { severityOf } from '../core/attention.js';
import { registerForCapability, registerForDevice, registerWidget } from '../core/registry.js';
import { isLockable } from '../core/capability.js';
import { humanise } from '../core/text.js';
import { icon } from '../design/icons.js';
import { HcLayoutShell } from '../sdk/shell.js';

@customElement('hc-lock')
export class HcLock extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      .buttons {
        display: flex;
        gap: 0.375rem;
      }
      button {
        min-height: var(--hc-density-min-tap, 44px);
        padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
        border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
        border-radius: var(--hc-radius-sm, 8px);
        background: var(--hc-surface-sunken, #0d1116);
        color: var(--hc-ink, #e9edf2);
        font: inherit;
        cursor: pointer;
      }
      button:hover:not(:disabled) {
        border-color: color-mix(in srgb, var(--hc-accent-active, #ffb661) 45%, transparent);
      }
      button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      button:focus-visible {
        outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
        outline-offset: 2px;
      }
      /* The house saying the bolt did not move. Louder than a state, because
         it is a thing that went wrong rather than a thing that is. */
      .alert {
        color: var(--hc-accent-warn, #ffc978);
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  private get locked(): boolean | undefined {
    const v = this.device?.attributes['locked'];
    return typeof v === 'boolean' ? v : undefined;
  }

  override updated(): void {
    super.updated();
    const d = this.device;
    this.offline = d !== undefined && !d.available;

    // Locked is the quiet state and unlocked is the one worth noticing, which
    // is the opposite of a lamp: the colour marks what needs attention rather
    // than what is on.
    // **The word says it too, not only the mark.** `worth_knowing` lists this
    // device as wanting attention and the row beside it said so in its icon
    // and nowhere else — the state read in the same ink as "Closed" on the
    // sensor next to it. `severityOf` is the one definition of what is worth
    // noticing (§15.0), so the row and the panel above it cannot disagree.
    const open = this.locked === false;
    const severity = d === undefined ? undefined : severityOf(d);
    if (severity === undefined) this.removeAttribute('data-severity');
    else this.setAttribute('data-severity', severity);
    this.style.setProperty(
      '--hc-shell-colour',
      open ? 'var(--hc-accent-warn, #ffc978)' : 'var(--hc-ink-muted, #8b95a4)',
    );
    this.style.setProperty('--hc-shell-tint', open ? '20%' : '0%');
  }

  protected override renderIcon() {
    return icon('lock');
  }

  protected override renderPrimary(): unknown {
    const d = this.device;
    return d === undefined ? '' : effectiveName(d);
  }

  protected override renderSecondary(): unknown {
    const d = this.device;
    if (d === undefined) return nothing;
    if (!d.available) return 'Offline';

    const alert = d.attributes['last_alert'];
    if (typeof alert === 'string' && /fail/i.test(alert)) {
      return html`<span class="alert">${humanise(alert)}</span>`;
    }
    const locked = this.locked;
    return locked === undefined ? nothing : locked ? 'Locked' : 'Unlocked';
  }

  protected override renderControls(): unknown {
    const d = this.device;
    if (d === undefined || this.row) return nothing;
    // Only where the device says its bolt is a state you can set. A lock whose
    // plugin publishes no schema is read-only here, which is ordinary.
    if (d.schema?.attributes?.['locked']?.writable !== true) return nothing;

    const locked = this.locked;
    return html`<div class="buttons">
      ${this.button(d, 'Lock', true, locked === true)}
      ${this.button(d, 'Unlock', false, locked === false)}
    </div>`;
  }

  private button(d: DeviceState, label: string, to: boolean, already: boolean) {
    return html`<button
      part="action"
      ?disabled=${this.onCommand === undefined || already}
      @click=${() => this.onCommand?.({ deviceId: d.device_id, patch: { locked: to } })}
    >
      ${label}
    </button>`;
  }
}

registerWidget('lock', 'hc-lock');
registerForDevice('lock', 'hc-lock');
// And whatever declares a writable `locked`, whatever it is called. The front
// door on this house reported `device_type: "zwave"` until a rescan
// re-registered it — for that whole time a name-based check drew it as a
// generic card, with a plain toggle on a door in its generated control row
// (§ capability.ts).
registerForCapability(isLockable, 'hc-lock');

declare global {
  interface HTMLElementTagNameMap {
    'hc-lock': HcLock;
  }
}
