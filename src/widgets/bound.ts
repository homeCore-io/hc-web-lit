/**
 * A widget bound to one writable attribute.
 *
 * `toggle`, `stepper` and `thermostat` are the same widget three times over:
 * each names a device and an attribute, reads what the plugin declared about
 * it, and asks the host to change it. The part worth sharing is not the
 * drawing — that is what makes them three widgets — but the two rules that are
 * easy to get subtly wrong in each.
 *
 * **A command is accepted, not applied.** Core answers 202 and the real value
 * arrives on the event stream, so a control that showed only the live value
 * snaps back under the finger for the length of a round trip and reads as
 * broken. The moved value is held until the house says otherwise, and whatever
 * the house says wins the moment it says it.
 *
 * **The host performs it, and the widget never does.** A widget builds a
 * `CommandRequest` and hands it over, which is what puts the safety policy
 * (§11.3) and the confirmation in one place rather than in each widget's good
 * intentions. No `onCommand` means read-only, and a control that cannot act
 * should say so rather than accept a press that does nothing.
 */
import { LitElement } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { AttributeSchema } from '../core/api.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';

export abstract class HcBoundControl extends LitElement {
  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) device: DeviceState | undefined;
  /** The host's command sink. Absent means read-only (§19.4). */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;

  /** Moved by the user, not yet confirmed by the house. */
  @state() protected pending: Record<string, unknown> = {};

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('device')) this.pending = {};
  }

  protected get readOnly(): boolean {
    return this.onCommand === undefined;
  }

  /** The attribute this widget is about, from config. */
  protected key(name = 'attribute'): string {
    const v = this.config[name];
    return typeof v === 'string' ? v : '';
  }

  protected text(name: string, fallback = ''): string {
    const v = this.config[name];
    return typeof v === 'string' && v !== '' ? v : fallback;
  }

  protected number(name: string, fallback: number): number {
    const v = this.config[name];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  /** What the plugin declared about an attribute, if it declared anything. */
  protected declared(key: string): AttributeSchema | undefined {
    return this.device?.schema?.attributes?.[key];
  }

  /** The value to draw: what was moved, else what the house says. */
  protected current(key: string): unknown {
    if (key in this.pending) return this.pending[key];
    return this.device?.attributes[key];
  }

  /** Ask the house, and hold the moved value meanwhile. */
  protected write(key: string, value: unknown): void {
    const id = this.device?.device_id;
    if (id === undefined || this.readOnly) return;
    this.pending = { ...this.pending, [key]: value };
    this.onCommand?.({ deviceId: id, patch: { [key]: value } });
  }
}
