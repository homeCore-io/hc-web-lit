/**
 * The icon rules editor — §11.2's "ordered name-pattern regexes → icon, with a
 * live test field and one-click reset".
 *
 * The third correction a person can make, after the hint and the room, and the
 * only one that scales. A hint fixes one device; this house has **eight**
 * contact sensors all named "… Door Sensor" and not one of them sets a hint,
 * because setting eight is a chore nobody does. One rule matching `/door/`
 * gives all eight a door face, and gives it to the ninth before anybody has
 * heard of it.
 *
 * **The test field is every rule, not a separate box.** §11.2 asks for a live
 * test, and the obvious reading is a text input that says what a pattern would
 * match. The better one is that each rule always shows what it *is* matching,
 * right now, against the real house: a rule with a count of zero is visibly
 * doing nothing, and a rule that has quietly captured half the devices is
 * visibly doing that. A regex is exactly the kind of thing somebody writes
 * slightly wrong and does not notice.
 *
 * **First match wins, so order is meaning.** A rule can be moved, and the list
 * says plainly that the one above it gets first refusal — otherwise a rule
 * that appears to do nothing is indistinguishable from one that is shadowed by
 * something more general written earlier.
 *
 * **One deviation from §11.2, stated rather than slipped in.** It asks for
 * "one-click reset"; removing every rule takes two clicks here, because there
 * is no undo and the second click is the only thing between somebody and
 * discarding work they cannot get back. Everything else in this editor changes
 * one rule and shows its effect immediately above; that one changes all of
 * them and leaves nothing to look at. The prompt is in place rather than in a
 * dialog, so it stays as light as the rest of the surface.
 *
 * A malformed pattern is normal here, not exceptional: somebody is typing it.
 * `ruleFor` already matches nothing rather than throwing, and this says so
 * where it happens rather than leaving a rule that looks fine and does not
 * work.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { registerWidget } from '../core/registry.js';
import { effectiveName } from '../core/present.js';
import { humanise } from '../core/text.js';
import { icon, iconRules, markNames, ruleFor, type IconRule } from '../design/icons.js';

/** What a rule can be pointed at, in the words the field uses. */
const SUBJECTS: { value: NonNullable<IconRule['on']>; label: string }[] = [
  { value: 'name', label: 'name' },
  { value: 'area', label: 'room' },
  { value: 'type', label: 'type' },
];

@customElement('hc-icon-rules')
export class HcIconRules extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .rule {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      flex-wrap: wrap;
      padding: 0.5rem 0;
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    input,
    select {
      min-height: var(--hc-density-min-tap, 44px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0 0.5rem;
      font: inherit;
    }
    input {
      flex: 1 1 8rem;
      min-width: 6rem;
      font-family: var(--hc-font-mono, ui-monospace, monospace);
    }
    input[data-bad] {
      border-color: var(--hc-accent-danger, #ff7b72);
    }
    input:focus-visible,
    select:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    button {
      min-height: var(--hc-density-min-tap, 44px);
      min-width: var(--hc-density-min-tap, 44px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      flex: none;
    }
    .mark svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .matches {
      flex: 1 1 100%;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
    .none {
      color: var(--hc-accent-warn, #ffc978);
    }
    .shadowed {
      color: var(--hc-accent-warn, #ffc978);
    }
    .foot {
      display: flex;
      gap: 0.375rem;
      padding-top: 0.75rem;
    }
    .danger {
      border-color: color-mix(in srgb, var(--hc-accent-danger, #ff7b72) 55%, transparent);
      color: var(--hc-accent-danger, #ff7b72);
    }
    .empty {
      color: var(--hc-ink-muted, #8b95a4);
      padding: 0.5rem 0;
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  /** The house, to test each rule against. Set on every widget by the host. */
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  /** Persist, and put the rules into force. Absent means read-only. */
  @property({ attribute: false }) onSaveIconRules: ((rules: IconRule[]) => void) | undefined;

  /** Being edited. Seeded from what is in force, saved back on every change. */
  @state() private draft: IconRule[] | undefined;

  /**
   * Whether "Remove all" is armed.
   *
   * **There is no undo.** Every other control here changes one rule and shows
   * its effect immediately above; this one discards work somebody did and
   * leaves nothing to look at. It asks once, in place, rather than opening a
   * dialog — a dialog for this would be heavier than the action and would
   * train somebody to dismiss dialogs.
   *
   * Written after doing exactly this by accident to a live store, with no way
   * to get the rules back.
   */
  @state() private confirmingReset = false;

  private get rules(): IconRule[] {
    return this.draft ?? iconRules();
  }

  private commit(next: IconRule[]): void {
    this.draft = next;
    // Saved on every keystroke rather than behind a button. A rule is two
    // fields and its effect is visible immediately above; a Save button here
    // would exist only to be forgotten, and §11.2 asks for a *live* test.
    this.onSaveIconRules?.(next);
  }

  /**
   * Which devices this rule actually takes, given the ones before it.
   *
   * Order is meaning — first match wins — so a rule's real effect is not what
   * its pattern matches but what is left for it. A rule that looks right and
   * catches nothing because a broader one sits above it is the failure this
   * exists to make visible.
   */
  private taken(index: number): { matched: DeviceState[]; shadowed: number } {
    const rules = this.rules;
    const rule = rules[index];
    if (rule === undefined) return { matched: [], shadowed: 0 };

    const matched: DeviceState[] = [];
    let shadowed = 0;
    for (const d of this.devices) {
      const winner = ruleFor(d, rules);
      if (winner === rule) matched.push(d);
      else if (ruleFor(d, [rule]) !== undefined) shadowed++;
    }
    return { matched, shadowed };
  }

  private valid(pattern: string): boolean {
    if (pattern === '') return false;
    try {
      new RegExp(pattern, 'i');
      return true;
    } catch {
      return false;
    }
  }

  private edit(index: number, patch: Partial<IconRule>): void {
    this.commit(this.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  private move(index: number, by: number): void {
    const next = [...this.rules];
    const to = index + by;
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    this.commit(next);
  }

  /**
   * Point each select at the value its rule actually holds.
   *
   * **After render, because a select cannot be told before its options
   * exist.** Binding `.value` on the element renders ahead of its `<option>`
   * children, so the browser falls back to the first one — every rule in this
   * editor displayed "battery", the alphabetically first mark, while the
   * stored icons were correct all along. Marking the option with `?selected`
   * fails the same way: Lit appends the children and resolves the binding
   * after the select has already settled on a value.
   *
   * Nothing was ever corrupted by it. An edit rebuilds a rule from its own
   * record rather than from the DOM, so the display lied and the data did not
   * — which is exactly why it survived a screenshot and a passing test suite
   * and was caught only by reading a value back off a live page.
   */
  override updated(): void {
    const rules = this.rules;
    this.shadowRoot?.querySelectorAll('.rule').forEach((row, i) => {
      const rule = rules[i];
      if (rule === undefined) return;
      const icon = row.querySelector<HTMLSelectElement>('select[aria-label="Icon"]');
      if (icon !== null && icon.value !== rule.icon) icon.value = rule.icon;
      const on = row.querySelector<HTMLSelectElement>('select[aria-label="Match against"]');
      const want = rule.on ?? 'name';
      if (on !== null && on.value !== want) on.value = want;
    });
  }

  private renderRule(rule: IconRule, index: number) {
    const ok = this.valid(rule.match);
    const { matched, shadowed } = ok ? this.taken(index) : { matched: [], shadowed: 0 };
    const names = matched.slice(0, 4).map((d) => effectiveName(d));

    return html`<div class="rule" part="row">
      <span class="mark" part="indicator">${icon(rule.icon)}</span>

      <input
        part="select"
        aria-label="Pattern"
        .value=${rule.match}
        ?data-bad=${!ok}
        placeholder="door|garage"
        @input=${(e: Event) => this.edit(index, { match: (e.target as HTMLInputElement).value })}
      />

      <select
        part="select"
        aria-label="Match against"
        @change=${(e: Event) =>
          this.edit(index, {
            on: (e.target as HTMLSelectElement).value as NonNullable<IconRule['on']>,
          })}
      >
        ${SUBJECTS.map((s) => html`<option value=${s.value}>${s.label}</option>`)}
      </select>

      <select
        part="select"
        aria-label="Icon"
        @change=${(e: Event) => this.edit(index, { icon: (e.target as HTMLSelectElement).value })}
      >
        ${[...markNames()].sort().map((m) => html`<option value=${m}>${humanise(m)}</option>`)}
      </select>

      <button
        part="action"
        aria-label="Move up"
        ?disabled=${index === 0}
        @click=${() => this.move(index, -1)}
      >
        ↑
      </button>
      <button
        part="action"
        aria-label="Move down"
        ?disabled=${index === this.rules.length - 1}
        @click=${() => this.move(index, 1)}
      >
        ↓
      </button>
      <button
        part="action"
        aria-label="Remove"
        @click=${() => this.commit(this.rules.filter((_, i) => i !== index))}
      >
        ✕
      </button>

      <span class="matches" part="state">
        ${
          !ok
            ? html`<span class="none">Not a pattern yet.</span>`
            : matched.length === 0
              ? html`<span class="none"
                  >Matches
                  nothing${shadowed > 0 ? ` — ${shadowed} taken by a rule above` : ''}</span
                >`
              : html`${matched.length} ${matched.length === 1 ? 'device' : 'devices'}:
                ${names.join(', ')}${
                  matched.length > names.length ? ` and ${matched.length - names.length} more` : ''
                }${shadowed > 0 ? html`<span class="shadowed"> · ${shadowed} taken above</span>` : nothing}`
        }
      </span>
    </div>`;
  }

  override render() {
    if (this.onSaveIconRules === undefined) return nothing;
    const rules = this.rules;

    return html`
      ${
        rules.length === 0
          ? html`<div class="empty" part="empty">
              No rules. The mark comes from the device's hint, then its type.
            </div>`
          : rules.map((r, i) => this.renderRule(r, i))
      }

      <div class="foot" part="controls">
        <button
          part="action"
          @click=${() => this.commit([...rules, { match: '', icon: 'device', on: 'name' }])}
        >
          Add a rule
        </button>
        ${
          this.confirmingReset
            ? html`<button
                  part="action"
                  class="danger"
                  @click=${() => {
                    this.confirmingReset = false;
                    this.commit([]);
                  }}
                >
                  Remove all ${rules.length}?
                </button>
                <button
                  part="action"
                  @click=${() => {
                    this.confirmingReset = false;
                  }}
                >
                  Keep them
                </button>`
            : html`<button
                part="action"
                ?disabled=${rules.length === 0}
                @click=${() => {
                  this.confirmingReset = true;
                }}
              >
                Remove all
              </button>`
        }
      </div>
    `;
  }
}

registerWidget('icon_rules', 'hc-icon-rules');

declare global {
  interface HTMLElementTagNameMap {
    'hc-icon-rules': HcIconRules;
  }
}
