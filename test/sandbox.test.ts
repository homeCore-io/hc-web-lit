/**
 * The sandbox for code elements (§8.1).
 *
 * These pin the properties that make isolation real rather than decorative.
 * Every one of them is a way this is commonly got wrong, and three of them
 * fail *silently* when wrong — the frame still renders, so nothing looks
 * broken while the boundary is not there.
 */
import { describe, expect, it, vi } from 'vitest';
import { Sandbox, frameDocument, type CodeAttachment } from '../src/ext/sandbox.js';
import type { DeviceState } from '../src/core/device.js';

const device = (id: string): DeviceState => ({
  device_id: id,
  name: id,
  plugin_id: 'test',
  available: true,
  attributes: { on: true },
  last_seen: '2026-09-09T00:00:00Z',
});

const attachment = (over: Partial<CodeAttachment> = {}): CodeAttachment => ({
  entry: 'hc.root.textContent = "hi";',
  grant: ['lamp'],
  ...over,
});

describe('the frame itself', () => {
  it('is scripted and has an opaque origin', () => {
    const box = new Sandbox(attachment());
    const sandbox = box.element.getAttribute('sandbox');

    expect(sandbox).toContain('allow-scripts');
    // **The whole thing turns on this.** With `allow-same-origin` beside
    // `allow-scripts` the frame can reach up and remove its own sandbox
    // attribute — worse than no sandbox, because it reads as one.
    expect(sandbox).not.toContain('allow-same-origin');
    box.dispose();
  });

  it('carries a policy that lets it do nothing by default', () => {
    const doc = frameDocument(attachment(), 'n0nce', []);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("connect-src 'none'");
    // Navigating away is exfiltration with extra steps.
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("frame-src 'none'");
  });

  it('opens the network only where an element was given somewhere to reach', () => {
    // §8.1 allows this "per element and only when reaching the LAN is the
    // point" — possible, never automatic.
    const doc = frameDocument(attachment(), 'n0nce', ['http://10.0.10.5']);
    expect(doc).toContain('connect-src http://10.0.10.5');
    expect(doc).not.toContain("connect-src 'none'");
  });

  it('gives two frames different nonces', () => {
    const a = new Sandbox(attachment());
    const b = new Sandbox(attachment());
    const nonceOf = (s: Sandbox): string =>
      /const NONCE = "([0-9a-f]+)"/.exec(s.element.srcdoc)?.[1] ?? '';

    expect(nonceOf(a)).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceOf(a)).not.toBe(nonceOf(b));
    a.dispose();
    b.dispose();
  });

  it('does not let a source containing </script> end its own element', () => {
    // Not a privilege problem — the document is already this author's — but a
    // legitimate script containing the string would silently break.
    const doc = frameDocument(attachment({ entry: 'const s = "</script>";' }), 'n', []);
    const body = doc.slice(doc.indexOf('<div id="hc-root">'));
    expect(body.match(/<\/script>/g)).toHaveLength(1);
  });
});

/** Speak to a sandbox as its frame would, or as something else would. */
function say(box: Sandbox, data: unknown, source: unknown = box.element.contentWindow): void {
  const e = new MessageEvent('message', { data });
  Object.defineProperty(e, 'source', { value: source });
  globalThis.dispatchEvent(e);
}

/** The nonce the frame was given, which a well-behaved frame would echo. */
const nonceOf = (box: Sandbox): string =>
  /const NONCE = "([0-9a-f]+)"/.exec(box.element.srcdoc)?.[1] ?? '';

describe('the grant is the whole permission model', () => {
  it('tells the frame only about devices it was granted', () => {
    const box = new Sandbox(attachment({ grant: ['lamp'] }));
    const sent: unknown[] = [];
    Object.defineProperty(box.element, 'contentWindow', {
      value: { postMessage: (m: unknown) => sent.push(m) },
    });

    say(box, { hc: nonceOf(box), type: 'ready' }, box.element.contentWindow);
    box.update([device('lamp'), device('front_door_lock'), device('bedroom_camera')]);

    const state = sent.at(-1) as { devices: DeviceState[] };
    // Not "everything, please ignore most of it" — a frame that received the
    // lock has the lock.
    expect(state.devices.map((d) => d.device_id)).toEqual(['lamp']);
    box.dispose();
  });

  it('tells a frame with no grant about nothing at all', () => {
    const box = new Sandbox(attachment({ grant: [] }));
    const sent: unknown[] = [];
    Object.defineProperty(box.element, 'contentWindow', {
      value: { postMessage: (m: unknown) => sent.push(m) },
    });

    say(box, { hc: nonceOf(box), type: 'ready' }, box.element.contentWindow);
    box.update([device('lamp')]);

    expect((sent.at(-1) as { devices: unknown[] }).devices).toEqual([]);
    box.dispose();
  });

  it('drops a command naming a device that was never granted', () => {
    // The grant was already applied on the way in — but a frame can *name*
    // anything, and "it could only have learned about these" is a different
    // claim from "it may only act on these".
    const onCommand = vi.fn();
    const onError = vi.fn();
    const box = new Sandbox(attachment({ grant: ['lamp'] }), { onCommand, onError });

    say(box, {
      hc: nonceOf(box),
      type: 'command',
      request: { deviceId: 'front_door_lock', action: { id: 'unlock', params: {} } },
    });

    expect(onCommand).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('front_door_lock'));
    box.dispose();
  });

  it('passes a granted command to the host, which is where the safety policy is', () => {
    const onCommand = vi.fn();
    const box = new Sandbox(attachment({ grant: ['lamp'] }), { onCommand });

    say(box, {
      hc: nonceOf(box),
      type: 'command',
      request: { deviceId: 'lamp', patch: { on: false } },
    });

    // Handed on rather than executed: §5.10 keeps the policy in the host so a
    // widget cannot decline it, and a pasted script is the widget that would.
    expect(onCommand).toHaveBeenCalledWith({ deviceId: 'lamp', patch: { on: false } });
    box.dispose();
  });
});

describe('messages that are not this frame’s', () => {
  it('ignores one from another window, however well formed', () => {
    const onCommand = vi.fn();
    const box = new Sandbox(attachment({ grant: ['lamp'] }), { onCommand });

    say(
      box,
      { hc: nonceOf(box), type: 'command', request: { deviceId: 'lamp' } },
      {/* some other frame on the page */},
    );

    expect(onCommand).not.toHaveBeenCalled();
    box.dispose();
  });

  it('ignores one carrying the wrong nonce', () => {
    const onCommand = vi.fn();
    const box = new Sandbox(attachment({ grant: ['lamp'] }), { onCommand });

    say(box, { hc: 'not-the-nonce', type: 'command', request: { deviceId: 'lamp' } });

    expect(onCommand).not.toHaveBeenCalled();
    box.dispose();
  });

  it('ignores a disposed frame that is still talking', () => {
    // A frame that has been torn down can still be executing, and its last
    // message must not be taken for a live one's.
    const onCommand = vi.fn();
    const box = new Sandbox(attachment({ grant: ['lamp'] }), { onCommand });
    const nonce = nonceOf(box);
    box.dispose();

    say(box, { hc: nonce, type: 'command', request: { deviceId: 'lamp' } });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('survives junk without throwing', () => {
    const box = new Sandbox(attachment());
    expect(() => {
      say(box, undefined);
      say(box, null);
      say(box, 'a string');
      say(box, { hc: nonceOf(box), type: 'nonsense' });
      say(box, { hc: nonceOf(box), type: 'command' });
    }).not.toThrow();
    box.dispose();
  });
});

describe('what a frame may ask of the page', () => {
  it('bounds a resize, because a code element is exactly what might not', () => {
    const box = new Sandbox(attachment());
    say(box, { hc: nonceOf(box), type: 'size', height: 1e9 });
    expect(parseInt(box.element.style.height, 10)).toBeLessThanOrEqual(4000);
    box.dispose();
  });

  it('reports its own errors so the host can show them', () => {
    const onError = vi.fn();
    const box = new Sandbox(attachment(), { onError });
    say(box, { hc: nonceOf(box), type: 'error', message: 'it broke' });
    expect(onError).toHaveBeenCalledWith('it broke');
    box.dispose();
  });
});
