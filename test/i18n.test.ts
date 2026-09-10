/**
 * Locale, units and words (§4.2).
 *
 * Two properties carry most of the risk. The first is that **nothing is
 * converted unasked**: a plugin publishes a unit, and a client that helpfully
 * converts a value nobody asked about invents a fact — this house already has
 * a plugin declaring °C on an attribute it publishes in °F (homeCore#40). The
 * second is that introducing this must not change what the household is
 * already reading, which is why the English assertions below are the strings
 * this client produced by hand before any of it existed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMessages,
  clock,
  convert,
  day,
  locale,
  number,
  preferences,
  quantity,
  registerMessages,
  setPreferences,
  since,
  t,
  units,
} from '../src/core/i18n.js';

afterEach(() => {
  setPreferences({});
  clearMessages();
});

describe('which locale is in force', () => {
  it('is the one chosen, then the browser’s', () => {
    expect(locale()).toBe(globalThis.navigator.language);
    setPreferences({ locale: 'fr-FR' });
    expect(locale()).toBe('fr-FR');
  });

  it('keeps the region, because that is where the difference lives', () => {
    // en-GB reads 17:05 and en-US reads 5:05 PM. Collapsing either to `en`
    // picks one household's convention for the other.
    setPreferences({ locale: 'en-GB' });
    expect(clock(new Date(2026, 0, 1, 17, 5))).toBe('17:05');
    setPreferences({ locale: 'en-US' });
    expect(clock(new Date(2026, 0, 1, 17, 5))).toBe('5:05 PM');
  });

  it('takes a household’s clock over its locale’s', () => {
    setPreferences({ locale: 'en-US', clock: '24' });
    expect(clock(new Date(2026, 0, 1, 17, 5))).toBe('17:05');
    setPreferences({ locale: 'en-GB', clock: '12' });
    expect(clock(new Date(2026, 0, 1, 17, 5))).toBe('5:05 pm');
  });
});

describe('numbers, in the reader’s own marks', () => {
  it('formats with the locale’s separators', () => {
    setPreferences({ locale: 'en-US' });
    expect(number(1234.5, { maximumFractionDigits: 1 })).toBe('1,234.5');
    setPreferences({ locale: 'de-DE' });
    expect(number(1234.5, { maximumFractionDigits: 1 })).toBe('1.234,5');
  });

  it('rounds by how much a glance can use, not by locale', () => {
    // The rule this client already used: whole numbers from a hundred up, one
    // decimal below. What the locale decides is the mark, not the precision.
    setPreferences({ locale: 'en-US' });
    expect(quantity(27.66, 'lux')).toBe('27.7 lux');
    expect(quantity(1234.56, 'W')).toBe('1,235 W');
    expect(quantity(45.2, '%')).toBe('45.2%');
    expect(quantity(3)).toBe('3');
  });
});

describe('units', () => {
  it('converts nothing until somebody asks', () => {
    // The default, and the one that cannot invent a fact.
    expect(units()).toEqual({});
    expect(convert(20.5, '°C')).toEqual({ value: 20.5, unit: '°C' });
    expect(quantity(20.5, '°C')).toBe('20.5 °C');
  });

  it('converts from the unit the value is actually in', () => {
    setPreferences({ locale: 'en-US', temperature: 'F' });
    expect(quantity(20, '°C')).toBe('68 °F');
    // Already in the wanted unit: left alone rather than converted twice,
    // which is the failure mode homeCore#40 sets up — a plugin declaring one
    // unit and publishing another.
    expect(quantity(68, '°F')).toBe('68 °F');
  });

  it('goes back the other way', () => {
    setPreferences({ locale: 'en-US', temperature: 'C' });
    expect(quantity(68, '°F')).toBe('20 °C');
    setPreferences({ locale: 'en-US', length: 'in' });
    expect(quantity(2.54, 'cm')).toBe('1 in');
  });

  it('leaves a unit nobody has a preference about alone', () => {
    // The behaviour that has to survive a plugin inventing a unit next week.
    setPreferences({ locale: 'en-US', temperature: 'F', length: 'in' });
    expect(quantity(340, 'ppm')).toBe('340 ppm');
    expect(quantity(12.5, 'kWh')).toBe('12.5 kWh');
    expect(quantity(300, 'K')).toBe('300 K');
  });
});

describe('how long ago', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');

  it('says what this client has always said, in English', () => {
    // Narrow English is exactly the shape the hand-written version produced,
    // so nothing a household has been reading for months changes today.
    setPreferences({ locale: 'en-US' });
    expect(since(now - 30_000, now)).toBe('just now');
    expect(since(now - 120_000, now)).toBe('2m ago');
    expect(since(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(since(now - 50 * 3600_000, now)).toBe('2d ago');
    expect(since(0, now)).toBe('not yet');
  });

  it('says it in the locale’s own idiom elsewhere', () => {
    setPreferences({ locale: 'de-DE' });
    expect(since(now - 120_000, now)).toContain('2');
    expect(since(now - 120_000, now)).not.toContain('ago');
  });

  it('does not run backwards for a clock that is ahead', () => {
    expect(since(now + 60_000, now)).toBe('just now');
  });
});

describe('words', () => {
  it('passes English through when nothing translates it', () => {
    // The English is the key, so adopting `t` one call at a time can never
    // leave a dotted identifier on screen.
    expect(t('Off')).toBe('Off');
    expect(t('{n} devices', { n: 4 })).toBe('4 devices');
  });

  it('uses a catalogue when there is one', () => {
    setPreferences({ locale: 'de-DE' });
    registerMessages('de-DE', { Off: 'Aus' });
    expect(t('Off')).toBe('Aus');
    expect(t('On')).toBe('On');
  });

  it('falls back from a region to its language', () => {
    // A Canadian French catalogue that does not exist should not mean no
    // French at all.
    registerMessages('fr', { Off: 'Arrêt' });
    setPreferences({ locale: 'fr-CA' });
    expect(t('Off')).toBe('Arrêt');
  });

  it('leaves a substitution it was given nothing for', () => {
    expect(t('{n} devices')).toBe('{n} devices');
  });
});

describe('what is stored', () => {
  it('is a copy, so nothing can change it by holding it', () => {
    const mine = { locale: 'fr-FR' };
    setPreferences(mine);
    mine.locale = 'de-DE';
    expect(locale()).toBe('fr-FR');
    const got = preferences();
    got.locale = 'es-ES';
    expect(locale()).toBe('fr-FR');
  });

  it('formats a day without a year, in the locale’s order', () => {
    const at = new Date(2026, 8, 8);
    setPreferences({ locale: 'en-GB' });
    expect(day(at)).toBe('8 Sept');
    setPreferences({ locale: 'en-US' });
    expect(day(at)).toBe('Sep 8');
  });
});
