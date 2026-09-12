/**
 * Open a device — the gesture behind `details` (§5.10).
 *
 * §5.10 makes `hold` default to `details` *everywhere*, so there is always a
 * way to look at a device that cannot actuate it. That only holds if the
 * gesture is one implementation: a card that starts its own timer will pick a
 * different threshold, or forget that a hold which fires must swallow the click
 * behind it, and the guarantee quietly becomes "on most widgets".
 *
 * Written as an element directive so a widget spends one binding on it:
 *
 * ```ts
 * html`<button ${inspect(() => this.onDetails?.(id))}>…</button>`
 * ```
 */
import { nothing } from 'lit';
import { Directive, directive, PartType, type ElementPart, type PartInfo } from 'lit/directive.js';

/**
 * How long is a hold.
 *
 * 500ms is what a browser itself waits before a touch becomes a context menu,
 * so matching it means the two gestures resolve together rather than the page
 * doing something at 400ms and the platform something else at 500.
 */
const HOLD_MS = 500;

/**
 * Whether this press landed on something that acts rather than on the row.
 *
 * **A row's controls are not the row.** The gesture used to start on any press
 * anywhere in a row, which is wrong twice over. It fired on a device's own
 * switch, and — the way a household found it — it fired on the ceiling fan's
 * speed menu: a native `select` opens its popup on pointerdown and the
 * platform keeps the pointer, so no pointerup ever came back to cancel the
 * timer. The menu opened, then the details sheet opened on top of it.
 *
 * Read off the composed path rather than the target, because a control is
 * usually several shadow roots down; and stopped at the row itself, because
 * the row may legitimately be a button of its own.
 */
const ACTS = 'button, select, input, textarea, a[href], [role="switch"], [role="slider"]';

/**
 * Which elements already carry the gesture.
 *
 * A set attaches it to every card it builds — it has to, because it also holds
 * cards written by somebody else — and a card that attaches its own as well
 * had two, and opened the sheet twice on one tap. Weak, so an element that
 * leaves the page is not held here by it.
 */
const attached = new WeakSet<HTMLElement>();

export function hasInspect(el: HTMLElement): boolean {
  return attached.has(el);
}

function onAControl(e: Event, row: HTMLElement): boolean {
  for (const node of e.composedPath()) {
    if (node === row) return false;
    if (
      node instanceof HTMLElement &&
      (node.matches(ACTS) || node.classList.contains('controls'))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Attach the gesture to an element directly.
 *
 * The directive below is the usual way in. This is for a widget that builds an
 * element imperatively — a set drawing a type-specific card it looked up in the
 * registry — where there is no template to hang a directive on.
 *
 * **A tap opens it too, not only a hold.** Hold was the whole gesture, which
 * made the one way to see a device's details a gesture with no affordance:
 * nothing on a row says "press me for half a second", so the sheet may as well
 * not have existed for anyone who had not been told. A row is a thing you open
 * — that is what rows do everywhere else — and the hold stays for touch, where
 * it is also the platform's own idea of "tell me about this".
 *
 * `tap: false` is for a row whose click already means something: the light
 * pills aim the colour wheel at whatever you touch, and the page says so in
 * words above them.
 */
export function attachInspect(
  el: HTMLElement,
  run: () => void,
  options: { tap?: boolean } = {},
): void {
  attached.add(el);
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let fired = false;
  const tapOpens = options.tap !== false;

  el.addEventListener('pointerdown', (e) => {
    // Only a primary press. A right-click is already the context menu.
    if (e.button !== 0 || onAControl(e, el)) return;
    fired = false;
    timer = globalThis.setTimeout(() => {
      timer = 0;
      fired = true;
      run();
    }, HOLD_MS);
  });

  const cancel = (): void => {
    if (timer !== 0) globalThis.clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);

  // A hold that fired has already done the thing. Letting the click through
  // would also toggle the light it was held to inspect — the one outcome a
  // non-actuating gesture must never have.
  el.addEventListener(
    'click',
    (e) => {
      if (fired) {
        fired = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      // A press on a control is the control's, and a row that opened a sheet
      // every time somebody flicked its switch would be unusable.
      if (!tapOpens || onAControl(e, el)) return;
      run();
    },
    { capture: true },
  );

  // On touch the platform's own long-press lands here; the sheet is what the
  // gesture is for on a wall panel, not a selection menu.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

class InspectDirective extends Directive {
  private element: HTMLElement | undefined;
  private fn: (() => void) | undefined;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) {
      throw new Error('inspect() goes on an element, not in an attribute');
    }
  }

  render(_fn: (() => void) | undefined): typeof nothing {
    return nothing;
  }

  override update(part: ElementPart, [fn]: [(() => void) | undefined]): typeof nothing {
    this.fn = fn;
    if (this.element !== part.element) {
      this.element = part.element as HTMLElement;
      // Listeners once, reading whatever the latest render passed.
      attachInspect(this.element, () => this.fn?.());
    }
    return nothing;
  }
}

export const inspect = directive(InspectDirective);
