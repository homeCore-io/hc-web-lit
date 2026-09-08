/**
 * P5 — the overlay stack (§5.6).
 *
 * The point of a host-owned stack is that the awkward parts are right once:
 * Escape, the back button, the scroll lock, and a confirmation that answers no
 * when it is dismissed rather than leaving a promise unsettled.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import '../src/shell/hc-overlay.js';
import type { HcOverlay } from '../src/shell/hc-overlay.js';
import { html } from 'lit';

// jsdom implements `<dialog>` as an element but not as a modal — no
// `showModal`, no top layer. The behaviour under test is the stack, so the
// platform's half is stubbed rather than worked around in the component.
const proto = globalThis.HTMLDialogElement?.prototype as
  (HTMLDialogElement & { showModal?: () => void }) | undefined;
if (proto !== undefined && typeof proto.showModal !== 'function') {
  proto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  proto.close = function close(this: HTMLDialogElement): void {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

const mount = async (): Promise<HcOverlay> => {
  const el = document.createElement('hc-overlay');
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const dialogs = (el: HcOverlay): HTMLDialogElement[] => [
  ...el.renderRoot.querySelectorAll('dialog'),
];

describe('the overlay stack', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.style.overflow = '';
  });

  it('opens a sheet and closes it', async () => {
    const el = await mount();
    const handle = el.sheet({ render: () => html`<p>hello</p>` }, { title: 'A device' });
    await el.updateComplete;
    expect(dialogs(el)).toHaveLength(1);
    expect(el.renderRoot.textContent).toContain('A device');

    handle.close();
    await el.updateComplete;
    expect(dialogs(el)).toHaveLength(0);
  });

  it('stacks, and locks the page under it until the last one goes', async () => {
    const el = await mount();
    const a = el.sheet({ render: () => html`<p>a</p>` });
    const b = el.dialog({ render: () => html`<p>b</p>` });
    await el.updateComplete;
    expect(dialogs(el)).toHaveLength(2);
    expect(document.documentElement.style.overflow).toBe('hidden');

    b.close();
    await el.updateComplete;
    // Still one open, so the page must stay locked.
    expect(document.documentElement.style.overflow).toBe('hidden');

    a.close();
    await el.updateComplete;
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('settles `closed` however the overlay went away', async () => {
    const el = await mount();
    const handle = el.sheet({ render: () => html`<p>a</p>` });
    let done = false;
    void handle.closed.then(() => {
      done = true;
    });
    handle.close();
    await handle.closed;
    expect(done).toBe(true);
  });

  it('answers a confirmation, and answers no when it is dismissed', async () => {
    const el = await mount();

    const yes = el.confirm({ text: 'Unlock the front door?' });
    await el.updateComplete;
    const buttons = [...el.renderRoot.querySelectorAll('button')];
    buttons.find((b) => b.textContent?.trim() === 'Confirm')?.click();
    expect(await yes).toBe(true);

    const no = el.confirm({ text: 'Unlock the front door?' });
    await el.updateComplete;
    // Escape, the backdrop and the back button all arrive here.
    dialogs(el)[0]?.dispatchEvent(new Event('cancel'));
    expect(await no).toBe(false);
  });

  it('drops a toast after saying it, without blocking anything', async () => {
    const el = await mount();
    el.toast('That device is gone.', { kind: 'warn' });
    await el.updateComplete;
    expect(el.renderRoot.textContent).toContain('That device is gone.');
    // A toast is not modal: nothing is trapped and nothing is locked.
    expect(dialogs(el)).toHaveLength(0);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes the top one on the back button', async () => {
    const el = await mount();
    el.sheet({ render: () => html`<p>a</p>` });
    el.sheet({ render: () => html`<p>b</p>` });
    await el.updateComplete;
    expect(dialogs(el)).toHaveLength(2);

    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    await el.updateComplete;
    // Back peels one off rather than navigating away from the page under it.
    expect(dialogs(el)).toHaveLength(1);
  });
});
