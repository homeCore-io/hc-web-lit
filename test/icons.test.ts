/**
 * The icon table (§11.2).
 *
 * A presentation table, deliberately — §1.1 forbids mapping `device_type` to a
 * *behaviour*, and a picture is the opposite case. What these pin is that it
 * degrades the right way: an unknown type gets a mark that says "a device",
 * never a bulb.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  iconFor,
  iconRules,
  mappedWords,
  markNames,
  metricVar,
  setIconRules,
} from '../src/design/icons.js';

describe('the icon table', () => {
  it('has a mark for every word it maps', () => {
    const marks = new Set(markNames());
    for (const [word, mark] of Object.entries(mappedWords())) {
      expect(marks.has(mark), `${word} → ${mark}`).toBe(true);
    }
  });

  it('lets ui_hint win, because that is what the field is for', () => {
    // A switch a person hinted as a light *is* a light (§1.1). Drawing it as a
    // rocker would make the override cosmetic.
    expect(iconFor({ ui_hint: 'light', device_type: 'switch' })).toBe('light');
    expect(iconFor({ device_type: 'switch' })).toBe('switch');
  });

  it('says "a device" for a type nobody has drawn for', () => {
    // Three devices in the reference house declare no type at all, and the next
    // plugin will invent one nobody has seen.
    expect(iconFor({ device_type: 'quantum_flux_valve' })).toBe('device');
    expect(iconFor({})).toBe('device');
    expect(iconFor(undefined)).toBe('device');
  });

  it('tints the instruments and leaves everything else alone', () => {
    expect(metricVar('temperature')).toBe('--hc-metric-temperature');
    expect(metricVar('water')).toBe('--hc-metric-humidity');
    expect(metricVar('light')).toBeUndefined();
  });
});

describe('a user’s own icon rules', () => {
  afterEach(() => setIconRules([]));

  const dev = (name: string, over: Record<string, unknown> = {}) => ({ name, ...over });

  it('wins over the derived answer, because it is the most specific thing said', () => {
    // The household knows which switch is a string of lights; the bridge does
    // not, and calls it a switch (§11.2).
    setIconRules([{ match: 'holiday', icon: 'scene' }]);
    expect(iconFor(dev('Holiday Lights 1', { device_type: 'switch' }))).toBe('scene');
    expect(iconFor(dev('Kitchen Overhead', { device_type: 'switch' }))).toBe('switch');
  });

  it('takes the first rule that matches, in order', () => {
    setIconRules([
      { match: 'fan', icon: 'fan' },
      { match: 'ceiling', icon: 'light' },
    ]);
    expect(iconFor(dev('Ceiling Fan'))).toBe('fan');
  });

  it('matches the name by default, and other fields when asked', () => {
    setIconRules([{ match: 'garage', icon: 'garage', on: 'area' }]);
    expect(iconFor(dev('Overhead', { area: 'garage', device_type: 'light' }))).toBe('garage');
    // No match, so the derived answer stands.
    expect(iconFor(dev('Overhead', { area: 'kitchen', device_type: 'light' }))).toBe('light');
  });

  it('ignores a rule naming a mark that does not exist', () => {
    // A typo falls through to the derived answer rather than drawing nothing.
    setIconRules([{ match: '.', icon: 'unicorn' }]);
    expect(iconFor(dev('Desk Lamp', { device_type: 'light' }))).toBe('light');
  });

  it('survives a half-typed pattern', () => {
    // These are typed into a live field, so a regex is malformed for as long
    // as somebody is in the middle of writing it. It must not take the page
    // down between keystrokes.
    setIconRules([
      { match: 'Holiday (', icon: 'scene' },
      { match: 'lamp', icon: 'light' },
    ]);
    expect(() => iconFor(dev('Desk Lamp'))).not.toThrow();
    expect(iconFor(dev('Desk Lamp'))).toBe('light');
  });

  it('is nothing at all until somebody writes one', () => {
    expect(iconRules()).toEqual([]);
    expect(iconFor(dev('Desk Lamp', { device_type: 'light' }))).toBe('light');
  });
});
