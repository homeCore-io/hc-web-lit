/**
 * `hc-button` — Tier 2, and Phase 3's acceptance gate (§7.4, §18.3).
 *
 * §7.4 says this adds no host capability of its own: it is P1 + P7 + P9
 * exposed through a wide config surface, and **if it needs something that is
 * not already a primitive, that is a finding against Phase 2 rather than a
 * reason to special-case the widget.**
 *
 * So this file imports from `@homecore/widget-sdk` and nothing else. No API
 * client, no store, no fetch, no reaching into the host — the same rule
 * `boundary.test.ts` enforces on first-party widgets, kept here by hand
 * because an extension author has only the rule.
 *
 * What it demonstrates, in order:
 *
 * - **every visual field expression-capable** (P1) — label, secondary, icon
 *   and the state test are all `{{ … }}` or `$expr`;
 * - **state-matching style blocks** (P7) — `when` compares a value and applies
 *   tokens, which is what card-mod is for and what a documented styling
 *   contract makes unnecessary;
 * - **the shared action model** (P9) — tap, hold and double-tap are the
 *   host's, so this cannot unlock a door on a plain tap however it is
 *   configured;
 * - **presentation from the primitive** (§1.1) — on-ness, level and the mark
 *   come from the host, because a widget that re-derived them would get them
 *   wrong the way every widget that tried did.
 */
import {
  HcWidgetBase,
  css,
  html,
  nothing,
  icon,
  iconFor,
  isOn,
  levelOf,
  effectiveName,
  registerWidget,
  type DeviceState,
} from '../../src/sdk/index.js';

/** One conditional style block: when this holds, paint that. */
interface StyleWhen {
  /** An expression over the widget's scope. Truthy applies the block. */
  when: string;
  ink?: string;
  fill?: string;
  icon?: string;
}

export class HcButton extends HcWidgetBase {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    button {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: var(--hc-density-card-padding, 14px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 14px);
      background: var(--fill, var(--hc-surface-raised, #141922));
      color: var(--ink, var(--hc-ink, #e9edf2));
      font: inherit;
      font-family: var(--hc-font-body, system-ui, sans-serif);
      text-align: left;
      cursor: pointer;
      transition: background var(--hc-motion-base, 220ms) var(--hc-motion-curve, ease-out);
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--hc-radius-sm, 8px);
      background: color-mix(in srgb, currentColor 16%, transparent);
    }
    svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .lines {
      min-width: 0;
      display: grid;
      gap: 0.1rem;
    }
    .label {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .secondary {
      font-size: var(--hc-text-body-small-size, 12.5px);
      opacity: 0.7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  /** The device this is about, when it is about one. */
  private get device(): DeviceState | undefined {
    const id = this.config['device_id'];
    return typeof id === 'string' ? this.ctx?.device(id) : undefined;
  }

  /** A config value that may be an expression, resolved through the host. */
  private value(key: string, fallback = ''): string {
    const raw = this.config[key];
    if (typeof raw === 'object' && raw !== null && '$expr' in raw) {
      const got = this.ctx?.expr(String((raw as { $expr: unknown }).$expr));
      return got === undefined || got === null ? fallback : String(got);
    }
    // `{{ … }}` is already resolved at the placement seam; anything left is a
    // literal, which is what a client that could not evaluate would draw.
    return typeof raw === 'string' ? raw : fallback;
  }

  /** The first style block whose condition holds. */
  private styleBlock(): StyleWhen | undefined {
    const blocks = this.config['styles'];
    if (!Array.isArray(blocks)) return undefined;
    return blocks.find(
      (b): b is StyleWhen =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as StyleWhen).when === 'string' &&
        this.ctx?.expr((b as StyleWhen).when) === true,
    );
  }

  override render() {
    const d = this.device;
    const block = this.styleBlock();

    // Presentation from the primitive, never re-derived here (§1.1).
    const lit = d === undefined ? undefined : isOn(d);
    const level = d === undefined ? undefined : levelOf(d);

    const label = this.value('label', d === undefined ? '' : effectiveName(d));
    const secondary = this.value(
      'secondary',
      level !== undefined && lit === true ? `${Math.round(level)}%` : '',
    );

    const mark = block?.icon ?? this.value('icon', iconFor(d));
    const ink = block?.ink ?? (lit === true ? 'var(--hc-accent-active, #ffb661)' : undefined);
    const fill = block?.fill;

    return html`<button
      part="card"
      style=${[ink !== undefined ? `--ink:${ink}` : '', fill !== undefined ? `--fill:${fill}` : '']
        .filter(Boolean)
        .join(';')}
    >
      <span class="tile" part="indicator">${icon(mark)}</span>
      <span class="lines">
        <span class="label" part="name">${label}</span>
        ${secondary === '' ? nothing : html`<span class="secondary" part="state">${secondary}</span>`}
      </span>
    </button>`;
  }
}

customElements.define('hc-button', HcButton);
registerWidget('button', 'hc-button');

declare global {
  interface HTMLElementTagNameMap {
    'hc-button': HcButton;
  }
}
