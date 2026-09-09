/**
 * `accordion` — named sections, any number open (§5.5, §7.3).
 *
 * The same declared shape as `tabs` — slots, labels, children per slot — and a
 * different question: tabs ask *which one*, an accordion asks *which ones*.
 * That is why they are two widgets rather than one with a flag; the answer
 * changes what the control is for.
 *
 * **Built on `<details>` and `<summary>`.** The browser already implements
 * this: a disclosure widget with the right role, keyboard operation, focus
 * behaviour, and — the part usually missed — findability, because Chrome will
 * open a closed `<details>` to reveal a match when somebody uses find-in-page.
 * Hand-rolling it with a button and a div means reimplementing all of that and
 * getting the last one wrong silently.
 *
 * **Which sections are open survives a re-render**, like the tab selection and
 * for the same reason: the page re-renders on every device change, and a
 * section that closed itself several times a second would be unusable.
 * `<details>` holds that state in the DOM, so it is mirrored here rather than
 * trusted — Lit re-renders the attribute and would otherwise slam it shut.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { childrenOf, gapOf, slotsOf } from '../core/compose.js';
import { mountChildren, type MountEnv } from '../shell/mount.js';
import { registerWidget } from '../core/registry.js';
import { humanise } from '../core/text.js';

@customElement('hc-accordion')
export class HcAccordion extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .accordion {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: auto;
    }
    details + details {
      border-top: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: var(--hc-density-min-tap, 44px);
      padding: 0 calc(var(--hc-space-unit, 8px) * 0.5);
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
      font-weight: 600;
      cursor: pointer;
      /* The default triangle is replaced by one that follows the skin's ink
         and rotates. The list-style rule is how Chrome hides its own. */
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .chevron {
      width: 0.6rem;
      height: 0.6rem;
      border-right: 2px solid var(--hc-ink-muted, #8b95a4);
      border-bottom: 2px solid var(--hc-ink-muted, #8b95a4);
      transform: rotate(-45deg);
      transition: transform var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    details[open] .chevron {
      transform: rotate(45deg);
    }
    summary:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: -2px;
    }
    .body {
      display: flex;
      flex-direction: column;
      padding-bottom: calc(var(--hc-space-unit, 8px));
    }
    @media (prefers-reduced-motion: reduce) {
      .chevron {
        transition: none;
      }
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) env: MountEnv | undefined;

  /** Which sections the reader has opened. Not read back off the DOM. */
  @state() private open = new Set<string>();

  private readonly caches = new Map<string, Map<string, HTMLElement>>();

  private cacheFor(slot: string): Map<string, HTMLElement> {
    let held = this.caches.get(slot);
    if (held === undefined) {
      held = new Map();
      this.caches.set(slot, held);
    }
    return held;
  }

  /** First render only: the sections the author said start open. */
  private seeded = false;

  private seed(slots: string[]): void {
    if (this.seeded) return;
    this.seeded = true;
    const declared = this.config['open'];
    if (Array.isArray(declared)) {
      for (const s of declared) if (typeof s === 'string') this.open.add(s);
    } else if (declared === 'all') {
      for (const s of slots) this.open.add(s);
    } else if (declared === 'none') {
      // Nothing. Said explicitly so it is a choice rather than a default.
    } else {
      // A closed accordion of unlabelled sections is a page with nothing on
      // it, so the first one opens unless the author said otherwise.
      const first = slots[0];
      if (first !== undefined) this.open.add(first);
    }
  }

  private label(slot: string, i: number): string {
    const declared = this.config['labels'];
    const given = Array.isArray(declared) ? declared[i] : undefined;
    return typeof given === 'string' && given !== '' ? given : humanise(slot);
  }

  override render() {
    const env = this.env;
    if (env === undefined) return nothing;

    const slots = slotsOf(this.config);
    this.seed(slots);

    return html`<div class="accordion" part="set">
      ${slots.map(
        (slot, i) => html`
          <details
            part="row"
            ?open=${this.open.has(slot)}
            @toggle=${(e: Event) => {
              // Mirrored, not trusted: Lit re-renders `open` from this set on
              // the next device change, and without recording the reader's
              // choice it would slam the section shut under them.
              const el = e.currentTarget as HTMLDetailsElement;
              const next = new Set(this.open);
              if (el.open) next.add(slot);
              else next.delete(slot);
              this.open = next;
            }}
          >
            <summary part="heading"><span class="chevron"></span>${this.label(slot, i)}</summary>
            <div class="body" style="gap:${gapOf(this.config)}px">
              ${mountChildren(childrenOf(this.config, slot), env, this.cacheFor(slot)).map(
                (el) => el ?? html`<div part="empty"></div>`,
              )}
            </div>
          </details>
        `,
      )}
    </div>`;
  }
}

registerWidget('accordion', 'hc-accordion');

declare global {
  interface HTMLElementTagNameMap {
    'hc-accordion': HcAccordion;
  }
}
