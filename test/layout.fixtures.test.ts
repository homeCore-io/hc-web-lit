/**
 * The layout engine, checked against core's fixtures.
 *
 * These cases are generated from `hc_types::dashboard_layout` and a snapshot
 * test in core fails if the Rust drifts from them. So this file is not a test of
 * behaviour we chose — it is the check that this client agrees with every other
 * one about what a saved document means. A failure here is this client being
 * wrong, not the fixture.
 *
 * Refresh with `tool/sync-layout-fixtures.sh`.
 */
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/dashboard-layout-fixtures.json' with { type: 'json' };
import { Engine, type DashboardFlow, type GridItem } from '../src/core/layout.js';

interface Case {
  name: string;
  why: string;
  columns: number;
  flow: string;
  input: GridItem[];
  expected: GridItem[];
}

const cases = fixtures.cases as unknown as Case[];

/** Compare on the fields the fixtures assert, in a stable order. */
function shape(items: readonly GridItem[]) {
  return items.map((i) => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }));
}

describe('Engine.normalize against core/docs/dashboard-layout-fixtures.json', () => {
  it('has cases to run — an empty oracle silently proves nothing', () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(fixtures.reference).toBe('hc_types::dashboard_layout::Engine::normalize');
  });

  for (const c of cases) {
    it(`${c.name} — ${c.why}`, () => {
      const engine = new Engine(c.columns, c.flow as DashboardFlow);
      const got = engine.normalize(c.input);

      // Sorted by id so the assertion is about placement, not output order.
      const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
      expect(shape(got).sort(byId)).toEqual(shape(c.expected).sort(byId));

      // Whatever normalize produces must also be something core would accept.
      // A fixture that passed the first assertion and failed this one would
      // mean the oracle and the validator disagree, which is worth catching.
      expect(engine.isLegal(got)).toBe(true);
    });
  }
});
