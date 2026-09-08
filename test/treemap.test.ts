import { describe, expect, it } from 'vitest';
import { squarify } from '../src/core/treemap.js';

const room = (name: string, value: number) => ({ name, value });

describe('squarify', () => {
  it('fills the box exactly', () => {
    // Every pixel belongs to some room: the areas sum to the box, so a gap
    // would mean a room was lost rather than drawn small.
    const cells = squarify([room('a', 5), room('b', 3), room('c', 2)], 400, 300);
    const area = cells.reduce((sum, c) => sum + c.w * c.h, 0);
    expect(area).toBeCloseTo(400 * 300, 3);
  });

  it('gives each room area in proportion to its weight', () => {
    const cells = squarify([room('big', 6), room('small', 2)], 200, 100);
    const big = cells.find((c) => c.item.name === 'big')!;
    const small = cells.find((c) => c.item.name === 'small')!;
    expect((big.w * big.h) / (small.w * small.h)).toBeCloseTo(3, 3);
  });

  it('keeps cells roughly square, which is the whole point', () => {
    // A slice-and-dice treemap would give the smallest room a sliver. These are
    // tap targets with names in them, so the aspect ratio is the design.
    const rooms = [10, 8, 6, 5, 4, 3, 2, 2, 1, 1].map((v, i) => room(`r${i}`, v));
    const cells = squarify(rooms, 800, 500);
    for (const c of cells) {
      const ratio = Math.max(c.w / c.h, c.h / c.w);
      expect(ratio).toBeLessThan(6);
    }
  });

  it('never overlaps two rooms', () => {
    const rooms = [9, 7, 5, 4, 3, 2, 1].map((v, i) => room(`r${i}`, v));
    const cells = squarify(rooms, 600, 400);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]!;
        const b = cells[j]!;
        const apart =
          a.x + a.w <= b.x + 0.001 ||
          b.x + b.w <= a.x + 0.001 ||
          a.y + a.h <= b.y + 0.001 ||
          b.y + b.h <= a.y + 0.001;
        expect(apart).toBe(true);
      }
    }
  });

  it('stays inside the box', () => {
    for (const c of squarify([room('a', 3), room('b', 1)], 300, 200)) {
      expect(c.x).toBeGreaterThanOrEqual(-0.001);
      expect(c.y).toBeGreaterThanOrEqual(-0.001);
      expect(c.x + c.w).toBeLessThanOrEqual(300.001);
      expect(c.y + c.h).toBeLessThanOrEqual(200.001);
    }
  });

  it('puts the largest room first, so cells do not move as lights change', () => {
    // A treemap that reordered on every state change would move every cell
    // whenever one light came on, and these are positions people learn.
    const cells = squarify([room('small', 1), room('huge', 9), room('mid', 4)], 400, 400);
    expect(cells.map((c) => c.item.name)).toEqual(['huge', 'mid', 'small']);
  });

  it('drops a weightless room rather than drawing it as a sliver', () => {
    const cells = squarify([room('a', 4), room('empty', 0)], 200, 200);
    expect(cells.map((c) => c.item.name)).toEqual(['a']);
  });

  it('has nothing to draw in no space', () => {
    expect(squarify([room('a', 1)], 0, 100)).toEqual([]);
    expect(squarify([], 100, 100)).toEqual([]);
  });
});
