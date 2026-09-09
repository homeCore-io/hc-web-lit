/**
 * A code element — someone's pasted script, in a frame that can do nothing
 * it was not given (§8.1, §4.6).
 *
 * The widget is thin on purpose: `Sandbox` owns the frame, the nonce and the
 * grant, and this owns the lifecycle and the part of it a person sees. What
 * matters here is the two things the host still has to get right around an
 * isolated widget.
 *
 * **It subscribes to its grant, not to the store.** A code element with no
 * grant is told nothing and asks for nothing, which is the point: the default
 * for code somebody pasted is that it renders and cannot act.
 *
 * **Its command goes through the host's dispatch like everyone else's.** §5.10
 * puts the safety policy in the host precisely so a widget cannot decline it,
 * and a pasted script is the widget that would. So `onCommand` is the same
 * callback every first-party widget gets — the frame's request arrives having
 * cleared the grant, and then meets `check()` exactly as a tap would.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { registerWidget } from '../core/registry.js';
import { Sandbox, type CodeAttachment } from '../ext/sandbox.js';

@customElement('hc-code')
export class HcCode extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .frame {
      height: 100%;
      border-radius: var(--hc-radius-md, 14px);
      overflow: hidden;
      background: var(--hc-surface-raised, #141922);
    }
    .note {
      padding: 0.75rem;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-accent-danger, #ff7b72);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) devices: readonly DeviceState[] = [];
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** What the frame said went wrong, shown rather than swallowed. */
  @state() private trouble = '';

  private sandbox: Sandbox | undefined;
  /** The attachment the current frame was built from, to know when to rebuild. */
  private built = '';

  private get attachment(): CodeAttachment | undefined {
    const entry = this.config['entry'];
    if (typeof entry !== 'string') return undefined;
    const grant = this.config['grant'];
    return {
      entry,
      grant: Array.isArray(grant) ? grant.filter((g): g is string => typeof g === 'string') : [],
    };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.sandbox?.dispose();
    this.sandbox = undefined;
    this.built = '';
  }

  override updated(): void {
    const attachment = this.attachment;
    if (attachment === undefined) return;

    // Rebuilt only when the code or the grant actually changes. A frame torn
    // down and recreated on every device update would restart the script
    // several times a second, which for 184 streaming devices is not a
    // theoretical rate.
    const signature = JSON.stringify(attachment);
    if (signature !== this.built) {
      this.sandbox?.dispose();
      this.trouble = '';
      this.sandbox = new Sandbox(attachment, {
        onCommand: (r) => this.onCommand?.(r),
        onError: (m) => {
          this.trouble = m;
        },
      });
      this.built = signature;
      this.shadowRoot?.querySelector('.frame')?.replaceChildren(this.sandbox.element);
    }

    this.sandbox?.update(this.devices);
  }

  override render() {
    if (this.attachment === undefined) {
      return html`<div class="note" part="note">This code element has no source.</div>`;
    }
    return html`
      <div class="frame" part="frame"></div>
      ${this.trouble !== '' ? html`<div class="note" part="note">${this.trouble}</div>` : nothing}
    `;
  }
}

registerWidget('code', 'hc-code');

declare global {
  interface HTMLElementTagNameMap {
    'hc-code': HcCode;
  }
}
