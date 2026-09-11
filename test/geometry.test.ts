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
  angleFrom,
  cellsOf,
  intoFrame,
  resizedBy,
  snap,
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
