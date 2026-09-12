/**
 * The house at a glance — `house_status_hero`.
 *
 * Four placements, and an empty config on every one, so everything here is
 * derived. It is the first thing on the page and often the only thing read, so
 * the question it answers is *"is anything up?"* rather than *"what is the
 * state of everything?"*.
 *
 * **Reassurance first.** A house with nothing wrong should say so in one line
 * and stop. The counts are underneath for when somebody wants them, and a
 * number that is zero is left out entirely — "0 offline" is a sentence about
 * nothing, and four of them is a wall of nothings that buries the one that
 * matters.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { noticesFor } from '../core/attention.js';
import { houseTally } from '../core/bindings.js';
import type { DeviceState } from '../core/device.js';
import { registerWidget } from '../core/registry.js';

@customElement('hc-house-status')
export class HcHouseStatus extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .hero {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.6rem;
      height: 100%;
      box-sizing: border-box;
      padding: var(--hc-density-card-padding, 14px);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      color: var(--hc-ink, #e9edf2);
    }
    .line {
      font-size: var(--hc-text-title-size, 20px);
      font-weight: 600;
      letter-spacing: -0.01em;
      text-wrap: balance;
    }
    .line b {
      color: var(--hc-accent-active, #ffb661);
      font-weight: 600;
    }
    .line.calm {
      color: var(--hc-accent-success, #6fd1a6);
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
    }
    .count {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .count b {
      font-family: var(--hc-font-mono, ui-monospace, monospace);
      font-size: var(--hc-text-subtitle-size, 16px);
      font-weight: 400;
      color: var(--hc-ink, #e9edf2);
      font-variant-numeric: tabular-nums;
    }
    .count[data-warn] b {
      color: var(--hc-accent-warn, #ffc978);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];

  override render() {
    const d = this.devices;
    if (d.length === 0) return html`<div class="hero"><span class="line">Nothing yet.</span></div>`;

    const lit = houseTally('lights_on', d) ?? 0;
    const playing = houseTally('playing', d) ?? 0;
    const offline = houseTally('offline', d) ?? 0;
    // The same derivation the worth-knowing list uses, so the hero and the list
    // below it can never disagree about whether anything is wrong.
    const notices = noticesFor({ watch: ['water', 'faults', 'locks', 'batteries'] }, d);

    return html`<div class="hero" part="hero">
      <span class="line ${notices.length === 0 ? 'calm' : ''}" part="headline">
        ${this.headline(notices.length, lit)}
      </span>
      <div class="counts">
        ${this.count('lit', lit)} ${this.count('playing', playing)}
        ${this.count('offline', offline, true)} ${this.count('worth knowing', notices.length, true)}
      </div>
    </div>`;
  }

  /**
   * One sentence. The most urgent true thing, and nothing else.
   *
   * A hero that lists everything is a hero nobody reads, so this picks: a
   * problem if there is one, otherwise how much of the house is awake,
   * otherwise that it is quiet.
   */
  private headline(problems: number, lit: number) {
    if (problems > 0) {
      return html`<b>${problems}</b> ${problems === 1 ? 'thing' : 'things'} worth knowing`;
    }
    if (lit > 0) return html`All well · <b>${lit}</b> ${lit === 1 ? 'light' : 'lights'} on`;
    return html`All well · the house is dark`;
  }

  /** A count worth showing. Zero is left out — see the class comment. */
  private count(label: string, n: number, warn = false) {
    if (n === 0) return nothing;
    return html`<span class="count" ?data-warn=${warn}><b>${n}</b>${label}</span>`;
  }
}

registerWidget('house_status_hero', 'hc-house-status');

declare global {
  interface HTMLElementTagNameMap {
    'hc-house-status': HcHouseStatus;
  }
}
