/**
 * The client's reading of real device schemas, pinned against a real payload.
 *
 * `SCHEMA_CONTRACT_2026-09.md` names the gap: layout has an oracle — core
 * generates fixtures and a snapshot test fails if the engine drifts — and
 * device schemas have none. Every field in `api.ts` reached this repo by a
 * person writing it down.
 *
 * This is the weaker half of the answer: forty real schema shapes, anonymised,
 * asserted against the functions that read them. It catches a shape change as a
 * failing test rather than as a widget quietly rendering `[object Object]`.
 * The stronger half is core generating it, which is worth asking for.
 *
 * Refresh with `tool/sync-device-schema-fixtures.sh`.
 */
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/device-schemas.json' with { type: 'json' };
import { asOption, optionLabel, type DeviceSchema } from '../src/core/api.js';
import { controlsFor } from '../src/core/controls.js';
import type { DeviceState } from '../src/core/device.js';
import { formatReading, readingOf, roleOf } from '../src/core/facet.js';
import { isOn } from '../src/core/present.js';

interface Shape {
  device_type: string | null;
  plugin_id: string;
  attributes: Record<string, unknown>;
  schema: DeviceSchema | null;
}

const shapes = fixtures.shapes as unknown as Shape[];

const asDevice = (s: Shape): DeviceState => ({
  device_id: 'fixture',
  name: 'Fixture',
  plugin_id: s.plugin_id,
  available: true,
  attributes: s.attributes,
  last_seen: '2026-09-08T00:00:00Z',
  ...(s.device_type !== null ? { device_type: s.device_type } : {}),
  ...(s.schema !== null ? { schema: s.schema } : {}),
});

describe('every real schema shape', () => {
  it('has shapes to check — an empty fixture proves nothing', () => {
    expect(shapes.length).toBeGreaterThan(20);
  });

  for (const s of shapes) {
    const label = `${s.device_type ?? '(no type)'} / ${s.plugin_id}`;

    it(`${label} survives every reader`, () => {
      const d = asDevice(s);

      // None of these may throw on anything a real house publishes. That is
      // most of what a fixture like this is for.
      expect(() => roleOf(d)).not.toThrow();
      expect(() => isOn(d)).not.toThrow();
      expect(() => controlsFor(d)).not.toThrow();

      const reading = readingOf(d);
      if (reading !== undefined) {
        const text = formatReading(reading);
        expect(typeof text).toBe('string');
        // The bug this catches: an object rendering as "[object Object]".
        expect(text).not.toContain('[object');
      }

      for (const c of controlsFor(d)) {
        expect(typeof c.label).toBe('string');
        expect(c.label.length).toBeGreaterThan(0);
        if (c.form === 'select') {
          for (const o of c.options) {
            expect(typeof o.value).toBe('string');
            expect(optionLabel(o)).not.toContain('[object');
          }
        }
      }
    });
  }
});

describe('what the September contract added', () => {
  it('reads `primary` where core supplies it', () => {
    const withPrimary = shapes.filter((s) => (s.schema?.primary ?? []).length > 0);
    expect(withPrimary.length).toBeGreaterThan(10);

    for (const s of withPrimary) {
      const d = asDevice(s);
      const r = readingOf(d);
      if (r === undefined) continue;
      // Whatever it leads with must be something the device declared as a
      // point of it, or something it is actually reporting that `primary`
      // did not name.
      const named = s.schema?.primary ?? [];
      if (named.some((k) => k in s.attributes)) {
        expect(named).toContain(r.key);
      }
    }
  });

  it('honours a declared category over the fallback list', () => {
    const categorised = shapes.filter((s) =>
      Object.values(s.schema?.attributes ?? {}).some((a) => a.category !== undefined),
    );
    expect(categorised.length).toBeGreaterThan(0);

    for (const s of categorised) {
      const r = readingOf(asDevice(s));
      if (r === undefined) continue;
      expect(s.schema?.attributes?.[r.key]?.category).toBeUndefined();
    }
  });

  it('accepts an option in either wire form', () => {
    // Core serialises an option carrying no extras as a plain string, so old
    // payloads are byte-identical — a guarantee pinned by a test in hc-types.
    expect(asOption('cool')).toEqual({ value: 'cool' });
    expect(asOption({ value: 'cool', label: 'Cooling' })).toEqual({
      value: 'cool',
      label: 'Cooling',
    });
    expect(optionLabel(asOption('medium-high'))).toBe('Medium high');
    expect(optionLabel({ value: 'cool', label: 'Cooling' })).toBe('Cooling');
  });

  it('treats an empty attribute set with actions as a statement', () => {
    // A pulsed CCO declares {attributes: {}, actions: [activate]} because the
    // Integration Guide forbids querying a momentary output. That is a device
    // you can command, not a device with no schema.
    const d = asDevice({
      device_type: 'scene',
      plugin_id: 'plugin.lutron',
      attributes: {},
      schema: { attributes: {}, actions: [{ id: 'activate', label: 'Activate' }] },
    });
    expect(roleOf(d)).toBe('commandable');
    expect(controlsFor(d).map((c) => c.form)).toEqual(['action']);
  });
});
