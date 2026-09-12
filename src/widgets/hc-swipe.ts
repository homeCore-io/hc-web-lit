/**
 * `swipe` — pages side by side, one at a time (§5.5, §7.3).
 *
 * In Home Assistant this is swipe-card, a community card wrapping a
 * third-party carousel library. Here it is CSS.
 *
 * **Scroll snap, not a gesture handler.** `scroll-snap-type: x mandatory` gives
 * the whole behaviour to the platform: touch momentum that feels native
 * because it *is* native, trackpads, mouse wheels, keyboard scrolling, and a
 * scrollbar for anyone who wants one. A hand-written pointer handler has to
 * reimplement velocity, rubber-banding and cancellation, gets them slightly
 * wrong on one platform, and fights the browser for the same events. The
 * measurable difference on a wall tablet is that scroll snap runs on the
 * compositor and a JS gesture does not.
 *
 * **The dots are buttons, not decoration.** Somebody on a keyboard, or a
 * kiosk with no touchscreen, needs a way to reach page four; a row of `<div>`s
 * would leave them scrolling. They also say where you are, which a scroll
 * container alone does not.
 *
 * **Which page is showing is observed, not owned.** The scroll position is the
 * truth — a finger can move it without asking — so an `IntersectionObserver`
 * reports what is actually on screen rather than this element keeping a number
 * it hopes is right.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { childrenOf, gapOf } from '../core/compose.js';
import { mountChildren, type MountEnv } from '../shell/mount.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-swipe')
export class HcSwipe extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .swipe {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .track {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      /* A panel is not a document; a scrollbar across the middle of a
         dashboard is chrome nobody asked for. The dots say where you are. */
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
    }
    .track::-webkit-scrollbar {
      display: none;
    }
    .page {
      flex: 0 0 100%;
      min-width: 0;
      scroll-snap-align: start;
      scroll-snap-stop: always;
      overflow: auto;
    }
    .dots {
      display: flex;
      justify-content: center;
      gap: 0.375rem;
      padding: 0.5rem 0 0;
    }
    .dots button {
      /* The mark is 8px; the target is 44px (§16). A dot you cannot hit is
         worse than no dot, because it looks like it should work. */
      width: var(--hc-density-min-tap, 44px);
      height: 1.25rem;
      display: grid;
      place-items: center;
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
    }
    .dots span {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-accent-inactive, #2a313b);
      transition: background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    .dots button[aria-current='true'] span {
      background: var(--hc-accent-active, #ffb661);
    }
    .dots button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: -2px;
      border-radius: var(--hc-radius-sm, 8px);
    }
    @media (prefers-reduced-motion: reduce) {
      .dots span {
        transition: none;
      }
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) env: MountEnv | undefined;

  /** What is on screen, observed rather than assumed. */
  @state() private showing = 0;

  private readonly cache = new Map<string, HTMLElement>();
  private watcher: IntersectionObserver | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.watcher?.disconnect();
    this.watcher = undefined;
  }

  override updated(): void {
    const track = this.shadowRoot?.querySelector('.track');
    if (track === null || track === undefined) return;

    // Absent in some environments — jsdom has none, and neither does an
    // embedded view old enough to be running on a wall somewhere. The dots
    // still work without it, because `go` records the page it scrolled to;
    // what is lost is noticing a scroll nobody asked this element for.
    if (typeof IntersectionObserver === 'undefined') return;

    // Rebuilt when the page count changes, and otherwise left alone: an
    // observer recreated on every device update would be thousands of
    // registrations an hour on a busy house.
    const pages = [...track.querySelectorAll('.page')];
    if (this.watcher !== undefined && this.watched === pages.length) return;
    this.watcher?.disconnect();
    this.watched = pages.length;

    this.watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = pages.indexOf(entry.target);
          if (i >= 0) this.showing = i;
        }
      },
      // Half visible is "the page you are on" under a mandatory snap.
      { root: track, threshold: 0.5 },
    );
    for (const page of pages) this.watcher.observe(page);
  }

  private watched = -1;

  private go(i: number): void {
    // Recorded before the scroll, not after it. The observer is the better
    // source of truth — a finger can move the track without asking — but it
    // reports on its own schedule and may not exist at all, and a dot that
    // does not light until the scroll settles reads as a dead control.
    this.showing = i;

    const track = this.shadowRoot?.querySelector('.track');
    const page = track?.querySelectorAll('.page')[i];

    // `scrollIntoView` rather than setting `scrollLeft`: it honours the
    // reader's reduced-motion setting on its own. Guarded because jsdom does
    // not implement it, and the dot has already done the part that matters.
    if (typeof page?.scrollIntoView === 'function') {
      page.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  }

  override render() {
    const env = this.env;
    if (env === undefined) return nothing;

    const specs = childrenOf(this.config);
    const children = mountChildren(specs, env, this.cache);
    const showing = Math.min(this.showing, Math.max(0, specs.length - 1));

    return html`<div class="swipe">
      <div class="track" part="set" style="gap:${gapOf(this.config, 0)}px">
        ${children.map(
          (el, i) =>
            html`<div
              class="page"
              part="row"
              role="group"
              aria-label=${`${i + 1} of ${specs.length}`}
            >
              ${el ?? html`<div part="empty"></div>`}
            </div>`,
        )}
      </div>
      ${
        specs.length > 1
          ? html`<div class="dots" part="controls">
              ${specs.map(
                (_, i) =>
                  html`<button
                    part="action"
                    aria-label=${`Page ${i + 1}`}
                    aria-current=${i === showing ? 'true' : 'false'}
                    @click=${() => this.go(i)}
                  >
                    <span></span>
                  </button>`,
              )}
            </div>`
          : nothing
      }
    </div>`;
  }
}

registerWidget('swipe', 'hc-swipe');

declare global {
  interface HTMLElementTagNameMap {
    'hc-swipe': HcSwipe;
  }
}
