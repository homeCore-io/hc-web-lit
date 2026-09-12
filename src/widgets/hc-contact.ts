/**
 * A contact sensor — `contact_sensor` ×8 (§7.3).
 *
 * All eight in the reference house report exactly `{ open, battery }`, declare
 * `primary: ["open"]`, and mark `battery` as `diagnostic`. So the widget is
 * small on purpose: one fact, said in the right words, with the battery only
 * when it is worth saying.
 *
 * **"Open" and "Closed", not "On" and "Off".** `isOn` answers truthfully that
 * an open door is on, because `open` is one of the attributes on-ness is
 * derived from (§1.1) — and a card reading "On" beside a door is the same
 * category of invented fact as "Off" beside a thermometer. The derivation is
 * right; the vocabulary is this widget's job.
 *
 * **The face comes from `ui_hint` or an icon rule, never from the name.** §7.3
 * says `ui_hint` picks the door/window/garage face, and in this house **not
 * one of the eight sets it** — every one is `null`, while every name ends in
 * "Door Sensor". The tempting move is to read the name; the reason not to is
 * that a name is a person's words about their house, and a client that quietly
 * derived behaviour from them would be wrong the moment somebody renamed
 * something. `iconFor` already resolves user rule → `ui_hint` → `device_type`,
 * and §11.2's icon rules are exactly the place a household says "anything
 * matching /Door/ is a door" — once, visibly, and shared with the floorplan.
 *
 * **No duration.** §7.3 asks for last-changed and core cannot answer it:
 * `last_change.changed_at` advances on every report whether or not anything
 * changed (homeCore#39), so a door closed since breakfast reads as changed
 * moments ago. Showing nothing is worse for the reader and better for the
 * reader's trust; the number comes back when core can say it.
 */
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import { effectiveName, isOn } from '../core/present.js';
import { registerForDevice, registerWidget } from '../core/registry.js';
import { icon, iconFor } from '../design/icons.js';
import { HcLayoutShell } from '../sdk/shell.js';

/** Below this, a battery is news. Above it, it is noise on a wall panel. */
const LOW_BATTERY = 25;

@customElement('hc-contact')
export class HcContact extends HcLayoutShell {
  static override styles = [
    HcLayoutShell.styles,
    css`
      .low {
        color: var(--hc-accent-warn, #ffc978);
      }
    `,
  ];

  @property({ attribute: false }) device: DeviceState | undefined;

  /** Open, closed, or genuinely unknown. */
  private get open(): boolean | undefined {
    return this.device === undefined ? undefined : isOn(this.device);
  }

  private get battery(): number | undefined {
    const raw = this.device?.attributes?.['battery'] ?? this.device?.attributes?.['battery_pct'];
    return typeof raw === 'number' ? raw : undefined;
  }

  protected override renderIcon() {
    // The user's rule first, then `ui_hint`, then the type — the order
    // `iconFor` already keeps, and the reason this widget needs no table.
    return icon(iconFor(this.device), this.device !== undefined && isOn(this.device) === true);
  }

  protected override renderPrimary() {
    return this.device === undefined ? 'Contact' : effectiveName(this.device);
  }

  protected override renderSecondary() {
    const open = this.open;
    // Not "On"/"Off", and not "Closed" for a sensor that has said nothing.
    return open === undefined ? nothing : open ? 'Open' : 'Closed';
  }

  protected override renderBadge() {
    const battery = this.battery;
    if (battery === undefined || battery > LOW_BATTERY) return nothing;
    // Only when low: a row of eight sensors all reading "100%" is eight
    // numbers nobody reads, and the one at 20% is what somebody needed to see.
    return html`<span class="low" part="trailing">${Math.round(battery)}%</span>`;
  }

  override updated(): void {
    super.updated();
    const open = this.open;
    // Open is the state worth noticing, so open is the state that lights.
    this.style.setProperty(
      '--hc-shell-colour',
      open === true ? 'var(--hc-accent-warn, #ffc978)' : 'var(--hc-ink-muted, #8b95a4)',
    );
    this.style.setProperty('--hc-shell-tint', open === true ? '26%' : '0%');
  }
}

registerWidget('contact', 'hc-contact');
registerForDevice('contact_sensor', 'hc-contact');
// The three faces §7.3 names. A household that sets `ui_hint` gets the right
// word and the right mark; nothing here inspects a name to guess.
registerForDevice('door', 'hc-contact');
registerForDevice('window', 'hc-contact');
registerForDevice('garage', 'hc-contact');

declare global {
  interface HTMLElementTagNameMap {
    'hc-contact': HcContact;
  }
}
