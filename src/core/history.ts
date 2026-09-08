/**
 * Turning history rows into a series you can draw.
 *
 * `GET /devices/{id}/history` returns every attribute interleaved, newest
 * first, with `limit` counting *rows*. A day of one ecowitt sensor is 303 rows
 * for 117 temperature points — the rest is humidity and battery metadata — so
 * the client pays for attributes it did not ask about and truncates at the cap
 * without saying so.
 *
 * §5.9 (P8) is about moving the filtering and thinning to the server, where a
 * chart asking for 400 points over 7 days gets 400 points instead of 200,000
 * rows. Until then this does it here, and the shape of the API it wants is
 * exactly the shape of these functions.
 */
import type { HistoryEntry } from './api.js';

export interface Point {
  at: number;
  value: number;
}

export interface Series {
  attribute: string;
  points: Point[];
  min: number;
  max: number;
}

/**
 * One attribute's numeric points, oldest first.
 *
 * Non-numeric values are dropped rather than coerced: a `battery_kind` of
 * `"binary"` is not a zero, and plotting it as one draws a line that is not
 * about anything.
 */
export function seriesFor(rows: readonly HistoryEntry[], attribute: string): Series | undefined {
  const points: Point[] = [];
  for (const r of rows) {
    if (r.attribute !== attribute) continue;
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
    const at = Date.parse(r.recorded_at);
    if (Number.isNaN(at)) continue;
    points.push({ at, value: r.value });
  }
  if (points.length === 0) return undefined;

  // The API answers newest first; a chart reads left to right.
  points.sort((a, b) => a.at - b.at);

  let min = points[0]!.value;
  let max = min;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  return { attribute, points, min, max };
}

/** Which attributes the rows actually carry, most-sampled first. */
export function attributesIn(rows: readonly HistoryEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.attribute, (counts.get(r.attribute) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/**
 * Thin a series to at most `target` points, keeping its shape.
 *
 * **Largest-Triangle-Three-Buckets**, which is what §5.9 names for the
 * server-side version. Picking every Nth point instead would drop exactly the
 * spikes a person is looking at — this house has a sensor that read 119.5°F
 * once in a day, and a chart that loses that is worse than no chart.
 *
 * First and last points are always kept, so the line still spans the window.
 */
export function downsample(points: readonly Point[], target: number): Point[] {
  if (target < 3 || points.length <= target) return [...points];

  const out: Point[] = [points[0]!];
  const every = (points.length - 2) / (target - 2);

  let a = 0;
  for (let i = 0; i < target - 2; i++) {
    // The average of the *next* bucket, which is the third corner of the
    // triangle whose area we maximise.
    const nextStart = Math.floor((i + 1) * every) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * every) + 1, points.length);
    let avgAt = 0;
    let avgValue = 0;
    const n = Math.max(nextEnd - nextStart, 1);
    for (let j = nextStart; j < nextEnd; j++) {
      avgAt += points[j]!.at;
      avgValue += points[j]!.value;
    }
    avgAt /= n;
    avgValue /= n;

    const start = Math.floor(i * every) + 1;
    const end = Math.floor((i + 1) * every) + 1;
    const pa = points[a]!;

    let best = start;
    let bestArea = -1;
    for (let j = start; j < end && j < points.length; j++) {
      const p = points[j]!;
      const area = Math.abs(
        (pa.at - avgAt) * (p.value - pa.value) - (pa.at - p.at) * (avgValue - pa.value),
      );
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(points[best]!);
    a = best;
  }

  out.push(points[points.length - 1]!);
  return out;
}

/** An SVG path through the points, scaled into a `width` × `height` box. */
export function pathFor(series: Series, width: number, height: number, pad = 2): string {
  const { points, min, max } = series;
  if (points.length === 0) return '';

  const t0 = points[0]!.at;
  const t1 = points[points.length - 1]!.at;
  const span = t1 - t0 || 1;
  // A flat series would divide by zero and, drawn at the top of the box, would
  // read as a maximum. Centre it instead.
  const range = max - min || 1;
  const flat = max === min;

  return points
    .map((p, i) => {
      const x = pad + ((p.at - t0) / span) * (width - pad * 2);
      const y = flat ? height / 2 : height - pad - ((p.value - min) / range) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * A rounded scale for an axis: a low, a high, and the lines between.
 *
 * **Not min..max.** A sensor swinging 71.4 to 77.4 fills the whole plot when
 * the axis is exactly its range, and every wobble reads as a cliff. Rounding
 * out to a sensible step tells the truth about the size of the swing — the same
 * data on a 70–80 axis is visibly a six-degree oscillation rather than chaos.
 *
 * The step is chosen from the 1/2/5 ladder, which is what produces labels a
 * person reads without decoding.
 */
export function niceScale(
  min: number,
  max: number,
  targetLines = 4,
): {
  lo: number;
  hi: number;
  step: number;
  lines: number[];
} {
  // A flat series still needs a scale, and one with no height cannot be drawn.
  if (!(max > min)) {
    const pad = Math.abs(max) > 1 ? Math.abs(max) * 0.05 : 1;
    min = max - pad;
    max = max + pad;
  }

  const raw = (max - min) / Math.max(1, targetLines);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;

  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;

  const lines: number[] = [];
  // Accumulate by index rather than by adding `step` repeatedly: floating point
  // drift otherwise puts a gridline at 72.99999999.
  for (let i = 0; lo + i * step <= hi + step / 1000; i++) lines.push(lo + i * step);

  return { lo, hi, step, lines };
}

/** A time, as short as it can be and still unambiguous over the window. */
export function clockLabel(at: number, spanMs: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  // Over a day or more the hour alone is not enough to place a point.
  if (spanMs > 36 * 3600_000) {
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }
  return `${hh}:${mm}`;
}

/** The point nearest an x position, for a hover readout. */
export function nearest(points: readonly Point[], t: number): Point | undefined {
  if (points.length === 0) return undefined;
  let best = points[0]!;
  let bestGap = Math.abs(best.at - t);
  for (const p of points) {
    const gap = Math.abs(p.at - t);
    if (gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}
