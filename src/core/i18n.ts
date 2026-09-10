/**
 * Locale, units and words — Phase 4's i18n scaffolding (§4.2).
 *
 * `HcContext` has declared `locale` and `units` since §4.2 was written, and
 * nothing supplied them: every number in this client was formatted with a
 * template string, every clock was `HH:MM` with the hours padded by hand, and
 * every reading was drawn in whatever unit the plugin happened to publish.
 * None of that is wrong in this house and all of it is wrong in the next one —
 * a French household reads `20,5`, a German one reads `20,5 °C` with a
 * non-breaking space, and an American one reading a Hue sensor's `°C` gets a
 * number that means nothing to them.
 *
 * **Scaffolding that is used, not a hook for later.** Everything here has a
 * caller: `formatReading` (§1.1) goes through `quantity`, the shell's "last
 * heard" through `since`, the event feed and the chart axis through `clock`.
 * A `t()` nobody calls would rot, so the message form below is one that costs
 * nothing to adopt: **the English text is the key**. Passing a string through
 * `t` never breaks it, and a locale with no catalogue is exactly today's
 * behaviour.
 *
 * **Nothing is converted unasked.** A plugin publishes a unit and this client
 * is in no position to guess that somebody wanted a different one — and the
 * guess would be wrong in a specific way that has already bitten us
 * (homeCore#40: Hue *declares* °C and *publishes* °F). So a conversion happens
 * only when a person has said which unit they want, and only from the unit the
 * value is actually in, which `facet.ts` already resolves.
 *
 * Module state, like the icon rules and for the same reason: a preference is a
 * property of the household, not an argument every caller should have to
 * thread. `Authored.apply()` puts what was saved into force at startup.
 */

/** What a person chose. Everything is optional; absent means "as it comes". */
export interface Preferences {
  /** A BCP 47 tag. Absent means the browser's. */
  locale?: string;
  /** Show temperatures in this, converting where needed. Absent: as published. */
  temperature?: 'C' | 'F';
  /** Show lengths in this. Absent: as published. */
  length?: 'cm' | 'in';
  /** Absent means whatever the locale does. */
  clock?: '12' | '24';
}

let chosen: Preferences = {};
const catalogues = new Map<string, Record<string, string>>();

/** Put a household's choices into force. */
export function setPreferences(next: Preferences): void {
  chosen = { ...next };
  formatters.clear();
}

/** What is in force. */
export function preferences(): Preferences {
  return { ...chosen };
}

/**
 * The locale in force.
 *
 * The chosen one, then the browser's, then English — and never a bare `en`
 * where the browser said `en-GB`, because the difference between those two is
 * the difference between 14:32 and 2:32 pm.
 */
export function locale(): string {
  return chosen.locale ?? globalThis.navigator?.language ?? 'en';
}

/** The units in force, for `HcContext` and the expression scope (§6.4). */
export function units(): { temperature?: 'C' | 'F'; length?: 'cm' | 'in' } {
  return {
    ...(chosen.temperature !== undefined ? { temperature: chosen.temperature } : {}),
    ...(chosen.length !== undefined ? { length: chosen.length } : {}),
  };
}

/**
 * A catalogue for a locale: English text to the words to show instead.
 *
 * Additive, so an extension can ship the words for its own widget without
 * shipping — or overwriting — the words for everything else.
 */
export function registerMessages(tag: string, messages: Record<string, string>): void {
  catalogues.set(tag, { ...catalogues.get(tag), ...messages });
}

/** Forget every catalogue. For tests, and for a locale switch that reloads. */
export function clearMessages(): void {
  catalogues.clear();
}

/**
 * The text to show, and its substitutions.
 *
 * **The English is the key**, so this is safe to introduce one call at a time:
 * an untranslated string passes through unchanged rather than rendering as
 * `widget.device.off`, which is what a key-based catalogue shows whenever
 * somebody forgets an entry. The trade is that changing the English text
 * orphans its translations — which is the right way round for a client that
 * has no translations yet and a lot of English.
 *
 * Falls back from `fr-CA` to `fr`: a Canadian French catalogue that does not
 * exist should not mean no French at all.
 */
export function t(text: string, params?: Record<string, string | number>): string {
  const tag = locale();
  const language = tag.split('-')[0] ?? tag;
  const found = catalogues.get(tag)?.[text] ?? catalogues.get(language)?.[text] ?? text;

  if (params === undefined) return found;
  return found.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Formatters, kept because building one is expensive.
 *
 * `Intl.NumberFormat` construction is measurably slow, and a device grid
 * formats a reading per device per frame on a tablet. Cleared whenever the
 * preferences change, which is the only thing that can invalidate one.
 */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n:${locale()}:${JSON.stringify(options)}`;
  const got = formatters.get(key);
  if (got !== undefined) return got as Intl.NumberFormat;
  const made = new Intl.NumberFormat(locale(), options);
  formatters.set(key, made);
  return made;
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d:${locale()}:${JSON.stringify(options)}`;
  const got = formatters.get(key);
  if (got !== undefined) return got as Intl.DateTimeFormat;
  const made = new Intl.DateTimeFormat(locale(), options);
  formatters.set(key, made);
  return made;
}

/** A number, in this locale's digits and separators. */
export function number(value: number, options: Intl.NumberFormatOptions = {}): string {
  return numberFormat(options).format(value);
}

/**
 * The unit a value should be shown in, and the value in it.
 *
 * Only ever between the pairs a person can express a preference about, and
 * only when they have. Anything else — `lux`, `ppm`, `W`, a unit no table
 * here has heard of — passes through untouched, which is the behaviour that
 * has to survive a plugin inventing a unit next week.
 */
export function convert(value: number, unit: string | undefined): { value: number; unit?: string } {
  const want = chosen.temperature;
  if (unit === '°C' && want === 'F') return { value: value * 1.8 + 32, unit: '°F' };
  if (unit === '°F' && want === 'C') return { value: (value - 32) / 1.8, unit: '°C' };

  const length = chosen.length;
  if (unit === 'cm' && length === 'in') return { value: value / 2.54, unit: 'in' };
  if (unit === 'in' && length === 'cm') return { value: value * 2.54, unit: 'cm' };

  return unit === undefined ? { value } : { value, unit };
}

/**
 * A reading, converted if asked and formatted for this locale.
 *
 * The rounding is the rule this client already used — a whole number from a
 * hundred up, one decimal below it — kept because it is about how much
 * precision a glance can use, which is not a locale question. What the locale
 * decides is the separator, the decimal mark, and whether a space goes before
 * the unit.
 */
export function quantity(value: number, unit?: string): string {
  const shown = convert(value, unit);
  const digits = Math.abs(shown.value) >= 100 ? 0 : 1;
  const text = number(shown.value, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });

  if (shown.unit === undefined) return text;
  // A percent sits against its number in every locale this client has met;
  // everything else gets the narrow space a person expects to see.
  return shown.unit === '%' ? `${text}%` : `${text} ${shown.unit}`;
}

/** A wall clock, in this locale's convention unless a person chose one. */
export function clock(at: Date): string {
  const hour12 = chosen.clock === '12' ? true : chosen.clock === '24' ? false : undefined;
  return dateFormat({
    hour: 'numeric',
    minute: '2-digit',
    ...(hour12 !== undefined ? { hour12 } : {}),
  }).format(at);
}

/** A day without a year: a chart axis, a feed older than today. */
export function day(at: Date): string {
  return dateFormat({ day: 'numeric', month: 'short' }).format(at);
}

/**
 * How long ago, coarsely.
 *
 * Coarse on purpose, and that predates this file: nobody in front of a panel
 * needs seconds, and a number that ticks draws the eye to itself rather than
 * to what it is about. What is new is that the *words* are the locale's —
 * `Intl.RelativeTimeFormat` says "vor 3 Minuten" where a template string said
 * "3m ago" in every language.
 */
export function since(at: number, now = Date.now()): string {
  if (at === 0) return t('not yet');
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return t('just now');

  // Narrow, because narrow English is exactly the shape this client already
  // used by hand — "2m ago", "3h ago", "2d ago" — so the words a household
  // has been reading for months do not change on the day this lands, and
  // every other locale gets its own idiom instead of that shape transliterated.
  const relative = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'narrow' });
  const mins = Math.round(secs / 60);
  if (mins < 60) return relative.format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return relative.format(-Math.round(hours / 24), 'day');
}
