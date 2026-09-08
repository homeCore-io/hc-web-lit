/**
 * The icon table (§11.2).
 *
 * A presentation table, deliberately — §1.1 forbids mapping `device_type` to a
 * *behaviour*, and a picture is the opposite case. What these pin is that it
 * degrades the right way: an unknown type gets a mark that says "a device",
 * never a bulb.
 */
import { describe, expect, it } from 'vitest';
import { iconFor, mappedWords, markNames, metricVar } from '../src/design/icons.js';

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
