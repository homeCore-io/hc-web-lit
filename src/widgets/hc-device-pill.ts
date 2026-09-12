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
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
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
        /* **A capsule, and no containment.** Both used to be the other way
           round: the pills were laid out as equal columns of one strip, so the
           width came from the container and an inline-size container query
           could hide the level when it got tight. Side by side as objects, the
           width comes from the content — and inline-size containment removes
           the content-based intrinsic width, which collapses the chip to its
           padding (the shell says so at length). The level never has to be
           hidden now, because nothing is being squeezed into a quarter of a
           row. */
        border-radius: var(--hc-radius-pill, 999px);
        padding: 0 calc(var(--hc-space-unit, 8px) * 1.5) 0 calc(var(--hc-space-unit, 8px) * 0.75);
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
      /* **Picked is not lit, so it is not the same colour.** Both were accent,
         which asked one amber to mean "this light is on" and "this is the one
         the sliders are aimed at" in the same row — and where one light is on
         and a different one is picked, the two readings are in conflict.

         Ink, not another accent. The obvious answer was the primary or the
         focus colour, and in this household's skin all three of active,
         primary and focus resolve to the same #FFB661 — which is most of why
         a room page reads as amber everywhere. A selection is not a state of
         the house; a bright ring says "this one" without spending the colour
         that means a device is on. */
      :host([data-picked]) .shell {
        border-color: var(--hc-ink, #e9edf2);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--hc-ink, #e9edf2) 45%, transparent);
      }
      :host(:focus-visible) {
        outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
        outline-offset: 2px;
      }
      .tile {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: var(--hc-radius-pill, 999px);
        background: var(--hc-surface-sunken, #0d1116);
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
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--hc-text-caption-size, 11px);
      }
      .state {
        color: var(--hc-ink-muted, #8b95a4);
        white-space: nowrap;
      }
      /* Smaller than a row's, because a pill is a chip and its switch should
         not be the largest thing on it. */
      .switch {
        width: 2.1rem;
        height: 1.25rem;
      }
      .thumb {
        width: 0.9rem;
        height: 0.9rem;
      }
      .switch[aria-pressed='true'] .thumb {
        transform: translate(0.82rem, -50%);
      }
      :host([data-lit]) .state {
        color: var(--hc-ink, #e9edf2);
      }
      .primary {
        white-space: nowrap;
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ type: Boolean }) picked = false;
  /**
   * Switching the light, which is separate from aiming at it.
   *
   * **A list of switches you cannot switch is a list of labels.** The pill
   * reported the pick and nothing else, so the only way to turn the desk lamp
   * on from the room page was to find it again further down the page — while
   * the same device drawn as a row in any set below had a switch on it. The
   * body still picks; the switch is its own target and stops there.
   */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** Held until the house confirms, like every other control here. */
  @state() private pending: boolean | undefined;
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
    // A tap on a pill aims the controls below it — the page says so in words
    // right there — so only the hold opens the sheet here.
    attachInspect(
      this,
      () => {
        const id = this.device?.device_id;
        if (id !== undefined) this.onDetails?.(id);
      },
      { tap: false },
    );
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Always a row: a chip is one line by definition.
    this.row = true;
    // The switch is held until the house answers, like every other control.
    if (changed.has('device')) this.pending = undefined;
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
    return icon(iconFor(this.device), this.device !== undefined && isOn(this.device) === true);
  }

  protected override renderPrimary(): unknown {
    const d = this.device;
    return d === undefined ? '' : withoutRoom(effectiveName(d), this.room);
  }

  /**
   * The level when it is on, the word "off" when it is not, and the switch.
   *
   * **Off used to say nothing at all.** A pill for a lamp that is off was a
   * name in a box, indistinguishable at a glance from a label — and with the
   * switch beside it now, the word is what tells you the switch is off rather
   * than the pill being inert.
   */
  protected override renderBadge(): unknown {
    const d = this.device;
    if (d === undefined) return nothing;
    const on = this.pending ?? isOn(d);
    const level = levelOf(d);
    const word = on === true ? (level === undefined ? nothing : `${Math.round(level)}%`) : 'off';
    const next = !(on ?? false);

    return html`<span class="state">${word}</span>
      <button
        class="switch"
        part="toggle"
        role="switch"
        aria-pressed=${String(on ?? false)}
        aria-label=${`${effectiveName(d)} power`}
        ?disabled=${this.onCommand === undefined}
        @click=${(e: Event) => {
          // The pill is tapped to pick and held to inspect; the switch is its
          // own target and must do neither as well.
          e.stopPropagation();
          this.pending = next;
          this.onCommand?.({ deviceId: d.device_id, patch: { on: next } });
        }}
      >
        <span class="thumb"></span>
      </button>`;
  }
}

registerWidget('device_pill', 'hc-device-pill');

declare global {
  interface HTMLElementTagNameMap {
    'hc-device-pill': HcDevicePill;
  }
}
