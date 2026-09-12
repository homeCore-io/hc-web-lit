/**
 * A text element. The most common thing on a real page — 18 of 36 widgets on
 * the house dashboard, 14 of 35 on the room one — and it binds to no device.
 *
 * Config is core's, read as it is stored: `text`, `scale` (percent of the base
 * size), `weight`, `ink` (a token name, never a literal colour — §15), `align`,
 * `tracking` (letter-spacing in thousandths of an em, as the designer writes it).
 *
 * **`scale` is a percentage of the page's body size, not of the browser root.**
 * It was `rem`, which made the most-used widget in the product the one thing
 * that could not see the type ramp: an author picked a percentage of whatever
 * the browser happened to be set to, so the same number meant a different size
 * on a different machine and no number landed on the scale. Measured on the
 * household's room page, `hc-text` was the source of every one of the seven
 * off-ramp sizes rendering there — 10.88, 14.08, 11.52, 10.24, 14.4.
 *
 * Against the body **token** rather than against `em`, which was the first
 * attempt and is the classic version of this mistake: `em` is the inherited
 * size, so it compounds through every wrapper that sets one, and the same
 * `scale` came out 8.84px in one placement and 11.44 in another. A calc on the
 * token is the size the ramp says, multiplied once. So `scale: 100` is body,
 * `scale: 160` is a little over subtitle, and a number an author writes means
 * something in the system rather than against the browser.
 *
 * **And `scale` is a percentage of the *step*, which is `size`.** Four more
 * keys were being stored and not read, which on the most-used widget in the
 * product is four decisions a household made and could not see:
 *
 * - **`face`** — `mono` or the body face. Eight elements on the household's
 *   own pages ask for mono, every one of them a number or a unit beside one,
 *   and all eight rendered in Inter. It is not an icon, whatever the field's
 *   name suggests to a client reading it without a document in front of it.
 * - **`weight`** — the words a document writes are `regular`, `medium`,
 *   `bold`, `black`, and three of those four are not CSS. `font-weight:
 *   regular` is an invalid declaration, dropped, leaving 400 — right by
 *   accident. `medium` left 400 where 500 was asked for, and `black` would
 *   have left 400 where 900 was.
 * - **`size`** — the step the scale is a percentage *of*. Nothing in this
 *   house sets it, so every number here is unchanged; a page that asked for
 *   `display` was being drawn at body and silently shrunk by two thirds.
 * - **`vertical`** — where the words sit in a box taller than they are. The
 *   panel offers it, which under §4.4 means it has to do something.
 *
 * **Figures are tabular**, which is not a key at all but the same class of
 * thing: a designed page is full of numbers that update in place — a
 * temperature at 350% of body — and proportional figures make every one of
 * them twitch as the digits change.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { roleColor } from '../design/roles.js';
import { registerWidget } from '../core/registry.js';

/**
 * The steps a document may name, and what each is on the ramp (§15).
 *
 * The five the client this replaces offers, which are the five with names an
 * author would reach for; the ramp's other two — `subtitle` and `bodySmall` —
 * are for widgets choosing a role, not for somebody typing a word into a
 * field. The fallback beside each is the ramp's own number, so this table
 * cannot drift from it without the styling contract failing (§15.0).
 */
const STEPS: Record<string, { role: string; px: number }> = {
  overline: { role: 'overline', px: 10 },
  caption: { role: 'caption', px: 11 },
  body: { role: 'body', px: 13 },
  title: { role: 'title', px: 20 },
  display: { role: 'display', px: 28 },
};

/**
 * The weight a document's word means.
 *
 * **Three of the four words a document writes are not CSS.** `regular`,
 * `medium` and `black` are all invalid as `font-weight`, so the declaration
 * was dropped and every one of them rendered 400 — which is right for
 * `regular` by accident and wrong for the other two. Anything this table does
 * not know is passed through, so a document that writes `600` or `lighter`
 * still gets what it asked for.
 */
function weightOf(word: string): string {
  switch (word) {
    case 'regular':
      return '400';
    case 'medium':
      return '500';
    case 'bold':
      return '700';
    case 'black':
      return '900';
    default:
      return word;
  }
}

@customElement('hc-text')
export class HcText extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    :host([data-vertical='middle']) {
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: 100%;
    }
    :host([data-vertical='end']) {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      height: 100%;
    }
    p {
      margin: 0;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      line-height: 1.25;
      overflow-wrap: anywhere;
      /* Digits that keep their width as they change, for the reason the
         client this replaces gives: a designed page is full of numbers that
         update in place, and proportional figures make every one of them
         shuffle sideways on every push. */
      font-variant-numeric: tabular-nums;
    }
    p[data-face='mono'] {
      font-family: var(--hc-font-mono, ui-monospace, monospace);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};

  private num(key: string, fallback: number): number {
    const v = this.config[key];
    return typeof v === 'number' ? v : fallback;
  }

  private str(key: string, fallback: string): string {
    const v = this.config[key];
    return typeof v === 'string' ? v : fallback;
  }

  /**
   * Where the words sit in a box taller than they are.
   *
   * On the host rather than inside, because the box is the placement's and
   * this is the element filling it. Written after the render rather than
   * during one: an attribute set while rendering is a side effect on the tree
   * being built, and the one value that needs no attribute at all is the
   * default.
   */
  override updated(): void {
    const vertical = this.str('vertical', 'start');
    if (vertical === 'start') this.removeAttribute('data-vertical');
    else this.setAttribute('data-vertical', vertical);
  }

  override render() {
    const scale = this.num('scale', 100) / 100;
    const tracking = this.num('tracking', 0) / 1000;
    const ink = roleColor(this.str('ink', 'foreground'));
    const step = STEPS[this.str('size', 'body')] ?? STEPS['body'];

    return html`
      <p
        part="text"
        data-face=${this.str('face', 'text') === 'mono' ? 'mono' : 'text'}
        style="font-size:calc(var(--hc-text-${step?.role ?? 'body'}-size, ${step?.px ?? 13}px) * ${scale});
               font-weight:${weightOf(this.str('weight', 'regular'))};
               letter-spacing:${tracking}em;
               text-align:${this.str('align', 'left')};
               color:${ink}"
      >
        ${this.str('text', '')}
      </p>
    `;
  }
}

registerWidget('text', 'hc-text');

declare global {
  interface HTMLElementTagNameMap {
    'hc-text': HcText;
  }
}
