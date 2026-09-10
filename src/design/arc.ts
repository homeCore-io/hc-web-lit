/**
 * The arc a dial draws.
 *
 * Lifted out of `hc-gauge` when the portable render tree (§4.6) needed the
 * same instrument: `gauge` is an element kind a plugin can put in a render,
 * and two implementations of one dial is two dials that disagree about where
 * 60% is.
 *
 * Angles are degrees clockwise from the top, which is what core's defaults
 * describe: 135 through 270 starts at the lower right and ends at the lower
 * left, the shape every dial on a dashboard has.
 */

/** A point on the dial, in the 0..100 box the SVG draws in. */
export function at(degrees: number, radius: number): [number, number] {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(rad), 50 + radius * Math.sin(rad)];
}

/** The arc from one angle to another, clockwise. */
export function arc(from: number, sweep: number, radius: number): string {
  // A full circle has no arc: the two ends coincide and the path draws
  // nothing, which is worse than the ring somebody asked for.
  const span = Math.min(Math.abs(sweep), 359.99) * Math.sign(sweep || 1);
  const [x1, y1] = at(from, radius);
  const [x2, y2] = at(from + span, radius);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${Math.abs(span) > 180 ? 1 : 0} ${
    span < 0 ? 0 : 1
  } ${x2} ${y2}`;
}
