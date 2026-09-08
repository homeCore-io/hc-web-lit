/**
 * Hold to inspect — the gesture behind `details` (§5.10).
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
 * Attach the gesture to an element directly.
 *
 * The directive below is the usual way in. This is for a widget that builds an
 * element imperatively — a set drawing a type-specific card it looked up in the
 * registry — where there is no template to hang a directive on.
 */
export function attachInspect(el: HTMLElement, run: () => void): void {
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let fired = false;

  el.addEventListener('pointerdown', (e) => {
    // Only a primary press. A right-click is already the context menu.
    if (e.button !== 0) return;
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
      if (!fired) return;
      fired = false;
      e.stopPropagation();
      e.preventDefault();
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
