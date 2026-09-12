/**
 * A timer — `timer` (§7.3).
 *
 * §7.3 says "remaining, start / pause / reset". The house says otherwise: all
 * four timers declare **no writable attributes and no actions**, so there is
 * nothing to start or reset from here and offering buttons would be offering
 * to do something the plugin never said it could. A timer is a reading, and
 * this draws the reading.
 *
 * **The reading changes every second, which nothing else here does.**
 * `remaining_secs` is a snapshot from whenever the device last spoke, so a
 * card showing it verbatim sits at 4:12 for a minute and then jumps. The
 * countdown is computed from `started_at` and `duration_secs` — both declared
 * — and ticks locally between pushes, reconciling whenever the house speaks.
 * That is not inventing a fact: it is reading the clock the device gave.
 */
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { clock } from '../core/media.js';
import { effectiveName } from '../core/present.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';
import { icon } from '../design/icons.js';
import { HcLayoutShell } from '../sdk/shell.js';

@customElement('hc-timer')
export class HcTimer extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      .badge {
        font-size: var(--hc-text-subtitle-size, 16px);
        font-weight: 600;
        color: var(--hc-ink, #e9edf2);
      }
      .track {
        height: 4px;
        border-radius: var(--hc-radius-pill, 999px);
        background: var(--hc-surface-sunken, #0d1116);
        overflow: hidden;
      }
      .fill {
        display: block;
        height: 100%;
        border-radius: var(--hc-radius-pill, 999px);
        background: var(--hc-accent-active, #ffb661);
        transition: width 1s linear;
      }
      @media (prefers-reduced-motion: reduce) {
        /* The one duration in the product that is not a token: this is a
           second of real time being shown, not a UI flourish, so it cannot
           come off the motion scale. It still stops when somebody asks the
           machine for stillness — the bar jumps rather than sweeps. */
        .fill {
          transition: none;
        }
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;

  /** Re-rendered once a second while something is counting down. */
  @state() private tick = 0;

  private timer: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.timer = setInterval(() => {
      // Only while it is running: a finished timer that re-rendered every
      // second would keep a wall display busy for nothing.
      if (this.running()) this.tick = Date.now();
    }, 1000);
  }

  override disconnectedCallback(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    super.disconnectedCallback();
  }

  private running(): boolean {
    const s = this.device?.attributes['state'];
    return typeof s === 'string' && s.toLowerCase() === 'running';
  }

  /**
   * Seconds left, from the device's own clock.
   *
   * `started_at` plus `duration_secs` is when it ends, and the difference from
   * now is what is left — which keeps counting between pushes instead of
   * sitting still and then jumping.
   */
  private remaining(): number | undefined {
    const a = this.device?.attributes;
    if (a === undefined) return undefined;

    const duration = typeof a['duration_secs'] === 'number' ? a['duration_secs'] : undefined;
    const started = typeof a['started_at'] === 'string' ? Date.parse(a['started_at']) : NaN;

    if (this.running() && duration !== undefined && !Number.isNaN(started)) {
      const left = (started + duration * 1000 - Date.now()) / 1000;
      return Math.max(0, left);
    }
    // Not running, or the device gave no clock: whatever it last reported.
    return typeof a['remaining_secs'] === 'number' ? a['remaining_secs'] : undefined;
  }

  override updated(): void {
    super.updated();
    const d = this.device;
    this.offline = d !== undefined && !d.available;
    const on = this.running();
    this.style.setProperty(
      '--hc-shell-colour',
      on ? 'var(--hc-accent-active, #ffb661)' : 'var(--hc-ink-muted, #8b95a4)',
    );
    this.style.setProperty('--hc-shell-tint', on ? '20%' : '0%');
  }

  protected override renderIcon() {
    return icon('timer');
  }

  protected override renderPrimary(): unknown {
    const d = this.device;
    if (d === undefined) return '';
    // A timer's own `label` is what the rule that made it called it, which is
    // more specific than the device name it was registered under.
    const label = d.attributes['label'];
    return typeof label === 'string' && label !== '' ? label : effectiveName(d);
  }

  protected override renderSecondary(): unknown {
    const d = this.device;
    if (d === undefined) return nothing;
    const s = d.attributes['state'];
    return typeof s === 'string' ? humanise(s) : nothing;
  }

  protected override renderBadge(): unknown {
    const left = this.remaining();
    if (left === undefined) return nothing;
    return clock(left);
  }

  protected override renderControls(): unknown {
    // Nothing to control — the plugins declare no actions — so what fills the
    // space is how far through it is.
    const a = this.device?.attributes;
    const duration = typeof a?.['duration_secs'] === 'number' ? a['duration_secs'] : undefined;
    const left = this.remaining();
    if (this.row || duration === undefined || duration <= 0 || left === undefined) return nothing;

    const done = Math.min(1, Math.max(0, 1 - left / duration));
    return html`<span class="track" part="trailing"
      ><span class="fill" style="width:${done * 100}%"></span
    ></span>`;
  }
}

registerWidget('timer', 'hc-timer');
registerForDevice('timer', 'hc-timer');

declare global {
  interface HTMLElementTagNameMap {
    'hc-timer': HcTimer;
  }
}
