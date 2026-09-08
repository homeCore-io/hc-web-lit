import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/core/api.js';
import { attributesIn, downsample, pathFor, seriesFor, type Point } from '../src/core/history.js';

/** Rows as the API sends them: every attribute interleaved, newest first. */
const rows: HistoryEntry[] = [
  { attribute: 'battery', recorded_at: '2026-09-08T00:44:00Z', value: 0 },
  { attribute: 'temperature', recorded_at: '2026-09-08T00:44:00Z', value: 72.9 },
  { attribute: 'humidity', recorded_at: '2026-09-08T00:44:00Z', value: 52 },
  { attribute: 'battery_kind', recorded_at: '2026-09-08T00:44:00Z', value: 'binary' },
  { attribute: 'temperature', recorded_at: '2026-09-08T00:14:00Z', value: 71.2 },
  { attribute: 'temperature', recorded_at: '2026-09-07T23:44:00Z', value: 70.2 },
];

describe('seriesFor', () => {
  it('pulls one attribute out of the interleaved rows, oldest first', () => {
    // The API answers newest first; a chart reads left to right.
    const s = seriesFor(rows, 'temperature');
    expect(s?.points.map((p) => p.value)).toEqual([70.2, 71.2, 72.9]);
    expect(s?.min).toBe(70.2);
    expect(s?.max).toBe(72.9);
  });

  it('drops values that are not numbers rather than coercing them', () => {
    // battery_kind is "binary". That is not a zero, and plotting it as one
    // draws a line that is not about anything.
    expect(seriesFor(rows, 'battery_kind')).toBeUndefined();
  });

  it('has nothing to say about an attribute that was never recorded', () => {
    expect(seriesFor(rows, 'co2')).toBeUndefined();
  });

  it('names what the rows actually carry, most-sampled first', () => {
    expect(attributesIn(rows)[0]).toBe('temperature');
    expect(attributesIn(rows)).toContain('humidity');
  });
});

describe('downsample', () => {
  const many: Point[] = Array.from({ length: 1000 }, (_, i) => ({
    at: i,
    value: Math.sin(i / 40),
  }));

  it('leaves a short series alone', () => {
    const few = many.slice(0, 10);
    expect(downsample(few, 240)).toEqual(few);
  });

  it('thins to the target and keeps both ends', () => {
    const out = downsample(many, 240);
    expect(out).toHaveLength(240);
    expect(out[0]).toEqual(many[0]);
    expect(out[out.length - 1]).toEqual(many[many.length - 1]);
  });

  it('keeps the spike, which is the whole reason not to take every Nth point', () => {
    // This house has a sensor that read 119.5 once in a day. A chart that
    // loses that is worse than no chart.
    const spiky: Point[] = Array.from({ length: 500 }, (_, i) => ({ at: i, value: 70 }));
    spiky[321] = { at: 321, value: 119.5 };

    const out = downsample(spiky, 50);
    expect(out.some((p) => p.value === 119.5)).toBe(true);

    // Every-Nth would have missed it, which is what makes this worth doing.
    const everyNth = spiky.filter((_, i) => i % 10 === 0);
    expect(everyNth.some((p) => p.value === 119.5)).toBe(false);
  });

  it('stays in time order', () => {
    const out = downsample(many, 100);
    for (let i = 1; i < out.length; i++) expect(out[i]!.at).toBeGreaterThan(out[i - 1]!.at);
  });
});

describe('pathFor', () => {
  it('spans the box and puts the newest point on the right', () => {
    const s = seriesFor(rows, 'temperature')!;
    const d = pathFor(s, 100, 40);
    expect(d.startsWith('M2.0,')).toBe(true);
    expect(d).toContain('L98.0,');
  });

  it('centres a flat series rather than drawing it at the top', () => {
    // min === max would divide by zero, and a line at the top of the box reads
    // as a maximum.
    const flat = seriesFor(
      [
        { attribute: 't', recorded_at: '2026-09-08T00:00:00Z', value: 20 },
        { attribute: 't', recorded_at: '2026-09-08T01:00:00Z', value: 20 },
      ],
      't',
    )!;
    const d = pathFor(flat, 100, 40);
    expect(d).toBe('M2.0,20.0 L98.0,20.0');
  });

  it('is empty for an empty series rather than throwing', () => {
    expect(pathFor({ attribute: 't', points: [], min: 0, max: 0 }, 100, 40)).toBe('');
  });
});
