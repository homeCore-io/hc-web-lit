/**
 * The row of controls over a page, and the two states it could not be backed
 * out of.
 *
 * **A control with no visible way out is a control somebody is stuck in.**
 * Rename opened a bare box: Escape cancelled it and Enter committed it, both
 * of them keyboard-only on a product whose primary surfaces are a desktop
 * *and a wall tablet* (§16) — and the box committed on blur, so tapping
 * anywhere else saved the words somebody was abandoning. Arrange had only
 * Done, and because every edit here is live (§18.2) there was nothing that
 * said "never mind, all of it" short of walking the undo stack back a step at
 * a time.
 */
import { describe, expect, it, vi } from 'vitest';
import { Authored } from '../src/core/authored.js';
import { MemoryContent } from '../src/core/content.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';
import '../src/shell/hc-app.js';
import type { HcApp } from '../src/shell/hc-app.js';

const page = (id: string, name: string): DashboardDefinition => ({
  id,
  name,
  icon: 'home',
  owner_user_id: 'u',
  widgets: [{ id: 'one', type: 'text', config: { text: 'hello' } }],
  layouts: [
    {
      breakpoint: 'desktop',
      columns: 12,
      row_height: 100,
      gap: 10,
      placements: [{ widget_id: 'one', x: 0, y: 0, w: 6, h: 2 }],
    },
  ],
});

/** The shell, past the connect screen, over pages held in memory. */
async function shell(): Promise<HcApp> {
  const el = document.createElement('hc-app');
  const inner = el as unknown as Record<string, unknown>;
  const store = new MemoryContent();
  const authored = new Authored(store);
  const docs = authored.saveDashboards([page('p1', 'Kitchen'), page('p2', 'Office')]);
  inner['authored'] = authored;
  inner['docs'] = docs;
  inner['current'] = docs[0];
  inner['phase'] = 'ready';
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const buttons = (el: HcApp): HTMLButtonElement[] => [
  ...(el.shadowRoot?.querySelectorAll('button') ?? []),
];
const labels = (el: HcApp): string[] => buttons(el).map((b) => b.textContent?.trim() ?? '');
const press = async (el: HcApp, label: string): Promise<void> => {
  const button = buttons(el).find((b) => b.textContent?.trim() === label);
  expect(button, `no button called ${label}`).toBeDefined();
  button?.click();
  await el.updateComplete;
};
const box = (el: HcApp): HTMLInputElement =>
  el.shadowRoot?.querySelector('input.rename') as HTMLInputElement;
const named = (el: HcApp): string[] =>
  ((el as unknown as { docs: DashboardDefinition[] }).docs ?? []).map((d) => d.name);

describe('renaming a page', () => {
  it('offers both ways out on screen, not only on a keyboard', async () => {
    const el = await shell();
    await press(el, 'Rename');
    expect(labels(el)).toContain('Save');
    expect(labels(el)).toContain('Cancel');
  });

  it('leaves the name alone when told to', async () => {
    const el = await shell();
    await press(el, 'Rename');
    box(el).value = 'Something else';
    await press(el, 'Cancel');
    expect(named(el)).toEqual(['Kitchen', 'Office']);
    expect(box(el), 'the box is gone').toBeNull();
  });

  it('saves the name when told to', async () => {
    const el = await shell();
    await press(el, 'Rename');
    box(el).value = 'Scullery';
    await press(el, 'Save');
    expect(named(el)).toEqual(['Scullery', 'Office']);
  });

  it('does not commit because somebody looked away', async () => {
    // The box used to save on blur, so a tap anywhere else was a rename.
    const el = await shell();
    await press(el, 'Rename');
    box(el).value = 'Typed and abandoned';
    box(el).dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await el.updateComplete;
    expect(named(el)).toEqual(['Kitchen', 'Office']);
    expect(box(el), 'and it is still there to answer').not.toBeNull();
  });
});

describe('arranging a page, and changing your mind', () => {
  const write = async (el: HcApp, name: string): Promise<void> => {
    const inner = el as unknown as {
      docs: DashboardDefinition[];
      writePages: (next: readonly DashboardDefinition[], showing?: string) => void;
    };
    inner.writePages(
      inner.docs.map((d, i) => (i === 0 ? { ...d, name } : d)),
      'p1',
    );
    await el.updateComplete;
  };
  /**
   * What the household says when asked.
   *
   * Stubbed on the overlay element rather than on the shell: the confirmation
   * is the host's (§5.6), and the shell reaches it by querying for it.
   */
  const answer = (el: HcApp, yes: boolean): void => {
    const overlay = el.shadowRoot?.querySelector('hc-overlay') as unknown as {
      confirm: () => Promise<boolean>;
    } | null;
    expect(overlay, 'no overlay to ask with').not.toBeNull();
    if (overlay !== null) overlay.confirm = vi.fn(async () => yes);
  };

  it('offers nothing to cancel until something has been done', async () => {
    // Before the first edit, Done is already the way out that changes nothing.
    const el = await shell();
    await press(el, 'Arrange');
    expect(labels(el)).toContain('Done');
    expect(labels(el)).not.toContain('Cancel');
  });

  it('offers it the moment a page has been written', async () => {
    const el = await shell();
    await press(el, 'Arrange');
    await write(el, 'Changed');
    expect(labels(el)).toContain('Cancel');
  });

  it('puts every page back the way it was, and stops arranging', async () => {
    const el = await shell();
    await press(el, 'Arrange');
    await write(el, 'Changed once');
    await write(el, 'Changed twice');
    answer(el, true);
    await press(el, 'Cancel');
    await el.updateComplete;
    expect(named(el)).toEqual(['Kitchen', 'Office']);
    expect(labels(el)).toContain('Arrange');
  });

  it('keeps everything when the question is answered the other way', async () => {
    const el = await shell();
    await press(el, 'Arrange');
    await write(el, 'Changed');
    answer(el, false);
    await press(el, 'Cancel');
    await el.updateComplete;
    expect(named(el)).toEqual(['Changed', 'Office']);
    expect(labels(el), 'still arranging').toContain('Done');
  });

  it('is itself one step, so a cancel pressed by mistake is undoable', async () => {
    // It goes through the same door as every other change, which is what makes
    // this true rather than a second mechanism that has to remember to.
    const el = await shell();
    await press(el, 'Arrange');
    await write(el, 'Changed');
    answer(el, true);
    await press(el, 'Cancel');
    await press(el, '↶');
    expect(named(el)).toEqual(['Changed', 'Office']);
  });

  it('forgets the snapshot on the way out, so the next session is its own', async () => {
    const el = await shell();
    await press(el, 'Arrange');
    await write(el, 'Changed');
    await press(el, 'Done');
    await press(el, 'Arrange');
    expect(labels(el), 'nothing done in this session yet').not.toContain('Cancel');
  });
});
