/**
 * `HcLayoutShell` — the one card structure (§7.2, §4.5).
 *
 * §7.2 draws it:
 *
 * ```
 * ┌─────────────────────────────────────────┐
 * │ [icon]  primary text            [badge] │
 * │         secondary text                  │
 * │ ─────────────────────────────────────── │
 * │ [ control row — domain specific       ] │
 * └─────────────────────────────────────────┘
 * ```
 *
 * Every Tier 1 widget is a thin specialisation of this, which is what makes
 * the type-specific ones small and `hc-device` the shell with nothing added.
 *
 * **Written after six widgets each grew their own.** The card, the pill, the
 * media player, the scene chip, the notice row and the extension all ended up
 * with a tinted tile, a name, a state and something trailing — six
 * arrangements of the same four parts, differing in the ways nobody chose.
 * That is what a page looks like when it is assembled rather than composed,
 * and it is the argument for a shell rather than a style guide: a guide is
 * followed when somebody remembers.
 *
 * **Its parts and custom properties are the styling contract** (§5.8, §19.7).
 * One shell means one set of hooks, so a theme reaches every widget including
 * ones nobody in this repo wrote — which is the whole reason card-mod does not
 * need to exist here.
 */
import { LitElement, css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { wantsChrome } from '../core/compose.js';

export abstract class HcLayoutShell extends LitElement {
  // Typed as a group so a specialisation can add its own beside these
  // rather than replacing them.
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      height: 100%;
      /* How lit the tile is, and in what. A widget sets these; the structure
         never decides what a state looks like. */
      --hc-shell-tint: 0%;
      --hc-shell-colour: var(--hc-ink-muted, #8b95a4);
      /* The chrome a shell draws around itself, as three hooks rather than
         three literals (§5.8, and they are ABI under §19.7).

         A card is an object and wants all three. **A row in a set is not an
         object** — the set is, and thirteen bordered boxes stacked in a column
         read as thirteen things when the point is one list. A container sets
         these to nothing on its children and provides the surface itself,
         which is a caller's decision about composition and not something a
         widget should be deciding from the inside.

         Custom properties cross the shadow boundary; a part does not. That is
         why this is a property and not a second row form. */
      --hc-shell-surface: var(--hc-surface-raised, #141922);
      --hc-shell-edge: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      --hc-shell-radius: var(--hc-radius-md, 14px);
    }
    /* **No containment here, at either level.** Inline-size containment
       removes an element's content-based intrinsic width, so a shell widget
       whose container sizes it *from its content* — a chip in a flex row —
       collapses to its padding. It was on the host first and every scene chip
       drew on top of the next one; moving it inward only moved the collapse
       inward with it. A widget that is always placed at a known width may
       declare a container on this box itself, which is what the pill does. */
    .shell {
      display: grid;
      grid-template-rows: auto auto;
      align-content: start;
      gap: 0.75rem;
      box-sizing: border-box;
      height: 100%;
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-shell-radius);
      border: var(--hc-shell-edge);
      background: var(--hc-shell-surface);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    /* Chrome belongs to the outermost widget only (§5.5). */
    :host([data-bare]) .shell {
      padding: 0;
      border: 0;
      background: transparent;
    }
    /* One line, for a set where thirteen rows are scanned rather than read. */
    :host([data-row]) .shell {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: var(--hc-density-row-height, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.25);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
      flex: 1 1 auto;
    }
    /* **The mark carries the state; it does not sit on a slab that does.**
       The tile used to paint the shell tint of the state colour behind the
       glyph, so every lit device on a page was a filled block of accent — and
       on a room page that is most of the rows at once. The household's word
       for the result was that the amber is overused, and they were reading a
       page where the accent had stopped meaning anything because it was
       everywhere.

       So the tile is a box the mark sits in and nothing else. A device that is
       on says so in the mark itself, which is the colour *and* the filled
       weight (§15.0) — two signals on the thing the state is about, and no
       paint on the row around it. The shell tint hook is untouched and still
       does what it always did for a caller that wants a wash; nothing in
       this client asks the tile for one any more. */
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      background: none;
      color: color-mix(in srgb, var(--hc-shell-colour) 85%, var(--hc-ink, #e9edf2));
      transition:
        background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out),
        color var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    .tile ::slotted(*),
    .tile svg {
      width: 1.125rem;
      height: 1.125rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* **A row's own control**, for the reason the working client has one: a
       list of switches you cannot switch is a list of labels. Here rather than
       in one widget, because the card and the pill draw the same switch and a
       second copy is the one that drifts — and an extension building a row
       gets it without being told (§7.2). Only the primary control belongs on a
       row; the rest of a schema is in the sheet behind a hold. */
    /* Sized to sit in a row rather than to lead it. At 2.75rem by 1.6 the
       switch was two thirds the height of a 38px row and the widest thing on
       it, so a list of five read as a column of switches with names beside
       them. */
    .switch {
      position: relative;
      flex: none;
      width: 2.25rem;
      height: 1.3rem;
      padding: 0;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      cursor: pointer;
      transition: background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    .switch[aria-pressed='true'] {
      background: var(--hc-accent-active, #ffb661);
      border-color: transparent;
    }
    .switch:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .switch:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .thumb {
      position: absolute;
      top: 50%;
      left: 0.175rem;
      width: 0.95rem;
      height: 0.95rem;
      border-radius: 50%;
      background: var(--hc-ink-muted, #8b95a4);
      transform: translate(0, -50%);
      transition: transform var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    .switch[aria-pressed='true'] .thumb {
      background: var(--hc-accent-on-primary, #06131f);
      transform: translate(0.95rem, -50%);
    }
    .lines {
      min-width: 0;
      display: grid;
      gap: 0.125rem;
      /* Basis auto, not zero. The one-value shorthand means a basis of zero,
         which contributes nothing to the container's intrinsic width — so a
         shell sized by its content came out as wide as its tile, and a row of
         scene chips was six circles with the labels overlapping. */
      flex: 1 1 auto;
    }
    .primary {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .secondary {
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* In a row the state sits at the far edge, where a column of them lines
       up; in a card it sits under the name, where there is room. */
    :host([data-row]) .lines {
      display: block;
    }
    :host([data-row]) .secondary {
      display: none;
    }
    .badge {
      flex: none;
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
      margin-left: 0.75rem;
    }
    .controls:empty {
      display: none;
    }
    :host([data-row]) .controls {
      flex: none;
    }
    .offline {
      opacity: 0.45;
    }
  `;

  /** A row in a set, or a card in a placement of its own. */
  @property({ type: Boolean, reflect: true, attribute: 'data-row' }) row = false;

  /** Inside a container, so no chrome of its own (§5.5). */
  @property({ attribute: false }) nested = false;

  /** The placement's config, for the chrome override. */
  @property({ attribute: false }) config: Record<string, unknown> = {};

  /** Dimmed, because the house cannot reach it. */
  @property({ type: Boolean }) offline = false;

  override updated(): void {
    this.toggleAttribute('data-bare', !wantsChrome(this.config, this.nested));
  }

  /** The mark, in a tile that carries the state. */
  protected abstract renderIcon(): TemplateResult | typeof nothing;

  /** What the thing is called. */
  protected abstract renderPrimary(): unknown;

  /** What it is doing, in words. */
  protected renderSecondary(): unknown {
    return nothing;
  }

  /** A number at the far edge: a level, a count, a reading. */
  protected renderBadge(): unknown {
    return nothing;
  }

  /** The control row — generated from the schema, or the widget's own. */
  protected renderControls(): unknown {
    return nothing;
  }

  override render() {
    const badge = this.renderBadge();

    // **In a row, the far edge is where the state goes.** The row form hides
    // `.secondary` because a column of rows reads down the left and across to
    // the right, and a state tucked under the name breaks both. That is right
    // for a widget with a badge — a level, a count, a reading — and it silently
    // erased the state of every widget without one: `hc-presence` in a device
    // list showed "Office Motion" and nothing else, having been told it was in
    // a set and having put its only state in the secondary.
    //
    // So the badge falls back to the secondary rather than the widget having to
    // know this rule. A widget that has both keeps both; one that has neither
    // shows neither. Here rather than in each widget, for the same reason the
    // shell exists at all: an extension gets it without being told (§7.2).
    const trailing = this.row && badge === nothing ? this.renderSecondary() : badge;

    return html`<div class="shell ${this.offline ? 'offline' : ''}" part="card">
      <div class="head" part="head">
        <span class="tile" part="indicator">${this.renderIcon()}</span>
        <span class="lines">
          <span class="primary" part="name">${this.renderPrimary()}</span>
          <span class="secondary" part="state">${this.renderSecondary()}</span>
        </span>
        <span class="badge" part="trailing">${trailing}</span>
      </div>
      <div class="controls" part="controls">${this.renderControls()}</div>
    </div>`;
  }
}
