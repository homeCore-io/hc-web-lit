/**
 * The transform arithmetic behind §14.1's free mode.
 *
 * Pure functions, tested as such: a gesture that moves a card the wrong way is
 * a bug in here, and finding it through a pointer event and a shadow root is
 * finding it the hard way.
 */
import { describe, expect, it } from 'vitest';
import {
  FINE,
  HANDLES,
  LEAST,
  NEAR,
  alignTo,
  angleFrom,
  boundsOf,
  cellsOf,
  intoFrame,
  pullTo,
  resizedBy,
  snap,
  turnedAbout,
} from '../src/core/geometry.js';

const box = { x: 100, y: 100, w: 200, h: 100 };
/** No magnet, so a test says what the arithmetic did and not what 8 did to it. */
const raw = { step: 0 };

describe('the magnet', () => {
  it('pulls to the nearest edge of whatever grid it is given', () => {
    expect(snap(103, 8)).toBe(104);
    expect(snap(99, 8)).toBe(96);
    expect(snap(100, 120)).toBe(120);
  });

  it('leaves a value alone when there is no grid', () => {
    expect(snap(103, 0)).toBe(103);
  });

  it('is the design system space unit, not a column', () => {
    // A text box snapped to a 120px cell can be 120 wide or 240 and nothing
    // between, so it is never the width of its own words.
    expect(FINE).toBe(8);
  });
});

describe('resizing by a handle', () => {
  it('holds the opposite edge still', () => {
    // The bug everybody ships once: the card changes size and creeps across
    // the page at the same time, because the anchor was taken to be the origin.
    const got = resizedBy(box, 'left', { dx: -40, dy: 0 }, raw);
    expect(got).toEqual({ x: 60, y: 100, w: 240, h: 100 });
    // The right edge is exactly where it was.
    expect(got.x + got.w).toBe(box.x + box.w);
  });

  it('grows from the right without moving the left', () => {
    const got = resizedBy(box, 'right', { dx: 50, dy: 0 }, raw);
    expect(got).toEqual({ x: 100, y: 100, w: 250, h: 100 });
  });

  it('moves only the edges its handle names', () => {
    // Dragging the right edge must not move the top or bottom.
    const got = resizedBy(box, 'right', { dx: 50, dy: 90 }, raw);
    expect(got.y).toBe(box.y);
    expect(got.h).toBe(box.h);
  });

  it('takes both axes from a corner', () => {
    const got = resizedBy(box, 'top-left', { dx: -40, dy: -20 }, raw);
    expect(got).toEqual({ x: 60, y: 80, w: 240, h: 120 });
  });

  it('snaps the edge under the pointer and never the width', () => {
    // Snapping a width would put the far edge wherever the near edge's offset
    // left it, so a card whose left sits off-grid could never have a right on
    // it. Here the left starts at 103 — off the 8-grid — and the right lands
    // on it regardless.
    const off = { x: 103, y: 100, w: 200, h: 100 };
    const got = resizedBy(off, 'right', { dx: 2, dy: 0 }, { step: 8 });
    expect(got.x + got.w).toBe(304);
    expect(got.x).toBe(103);
  });

  it('refuses to turn a card inside out', () => {
    const got = resizedBy(box, 'left', { dx: 900, dy: 0 }, raw);
    expect(got.w).toBe(LEAST);
    // Still anchored to the right edge it was holding.
    expect(got.x + got.w).toBe(box.x + box.w);
  });

  it('respects an element that says it needs more room than the floor', () => {
    // A slider that loses its knob below 64 should not be draggable to 48.
    const got = resizedBy(box, 'right', { dx: -900, dy: 0 }, { ...raw, leastW: 64 });
    expect(got.w).toBe(64);
  });

  it('offers eight, because a composed card has no privileged corner', () => {
    // Pulling the left edge left is a different edit from pulling the right
    // edge right, and one grip makes the first two gestures.
    expect(HANDLES).toHaveLength(8);
  });

  it('leaves a card alone when nothing was dragged', () => {
    for (const handle of HANDLES) {
      expect(resizedBy(box, handle, { dx: 0, dy: 0 }, raw)).toEqual(box);
    }
  });
});

describe('a pointer delta in a rotated card’s own frame', () => {
  it('is itself when nothing is rotated', () => {
    expect(intoFrame(10, 4, 0)).toEqual({ dx: 10, dy: 4 });
  });

  it('turns a screen drag into the card’s axes', () => {
    // A card turned 90° clockwise has its own +x pointing down the screen, so
    // a drag *down* the screen is a drag along its width.
    const got = intoFrame(0, 10, 90);
    expect(got.dx).toBeCloseTo(10, 6);
    expect(got.dy).toBeCloseTo(0, 6);
  });

  it('is reversible, which is the whole claim', () => {
    const there = intoFrame(7, -3, 37);
    const back = intoFrame(there.dx, there.dy, -37);
    expect(back.dx).toBeCloseTo(7, 6);
    expect(back.dy).toBeCloseTo(-3, 6);
  });
});

describe('resizing a card that is rotated — unsolved in the Dart (§14.2)', () => {
  const turned = { x: 100, y: 100, w: 200, h: 100 };

  it('widens a card turned 90° when the pointer goes down the screen', () => {
    // The delta is rotated into the element's frame before the anchor
    // arithmetic runs. Fed the raw screen delta this would have made the card
    // taller, which is the bug.
    const got = resizedBy(turned, 'right', { dx: 0, dy: 60 }, { ...raw, angle: 90 });
    expect(got.w).toBeCloseTo(260, 6);
    expect(got.h).toBeCloseTo(100, 6);
  });

  it('holds the anchor still on screen rather than holding x', () => {
    // Rotation is drawn about the centre, so a rotated card whose x and w
    // changed would swing round its own moving centre and appear to slide
    // sideways while being resized.
    const angle = 90;
    const got = resizedBy(turned, 'right', { dx: 0, dy: 60 }, { ...raw, angle });

    // Where the held edge — the left one — is drawn, before and after.
    const held = (r: typeof turned): { x: number; y: number } => {
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const o = { x: -r.w / 2, y: 0 };
      const rad = (angle * Math.PI) / 180;
      return {
        x: c.x + o.x * Math.cos(rad) - o.y * Math.sin(rad),
        y: c.y + o.x * Math.sin(rad) + o.y * Math.cos(rad),
      };
    };
    expect(held(got).x).toBeCloseTo(held(turned).x, 6);
    expect(held(got).y).toBeCloseTo(held(turned).y, 6);
  });

  it('behaves exactly as the unrotated case at zero degrees', () => {
    for (const handle of HANDLES) {
      const straight = resizedBy(box, handle, { dx: 30, dy: -20 }, raw);
      const declared = resizedBy(box, handle, { dx: 30, dy: -20 }, { ...raw, angle: 0 });
      expect(declared).toEqual(straight);
    }
  });
});

describe('turning a card', () => {
  const centre = { x: 100, y: 100 };

  it('is how far round from where it was grabbed, not where the finger is', () => {
    // Otherwise the card jumps to meet the pointer on the first pixel.
    const grabbed = { x: 200, y: 100 };
    expect(angleFrom(centre, grabbed, { x: 100, y: 200 }, 0)).toBeCloseTo(90, 6);
    expect(angleFrom(centre, grabbed, { x: 200, y: 100 }, 45)).toBeCloseTo(45, 6);
  });

  it('adds to the angle the card already had', () => {
    const grabbed = { x: 200, y: 100 };
    expect(angleFrom(centre, grabbed, { x: 100, y: 200 }, 30)).toBeCloseTo(120, 6);
  });

  it('stays in [0, 360), so one angle has one spelling', () => {
    const grabbed = { x: 200, y: 100 };
    const back = angleFrom(centre, grabbed, { x: 100, y: 0 }, 0);
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(360);
    expect(back).toBeCloseTo(270, 6);
  });
});

describe('the whole-cell approximation core validates', () => {
  // The reference house's composed page.
  const grid = { width: 1240, columns: 12, rowHeight: 120, gap: 12 };

  it('round-trips a rectangle that came from a cell', () => {
    // A card built from `rectOf` must come back the same size it went in,
    // which is why the span includes the gap the card does not own.
    const step = (1240 - 12 * 11) / 12 + 12;
    const rect = { x: 0, y: 0, w: step - 12, h: 120 };
    expect(cellsOf(rect, grid)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('is never something core would reject', () => {
    // Composed off the left edge and wider than the grid: core applies its
    // rules to the cells, so composing a page must not make it unsaveable.
    const outside = { x: -500, y: -500, w: 4000, h: 90 };
    const cells = cellsOf(outside, grid);
    expect(cells.x).toBeGreaterThanOrEqual(0);
    expect(cells.y).toBeGreaterThanOrEqual(0);
    expect(cells.w).toBeGreaterThan(0);
    expect(cells.h).toBeGreaterThan(0);
    expect(cells.x + cells.w).toBeLessThanOrEqual(grid.columns);
  });

  it('pushes a card back rather than narrowing it at the right edge', () => {
    const step = (1240 - 12 * 11) / 12 + 12;
    const wide = { x: 1100, y: 0, w: step * 4 - 12, h: 108 };
    const cells = cellsOf(wide, grid);
    expect(cells.w).toBe(4);
    expect(cells.x + cells.w).toBe(12);
  });

  it('never reports a card with no size', () => {
    expect(cellsOf({ x: 0, y: 0, w: 1, h: 1 }, grid)).toMatchObject({ w: 1, h: 1 });
  });

  it('says something legal for a grid it cannot measure', () => {
    expect(cellsOf(box, { width: 0, columns: 0, rowHeight: 0, gap: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

describe('guides — the third magnet (§14.1)', () => {
  const neighbour = { x: 400, y: 50, w: 100, h: 300 };

  it('pulls an edge onto a neighbour’s, which the grid alone cannot', () => {
    // 397 is three from the neighbour's left at 400, and already on no grid
    // the fine magnet would reach — it would land on 400 by luck here, so the
    // neighbour is placed off-grid to make the two magnets distinguishable.
    const off = { x: 401, y: 50, w: 100, h: 300 };
    const got = alignTo({ x: 300, y: 500, w: 100, h: 40 }, [off]);
    // Its right edge (400) caught the neighbour's left (401).
    expect(got.rect.x).toBe(301);
    expect(got.rect.y).toBe(500);
  });

  it('lines middles up as readily as edges', () => {
    // "Centred on that" is as much an alignment as "flush with that", and a
    // composition has more of the first than a grid ever did. The neighbour's
    // middle is y=200; this card's is 198, two away, and its own edges are 7
    // and 3 away from it — so the middles are what catch.
    const got = alignTo({ x: 0, y: 193, w: 100, h: 10 }, [neighbour]);
    expect(got.rect.y + got.rect.h / 2).toBe(200);
    expect(got.rect.y).toBe(195);
  });

  it('decides each axis on its own', () => {
    // Somebody arranging a row lines up with one neighbour's left edge and
    // another's middle all the time.
    const a = { x: 400, y: 0, w: 200, h: 10 };
    const b = { x: 0, y: 700, w: 10, h: 200 };
    const got = alignTo({ x: 403, y: 703, w: 50, h: 50 }, [a, b]);
    expect(got.rect.x).toBe(400);
    expect(got.rect.y).toBe(700);
  });

  it('leaves a card alone when nothing is near enough', () => {
    const got = alignTo({ x: 50, y: 900, w: 40, h: 40 }, [neighbour]);
    expect(got.rect).toEqual({ x: 50, y: 900, w: 40, h: 40 });
    expect(got.guides).toEqual([]);
  });

  it('reports a line spanning both rectangles, so it says what lined up', () => {
    // A line across the whole page says only that something happened.
    const got = alignTo({ x: 397, y: 500, w: 100, h: 40 }, [neighbour]);
    const guide = got.guides.find((g) => g.axis === 'x');
    expect(guide).toBeDefined();
    expect(guide?.at).toBe(400);
    expect(guide?.from).toBe(50);
    expect(guide?.to).toBe(540);
  });

  it('catches from closer than the grid step, or it would fire on every drag', () => {
    expect(NEAR).toBeLessThan(FINE);
  });
});

describe('a candidate beating the grid', () => {
  it('prefers a nearby line to the nearest grid edge', () => {
    // An edge that snapped to the 8-grid first would land *next* to its
    // neighbour rather than on it, and those last pixels are exactly the ones
    // a person cannot close by hand.
    expect(pullTo(99, 8, [101])).toBe(101);
  });

  it('falls back to the grid when nothing is near', () => {
    expect(pullTo(99, 8, [400])).toBe(96);
    expect(pullTo(99, 8, [])).toBe(96);
  });

  it('takes the closest of several candidates', () => {
    expect(pullTo(100, 8, [104, 102, 97])).toBe(102);
  });
});

describe('resizing against the neighbours', () => {
  const box2 = { x: 100, y: 100, w: 200, h: 100 };
  const neighbour = { x: 401, y: 400, w: 100, h: 100 };

  it('lands a pulled edge on a neighbour’s rather than on the grid', () => {
    const got = resizedBy(box2, 'right', { dx: 99, dy: 0 }, { near: [neighbour] });
    // The right edge went to 399, and the neighbour's left at 401 caught it.
    expect(got.x + got.w).toBe(401);
  });

  it('still uses the fine grid where no neighbour is near', () => {
    const got = resizedBy(box2, 'right', { dx: 3, dy: 0 }, { near: [neighbour] });
    expect(got.x + got.w).toBe(304);
  });

  it('ignores guides for a rotated card, whose edges line up with nothing', () => {
    // What would be matched is the unrotated footprint, which is nowhere a
    // person can see.
    const got = resizedBy(box2, 'right', { dx: 99, dy: 0 }, { near: [neighbour], angle: 45 });
    expect(got.x + got.w).not.toBe(401);
  });
});

describe('turning a group about its own centre (§14.1)', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 200, y: 0, w: 100, h: 100 };

  it('finds the box the cluster sits in', () => {
    expect(boundsOf([a, b])).toEqual({ x: 0, y: 0, w: 300, h: 100 });
    expect(boundsOf([])).toBeUndefined();
  });

  it('orbits each card as well as turning it', () => {
    // The thing an element's own angle cannot express: a rotation that only
    // added to each angle would spin the cards in place and leave five of them
    // pointing somewhere new, still in a straight row.
    const about = { x: 150, y: 50 };
    const got = turnedAbout(a, 0, 90, about);
    // `a`'s centre was 100 left of the pivot; a quarter turn clockwise puts it
    // 100 above it.
    expect(got.rect.x + got.rect.w / 2).toBeCloseTo(150, 6);
    expect(got.rect.y + got.rect.h / 2).toBeCloseTo(-50, 6);
    expect(got.angle).toBeCloseTo(90, 6);
  });

  it('keeps the cluster rigid, so the gap between members survives', () => {
    const about = { x: 150, y: 50 };
    const turnedA = turnedAbout(a, 0, 37, about);
    const turnedB = turnedAbout(b, 0, 37, about);
    const apart = (p: typeof a, q: typeof a): number =>
      Math.hypot(p.x + p.w / 2 - (q.x + q.w / 2), p.y + p.h / 2 - (q.y + q.h / 2));
    expect(apart(turnedA.rect, turnedB.rect)).toBeCloseTo(apart(a, b), 6);
  });

  it('adds to whatever angle a card was already at', () => {
    // Which is what keeps a group of already-rotated cards rigid as it turns.
    expect(turnedAbout(a, 30, 45, { x: 150, y: 50 }).angle).toBeCloseTo(75, 6);
  });

  it('keeps one spelling per angle', () => {
    const got = turnedAbout(a, 350, 30, { x: 150, y: 50 });
    expect(got.angle).toBeCloseTo(20, 6);
    expect(got.angle).toBeGreaterThanOrEqual(0);
    expect(got.angle).toBeLessThan(360);
  });

  it('leaves the size alone, because rect is the unrotated footprint', () => {
    const got = turnedAbout(a, 0, 41, { x: 150, y: 50 });
    expect(got.rect.w).toBe(a.w);
    expect(got.rect.h).toBe(a.h);
  });

  it('is the ordinary rotation when a card is turned about itself', () => {
    const centre = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const got = turnedAbout(a, 0, 90, centre);
    expect(got.rect.x).toBeCloseTo(a.x, 6);
    expect(got.rect.y).toBeCloseTo(a.y, 6);
    expect(got.angle).toBeCloseTo(90, 6);
  });
});
