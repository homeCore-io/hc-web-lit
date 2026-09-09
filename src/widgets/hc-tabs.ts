/**
 * `tabs` — named sections, one visible at a time (§5.5, §7.3).
 *
 * A container built on P4 like the others: the sections are declared in
 * config, the children are widgets like any others, and their chrome is
 * suppressed because the container is the surface.
 *
 * **The tab strip is a real tablist.** `role="tablist"` with roving focus and
 * arrow keys, because a wall panel is not the only thing that opens a
 * dashboard and a tab you can only reach with a finger is a tab somebody on a
 * keyboard cannot reach at all. This is cheap here and impossible to retrofit
 * once the ABI is published and third parties have copied the markup.
 *
 * **Every section stays mounted; only one is shown.** Unmounting the hidden
 * ones would restart them on every switch — a history chart refetching six
 * hours of readings because somebody looked at the other tab — and it would
 * throw away scroll position and any state a child holds. `hidden` costs a
 * little memory and keeps a tab switch instant, which is the right trade on a
 * panel that is switched between two views all day.
 *
 * **The selection survives a re-render**, which is the whole reason children
 * are cached: the page re-renders on every device change, and a tab that
 * reset itself several times a second would be unusable in a house with
 * anything happening in it.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { childrenOf, gapOf, slotsOf } from '../core/compose.js';
import { mountChildren, type MountEnv } from '../shell/mount.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

@customElement('hc-tabs')
export class HcTabs extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .tabs {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .strip {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    button {
      /* §16: a finger needs 44px, and a tab bar is the first thing a finger
         lands on. */
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 1.5);
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--hc-ink-muted, #8b95a4);
      font: inherit;
      font-size: var(--hc-text-body-small-size, 12.5px);
      cursor: pointer;
      transition: color var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    button[aria-selected='true'] {
      color: var(--hc-ink, #e9edf2);
      border-bottom-color: var(--hc-accent-active, #ffb661);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: -2px;
    }
    .panel {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    }
    .panel[hidden] {
      display: none;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) env: MountEnv | undefined;

  /** Which section is showing. Held here so a re-render does not reset it. */
  @state() private chosen = 0;

  /** One cache per section, so switching tabs keeps both sides alive. */
  private readonly caches = new Map<string, Map<string, HTMLElement>>();

  private cacheFor(slot: string): Map<string, HTMLElement> {
    let held = this.caches.get(slot);
    if (held === undefined) {
      held = new Map();
      this.caches.set(slot, held);
    }
    return held;
  }

  /** The label a person reads: the author's, else the slot's name humanised. */
  private labels(slots: string[]): string[] {
    const declared = this.config['labels'];
    const given = Array.isArray(declared) ? declared : [];
    return slots.map((s, i) => {
      const label = given[i];
      return typeof label === 'string' && label !== '' ? label : humanise(s);
    });
  }

  private move(by: number, count: number): void {
    // Wrapping, because a tab strip is a ring and stopping at the end is a
    // dead key nobody expects.
    this.chosen = (this.chosen + by + count) % count;
    this.updateComplete.then(() => {
      const buttons = this.shadowRoot?.querySelectorAll('button');
      (buttons?.[this.chosen] as HTMLElement | undefined)?.focus();
    });
  }

  private onKey(e: KeyboardEvent, count: number): void {
    if (e.key === 'ArrowRight') this.move(1, count);
    else if (e.key === 'ArrowLeft') this.move(-1, count);
    else if (e.key === 'Home') this.chosen = 0;
    else if (e.key === 'End') this.chosen = count - 1;
    else return;
    e.preventDefault();
  }

  override render() {
    const env = this.env;
    if (env === undefined) return nothing;

    const slots = slotsOf(this.config);
    const labels = this.labels(slots);
    // A config edited while a later tab was open must not leave the selection
    // pointing past the end.
    const chosen = Math.min(this.chosen, slots.length - 1);

    return html`<div class="tabs">
      <div
        class="strip"
        part="head"
        role="tablist"
        @keydown=${(e: KeyboardEvent) => this.onKey(e, slots.length)}
      >
        ${slots.map(
          (slot, i) =>
            html`<button
              part="action"
              role="tab"
              id=${`tab-${slot}`}
              aria-selected=${i === chosen ? 'true' : 'false'}
              aria-controls=${`panel-${slot}`}
              tabindex=${i === chosen ? '0' : '-1'}
              @click=${() => {
                this.chosen = i;
              }}
            >
              ${labels[i]}
            </button>`,
        )}
      </div>
      ${slots.map(
        (slot, i) =>
          html`<div
            class="panel"
            part="set"
            role="tabpanel"
            id=${`panel-${slot}`}
            aria-labelledby=${`tab-${slot}`}
            ?hidden=${i !== chosen}
            style="gap:${gapOf(this.config)}px"
          >
            ${mountChildren(childrenOf(this.config, slot), env, this.cacheFor(slot)).map(
              (el) => el ?? html`<div part="empty"></div>`,
            )}
          </div>`,
      )}
    </div>`;
  }
}

registerWidget('tabs', 'hc-tabs');

declare global {
  interface HTMLElementTagNameMap {
    'hc-tabs': HcTabs;
  }
}
