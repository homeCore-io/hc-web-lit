/**
 * The sandbox for code elements (§8.1, §4.6).
 *
 * **This is the one thing that is isolated, and it is isolated because of how
 * it arrived.** §8.1 settles the general question the other way: an installed
 * extension runs in-realm, because installing one is a deliberate admin act
 * and homeCore plugins are native binaries supervised as processes — hardening
 * the browser layer while that door stands is defence pointed away from the
 * risk. A **code element** is the opposite case. There is no install step and
 * no act of trust: somebody pasted it from a forum into a dashboard. Nobody
 * decided to trust it, so nothing may be given to it.
 *
 * Core already describes the shape: `CodeAttachment { entry, grant }` — the
 * document a frame loads, and the devices it may reach.
 *
 * **The grant is the whole permission model.** Name a selection, get exactly
 * those devices, act on exactly those. Name nothing and the element renders
 * and can do nothing, which is the right default for code somebody pasted. It
 * is enforced in *both* directions here — the frame is only told about devices
 * in its grant, and a command naming anything else is dropped — because a
 * permission model checked on the way in and not on the way out is a
 * permission model with one bug in it.
 *
 * Three properties make the isolation real, and each one is a way this is
 * commonly got wrong:
 *
 * - **`allow-scripts` without `allow-same-origin`.** The two together let a
 *   frame reach up and remove its own sandbox attribute, which is worse than
 *   no sandbox because it reads as one. Without `allow-same-origin` the frame
 *   has an opaque origin: no cookies, no storage, no `localStorage` — which is
 *   where this device's panel key lives — and no access to the parent.
 * - **A CSP inside the document**, `default-src 'none'`, so a pasted script
 *   cannot fetch, cannot load an image from a tracker, and cannot exfiltrate
 *   by navigation. Network is opened per element and only when reaching the
 *   LAN is the point.
 * - **A per-frame nonce on every message.** A frame that has been disposed can
 *   still be executing, and its last `postMessage` must not be mistaken for
 *   the live one's. Every message carries the nonce of the frame it belongs
 *   to; anything else is discarded, in both directions.
 *
 * This is also what Rule 3 was for. Every capability was kept expressible as a
 * message even while everything ran in one realm, so the transport here is a
 * swap rather than a rewrite.
 */
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';

/** What core stores: the document, and what it may touch. */
export interface CodeAttachment {
  /** The document the sandbox loads. Inline source, not a URL. */
  entry: string;
  /** Device ids this element may see and command. Absent means none. */
  grant?: readonly string[];
}

export interface SandboxOptions {
  /**
   * Origins the frame may reach, if any.
   *
   * Empty is the default and the right one: `default-src 'none'` and nothing
   * added. §8.1 allows opening the network "per element and only when reaching
   * the LAN is the point" — a camera still, say — so it is possible and it is
   * never automatic.
   */
  connect?: readonly string[];
  /** Where a command goes once the grant has allowed it. */
  onCommand?: (r: CommandRequest) => void;
  /** Told when the frame says something is wrong, so the host can show it. */
  onError?: (message: string) => void;
}

/** Messages the host sends in. */
type ToFrame =
  | { hc: string; type: 'state'; devices: DeviceState[] }
  | { hc: string; type: 'tokens'; tokens: Record<string, string> };

/** Messages the frame may send out. Anything else is ignored. */
type FromFrame =
  | { hc: string; type: 'ready' }
  | { hc: string; type: 'command'; request: CommandRequest }
  | { hc: string; type: 'error'; message: string }
  | { hc: string; type: 'size'; height: number };

/**
 * The document a frame loads.
 *
 * Built here rather than shipped as a file, because it has to carry the
 * nonce and the CSP, and because a frame that fetched its own runtime would
 * need a network permission to start.
 *
 * The little API a pasted script gets is deliberately tiny: what the devices
 * are, when they change, and a way to ask for something. No DOM helpers, no
 * host objects, nothing that would grow into a second SDK — an author who
 * wants the real one installs an extension (§8.1).
 */
export function frameDocument(
  attachment: CodeAttachment,
  nonce: string,
  connect: readonly string[],
): string {
  const csp = [
    "default-src 'none'",
    // The script is the element's own source, inlined below. `unsafe-inline`
    // is what lets it run at all; there is no external script to allow.
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    // Images from data: only, unless the element was given somewhere to reach.
    `img-src data: ${connect.join(' ')}`.trim(),
    connect.length > 0 ? `connect-src ${connect.join(' ')}` : "connect-src 'none'",
    // No navigating away, and no framing anything else: both are ways to send
    // what the frame has seen somewhere it should not go.
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
<style>html,body{margin:0;font:14px system-ui,sans-serif;color:#e9edf2}</style>
</head><body><div id="hc-root"></div><script>
(() => {
  const NONCE = ${JSON.stringify(nonce)};
  let devices = [];
  const listeners = [];
  const post = (m) => parent.postMessage(Object.assign({ hc: NONCE }, m), '*');

  addEventListener('message', (e) => {
    const m = e.data;
    // Only messages stamped with this frame's own nonce. A stale host, or
    // anything else that can reach a window, is not this frame's business.
    if (!m || m.hc !== NONCE) return;
    if (m.type === 'state') {
      devices = m.devices;
      for (const cb of listeners) { try { cb(devices); } catch (err) { post({ type: 'error', message: String(err && err.message || err) }); } }
    }
  });

  globalThis.hc = {
    root: document.getElementById('hc-root'),
    get devices() { return devices; },
    onDevices(cb) { listeners.push(cb); if (devices.length) cb(devices); },
    // Asking is all it can do — the host decides whether it happens, applies
    // the safety policy, and checks the grant again on the way out.
    call(deviceId, request) { post({ type: 'command', request: Object.assign({ deviceId: deviceId }, request) }); },
    resize(height) { post({ type: 'size', height: Number(height) || 0 }); },
  };

  addEventListener('error', (e) => post({ type: 'error', message: String(e.message) }));

  try {
${indent(attachment.entry)}
  } catch (err) {
    post({ type: 'error', message: String(err && err.message || err) });
  }
  post({ type: 'ready' });
})();
</script></body></html>`;
}

function escapeAttribute(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Put the element's own source inside a `<script>` without it escaping.
 *
 * A `</script>` in the source ends the element early and the rest is parsed as
 * markup. That is **not** a privilege problem — the document is already
 * running this author's code at this author's privilege, and there is nothing
 * in the frame to escalate to — but it silently breaks a legitimate script
 * that happens to contain the string, which is a real thing to write. `<\/`
 * is the same character sequence to a JavaScript parser and is not a closing
 * tag to an HTML one.
 */
function indent(source: string): string {
  return source
    .replace(/<\/(script)/gi, '<\\/$1')
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/**
 * A running code element.
 *
 * Owns exactly one frame and the listener that talks to it, so disposing is
 * one call and there is no way to dispose half of it.
 */
export class Sandbox {
  private readonly frame: HTMLIFrameElement;
  private readonly nonce: string;
  private readonly grant: ReadonlySet<string>;
  private readonly opts: SandboxOptions;
  private readonly listener: (e: MessageEvent) => void;
  private ready = false;
  private pending: DeviceState[] | undefined;
  private disposed = false;

  constructor(attachment: CodeAttachment, opts: SandboxOptions = {}) {
    this.opts = opts;
    this.grant = new Set(attachment.grant ?? []);
    // Not `Math.random()`: this separates a live frame from a disposed one
    // that is still executing, and a value somebody can guess is a value
    // somebody can forge.
    this.nonce = randomNonce();

    this.frame = document.createElement('iframe');
    // **Never `allow-same-origin` beside `allow-scripts`.** Together they let
    // the frame remove its own sandbox attribute.
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('referrerpolicy', 'no-referrer');
    this.frame.setAttribute('loading', 'lazy');
    this.frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
    this.frame.srcdoc = frameDocument(attachment, this.nonce, opts.connect ?? []);

    this.listener = (e: MessageEvent) => this.receive(e);
    globalThis.addEventListener?.('message', this.listener);
  }

  /** The element to put in the document. */
  get element(): HTMLIFrameElement {
    return this.frame;
  }

  /**
   * Tell the frame about the devices it is allowed to know about.
   *
   * Filtered here, not in the frame: a frame that received everything and was
   * asked to ignore most of it would be a frame that has everything.
   */
  update(devices: readonly DeviceState[]): void {
    if (this.disposed) return;
    const allowed = devices.filter((d) => this.grant.has(d.device_id));
    if (!this.ready) {
      // Before the document has run there is nowhere for this to go. Kept, so
      // the first paint is not empty.
      this.pending = allowed;
      return;
    }
    this.send({ hc: this.nonce, type: 'state', devices: allowed });
  }

  dispose(): void {
    this.disposed = true;
    globalThis.removeEventListener?.('message', this.listener);
    this.frame.remove();
  }

  private send(message: ToFrame): void {
    // `'*'` because the frame has an opaque origin and therefore no origin to
    // name. That is safe in this one direction: the message goes to a window
    // this object created and holds the only reference to.
    this.frame.contentWindow?.postMessage(message, '*');
  }

  private receive(e: MessageEvent): void {
    if (this.disposed) return;
    // Two checks, and both matter. The source check is what stops any other
    // frame on the page from speaking for this one; the nonce is what stops a
    // disposed frame's last message from being taken for a live one's.
    if (e.source !== this.frame.contentWindow) return;
    const m = e.data as FromFrame | undefined;
    if (m === undefined || m === null || m.hc !== this.nonce) return;

    switch (m.type) {
      case 'ready': {
        this.ready = true;
        if (this.pending !== undefined) {
          this.send({ hc: this.nonce, type: 'state', devices: this.pending });
          this.pending = undefined;
        }
        return;
      }
      case 'command': {
        const request = m.request;
        // The grant, checked again on the way out. It was already applied when
        // choosing what to send in — but a frame can name a device it was
        // never told about, and "it could only have learned about these" is
        // not the same claim as "it may only act on these".
        if (typeof request?.deviceId !== 'string' || !this.grant.has(request.deviceId)) {
          this.opts.onError?.(`Not granted: ${String(request?.deviceId)}`);
          return;
        }
        // Handed to the host's own dispatch, so the safety policy (§11.3)
        // applies to a pasted script exactly as it applies to everything else.
        this.opts.onCommand?.({
          deviceId: request.deviceId,
          ...(request.patch !== undefined ? { patch: request.patch } : {}),
          ...(request.action !== undefined ? { action: request.action } : {}),
        });
        return;
      }
      case 'size': {
        // Bounded: a frame that asked for 10^9 pixels would take the page with
        // it, and a code element is exactly the thing that might.
        const height = Math.max(0, Math.min(4000, Math.round(m.height)));
        if (height > 0) this.frame.style.height = `${height}px`;
        return;
      }
      case 'error': {
        this.opts.onError?.(String(m.message));
        return;
      }
    }
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
