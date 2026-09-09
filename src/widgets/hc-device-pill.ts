/**
 * A device as a pill — name and on-ness, one line, in a 44px row.
 *
 * `layout: "pills"` on a `device_grid`, which is what the room page's lights
 * row asks for and what its 44px placement requires. A card is 64px of padding
 * and two lines; drawing one there shows the top half of a name and reads as
 * broken. The document said how to draw it.
 *
 * Tapping is a `picks: true` concern — the row aims the colour wheel and
 * sliders beside it at whichever light you touched — so the pill reports the
 * pick rather than commanding anything.
 */
import { css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName, isOn, levelOf } from '../core/present.js';
import { HcLayoutShell } from '../sdk/shell.js';
import { attachInspect } from './hold.js';
import { withoutRoom } from '../core/text.js';
import { icon, iconFor } from '../design/icons.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-device-pill')
export class HcDevicePill extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      :host {
        display: inline-block;
        min-width: 0;
      }
      /* A chip, not a card: the pill radius and a tighter tile are the whole
         difference, which is the shell earning its place — a different
         silhouette rather than a different structure. */
      .shell {
        /* Safe here, and only here: a pill is laid out in a grid of explicit
           columns, so its width comes from its container rather than from its
           content, and containment costs it nothing (see the shell). */
        container-type: inline-size;
        border-radius: var(--hc-radius-md, 14px);
        padding: 0 calc(var(--hc-space-unit, 8px));
        gap: 0.5rem;
        cursor: pointer;
        background: color-mix(
          in srgb,
          var(--hc-shell-colour) calc(var(--hc-shell-tint) / 2),
          var(--hc-surface-raised, #141922)
        );
        transition:
          background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
          border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
      }
      .shell:hover {
        border-color: color-mix(in srgb, var(--hc-shell-colour) 40%, transparent);
      }
      /* Picked is what the sliders below are aimed at, so it is a stronger
         statement than lit — a ring rather than a wash. */
      :host([data-picked]) .shell {
        border-color: var(--hc-accent-active, #ffb661);
        box-shadow: 0 0 0 1px var(--hc-accent-active, #ffb661);
      }
      :host(:focus-visible) {
        outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
        outline-offset: 2px;
      }
      .tile {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: var(--hc-radius-xs, 6px);
      }
      .tile svg {
        width: 1rem;
        height: 1rem;
      }
      .primary {
        font-weight: 500;
      }
      /* A chip is tighter than a card: the shell's card spacing costs about
         twelve pixels here, which is a whole word at this width. */
      .head {
        gap: 0.5rem;
      }
      .badge {
        margin-left: 0.375rem;
      }
      .badge {
        font-size: var(--hc-text-caption-size, 11px);
      }
      :host([data-lit]) .badge {
        color: var(--hc-ink, #e9edf2);
      }
      /* Four lights share one 44px row, so a narrow chip spends its width on
         the name. The level is not lost — the chip's own tint carries it. */
      @container (max-width: 11rem) {
        .badge {
          display: none;
        }
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ type: Boolean }) picked = false;
  @property({ attribute: false }) onPick: ((deviceId: string) => void) | undefined;
  /** Hold to inspect, without acting on it (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;
  /** The room this pill is shown in, if the page is scoped to one. */
  @property({ attribute: false }) room: string | undefined;

  override firstUpdated(): void {
    // A chip reports what was touched, so it behaves like a button — but the
    // shell owns the markup, so the role goes on the host.
    this.setAttribute('role', 'button');
    this.tabIndex = 0;
    this.addEventListener('click', () => {
      const id = this.device?.device_id;
      if (id !== undefined) this.onPick?.(id);
    });
    this.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const id = this.device?.device_id;
      if (id !== undefined) this.onPick?.(id);
    });
    attachInspect(this, () => {
      const id = this.device?.device_id;
      if (id !== undefined) this.onDetails?.(id);
    });
  }

  override willUpdate(): void {
    // Always a row: a chip is one line by definition.
    this.row = true;
  }

  override updated(): void {
    super.updated();
    const d = this.device;
    const lit = d !== undefined && isOn(d) === true;
    const level = d === undefined ? undefined : levelOf(d);

    this.toggleAttribute('data-lit', lit);
    this.toggleAttribute('data-picked', this.picked);
    // The chip carries the light's own level: 14% at the bottom of the dimmer,
    // 32% at the top. A row of these reads as a room at a glance, which a row
    // of identical rectangles with a dot on them never did.
    this.style.setProperty(
      '--hc-shell-colour',
      lit ? 'var(--hc-accent-active, #ffb661)' : 'var(--hc-ink-muted, #8b95a4)',
    );
    this.style.setProperty(
      '--hc-shell-tint',
      lit ? `${14 + Math.round((Math.min(level ?? 100, 100) / 100) * 18)}%` : '0%',
    );
  }

  protected override renderIcon() {
    return icon(iconFor(this.device));
  }

  protected override renderPrimary(): unknown {
    const d = this.device;
    return d === undefined ? '' : withoutRoom(effectiveName(d), this.room);
  }

  protected override renderBadge(): unknown {
    const d = this.device;
    if (d === undefined || isOn(d) !== true) return nothing;
    const level = levelOf(d);
    return level === undefined ? nothing : `${Math.round(level)}%`;
  }
}

registerWidget('device_pill', 'hc-device-pill');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-pill': HcDevicePill;
  }
}
