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
  HcLayoutShell,
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
  type HcContext,
  type WidgetSpec,
} from '@homecore/widget-sdk';

/**
 * One conditional style block: when this holds, paint that.
 *
 * `ink` and `fill` are the shell's own two knobs, named for what they do
 * rather than for the custom properties they set — a widget author should not
 * have to know that `--hc-shell-tint` exists to say "fill it in when it is
 * on". Anything more than two would be this widget inventing a styling
 * vocabulary beside §5.8's, which is the thing card-mod exists because of.
 */
interface StyleWhen {
  /** An expression over the widget's scope. Truthy applies the block. */
  when: string;
  /** The mark's colour. Any CSS colour, or a token reference. */
  ink?: string;
  /** How strongly the tile is filled with it — a percentage. */
  fill?: string;
  /** A mark name, overriding the derived one. */
  icon?: string;
}

export class HcButton extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      .fields {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        min-width: 0;
      }
      .fields > * {
        min-width: 0;
      }
    `,
  ];

  /** The capability object. Set by the host before the first render. */
  ctx: HcContext | undefined;

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

  override updated(): void {
    super.updated();
    const d = this.device;
    const block = this.styleBlock();
    // The shell owns the structure; a widget says only what state it is in.
    // Two custom properties is the entire vocabulary for that.
    const lit = d !== undefined && isOn(d) === true;
    this.style.setProperty(
      '--hc-shell-colour',
      block?.ink ?? (lit ? 'var(--hc-accent-active, #ffb661)' : 'var(--hc-ink-muted, #8b95a4)'),
    );
    // `fill` was declared in the block and read by nothing, so a style block
    // that set it did nothing and said nothing about it.
    this.style.setProperty('--hc-shell-tint', block?.fill ?? (lit ? '22%' : '0%'));
  }

  protected override renderIcon() {
    const block = this.styleBlock();
    return icon(block?.icon ?? this.value('icon', iconFor(this.device)));
  }

  protected override renderPrimary(): unknown {
    const d = this.device;
    return this.value('label', d === undefined ? '' : effectiveName(d));
  }

  protected override renderSecondary(): unknown {
    return this.value('secondary');
  }

  /**
   * Custom fields, composed from child widgets (§7.4).
   *
   * §7.4 asks for this specifically, and specifically *not* as raw HTML: a
   * field is a widget like any other, so it gets the registry, templates, the
   * host's callbacks and the chrome suppression that comes with being nested —
   * and an author who wants a chart in a button does not have to be trusted
   * with markup to get one.
   *
   * **This is the capability the acceptance gate found missing.** `ctx.child`
   * did not exist when this widget was first written; composition was
   * first-party-only in practice while §5.5 said an extension ships a
   * container "the same way it ships anything else". §7.4 is explicit about
   * what to do with that: fix the primitive.
   *
   * A field naming a type nothing draws is shown as missing rather than
   * skipped — a silently absent field is indistinguishable from one somebody
   * forgot to add.
   */
  protected override renderControls(): unknown {
    const fields = this.config['fields'];
    if (!Array.isArray(fields) || fields.length === 0) return nothing;

    return html`<div class="fields" part="controls">
      ${fields.map((spec) => {
        if (
          typeof spec !== 'object' ||
          spec === null ||
          typeof (spec as WidgetSpec).type !== 'string'
        ) {
          return nothing;
        }
        const el = this.ctx?.child(spec as WidgetSpec);
        return el ?? html`<span part="note">${String((spec as WidgetSpec).type)}?</span>`;
      })}
    </div>`;
  }

  protected override renderBadge(): unknown {
    const d = this.device;
    if (d === undefined || isOn(d) !== true) return nothing;
    const level = levelOf(d);
    return level === undefined ? nothing : `${Math.round(level)}%`;
  }
}

customElements.define('hc-button', HcButton);
registerWidget('button', 'hc-button');

declare global {
  interface HTMLElementTagNameMap {
    'hc-button': HcButton;
  }
}
