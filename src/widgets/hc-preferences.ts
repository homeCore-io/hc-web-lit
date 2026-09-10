/**
 * Locale, units and clock — the household's own settings (§4.2).
 *
 * The three preferences `HcContext` has declared since §4.2 and nothing could
 * set. Small on purpose: this is not a settings page, it is the four choices
 * that change how every reading in the house is *read*, and each one shows its
 * effect in the line underneath it rather than after a save and a reload.
 *
 * **"As published" is a real choice and the default.** A plugin publishes a
 * unit; converting a reading nobody asked to have converted is how a client
 * invents a fact, and this house has a live example — Hue declares °C on an
 * attribute it publishes in °F (homeCore#40). So the temperature and length
 * fields start at "as published" and stay there until somebody says otherwise.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { clock, preferences, quantity, since, type Preferences } from '../core/i18n.js';
import { registerWidget } from '../core/registry.js';

/** What a person can pick, and what each choice is called. */
const CHOICES = {
  temperature: [
    { value: '', label: 'as published' },
    { value: 'C', label: '°C' },
    { value: 'F', label: '°F' },
  ],
  length: [
    { value: '', label: 'as published' },
    { value: 'cm', label: 'centimetres' },
    { value: 'in', label: 'inches' },
  ],
  clock: [
    { value: '', label: "as the locale's" },
    { value: '12', label: '12 hour' },
    { value: '24', label: '24 hour' },
  ],
} as const;

@customElement('hc-preferences')
export class HcPreferences extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--hc-ink, #e9edf2);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    .row {
      display: grid;
      grid-template-columns: minmax(5rem, 8rem) 1fr;
      gap: 0.375rem;
      align-items: center;
      padding: 0.375rem 0;
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
    }
    .name {
      color: var(--hc-ink-muted, #8b95a4);
    }
    input,
    select {
      min-height: var(--hc-density-min-tap, 44px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      padding: 0 0.5rem;
      font: inherit;
      width: 100%;
      min-width: 0;
    }
    input:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    .effect {
      grid-column: 2;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-caption-size, 11px);
    }
  `;

  @property({ attribute: false }) config: Record<string, unknown> = {};
  /** Persist, and put them into force. Absent means read-only. */
  @property({ attribute: false }) onSavePreferences: ((next: Preferences) => void) | undefined;

  private edit(patch: Preferences): void {
    const next = { ...preferences(), ...patch };
    for (const key of Object.keys(next) as (keyof Preferences)[]) {
      if (next[key] === undefined || next[key] === '') delete next[key];
    }
    this.onSavePreferences?.(next);
    this.requestUpdate();
  }

  /**
   * Point each select at what is in force.
   *
   * After render: a `select` cannot be told its value before its options
   * exist, which showed the wrong icon on every rule in the icon editor for a
   * day before anybody read one back off a live page.
   */
  override updated(): void {
    const now = preferences();
    this.shadowRoot?.querySelectorAll<HTMLSelectElement>('select[data-key]').forEach((el) => {
      const key = el.dataset['key'] as 'temperature' | 'length' | 'clock';
      const want = now[key] ?? '';
      if (el.value !== want) el.value = want;
    });
  }

  private choice(key: 'temperature' | 'length' | 'clock', label: string, effect: string) {
    return html`<div class="row" part="row">
      <span class="name">${label}</span>
      <select
        part="select"
        aria-label=${label}
        data-key=${key}
        @change=${(e: Event) =>
          this.edit({ [key]: (e.target as HTMLSelectElement).value } as Preferences)}
      >
        ${CHOICES[key].map((c) => html`<option value=${c.value}>${c.label}</option>`)}
      </select>
      <span class="effect" part="state">${effect}</span>
    </div>`;
  }

  override render() {
    if (this.onSavePreferences === undefined) return nothing;
    const now = preferences();
    const noon = new Date(2026, 0, 1, 17, 5);

    return html`
      <div class="row" part="row">
        <span class="name">Language</span>
        <input
          part="select"
          type="text"
          aria-label="Language"
          placeholder=${globalThis.navigator?.language ?? 'en'}
          .value=${now.locale ?? ''}
          @change=${(e: Event) => this.edit({ locale: (e.target as HTMLInputElement).value })}
        />
        <span class="effect" part="state">
          ${
            // Every effect below is the real formatter on a real value, so a
            // tag somebody typed wrongly shows itself here rather than on a
            // page somewhere else.
            now.locale === undefined
              ? html`Blank follows this browser — ${globalThis.navigator?.language ?? 'en'}.`
              : html`${quantity(1234.5, 'W')} · ${since(Date.now() - 7_200_000)}`
          }
        </span>
      </div>

      ${this.choice('temperature', 'Temperature', `A sensor at 20.5 °C reads ${quantity(20.5, '°C')}.`)}
      ${this.choice('length', 'Length', `A gap of 30 cm reads ${quantity(30, 'cm')}.`)}
      ${this.choice('clock', 'Clock', `An event at 17:05 reads ${clock(noon)}.`)}
    `;
  }
}

registerWidget('preferences', 'hc-preferences');

declare global {
  interface HTMLElementTagNameMap {
    'hc-preferences': HcPreferences;
  }
}
