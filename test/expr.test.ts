/**
 * P1 — expressions in config (§6).
 *
 * The interesting cases are the ones the section argues about: that the scope
 * is the whole scope, that a throw renders a fallback rather than a blank card,
 * that a mistake is a compile error with a place in it, and that nothing is
 * compiled twice.
 */
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/bindings.js';
import type { DeviceState } from '../src/core/device.js';
import {
  cacheSize,
  compile,
  evaluate,
  hasInterpolation,
  interpolate,
  isExpr,
  readsDevices,
} from '../src/core/expr.js';

const lamp = (over: Partial<DeviceState> = {}): DeviceState => ({
  device_id: 'hue_1',
  name: 'Desk Lamp',
  plugin_id: 'hue',
  available: true,
  attributes: { on: true, brightness_pct: 40 },
  last_seen: '2026-09-08T00:00:00Z',
  schema: { attributes: { on: { kind: 'bool', writable: true } } },
  ...over,
});

describe('evaluating an expression', () => {
  it('reads the bound device', () => {
    expect(evaluate('device.name', { device: lamp() })).toBe('Desk Lamp');
    expect(evaluate('device.attributes.brightness_pct', { device: lamp() })).toBe(40);
  });

  it('has the presentation helpers, so it cannot re-derive them wrongly', () => {
    // The whole reason the primitive exists: every widget that worked out
    // on-ness for itself got it wrong the same way (§1.1).
    expect(evaluate('isOn(device)', { device: lamp() })).toBe(true);
    expect(evaluate('levelOf(device)', { device: lamp() })).toBe(40);
    expect(evaluate('effectiveName(device)', { device: lamp() })).toBe('Desk Lamp');
  });

  it('returns any type, not just a string', () => {
    expect(evaluate('1 + 1', {})).toBe(2);
    expect(evaluate('[1, 2]', {})).toEqual([1, 2]);
    expect(evaluate('({ a: 1 })', {})).toEqual({ a: 1 });
    expect(evaluate('false', {})).toBe(false);
  });

  it('is an expression, not a statement list', () => {
    // No `return`, which also means no early exit and no side-effect block.
    expect(compile('return 1') instanceof Error).toBe(true);
    expect(compile('const x = 1; x') instanceof Error).toBe(true);
  });
});

describe('the scope is the whole scope', () => {
  it('does not hand over the host realm', () => {
    // Not a boundary — JavaScript cannot enforce one and §6.2 says so plainly.
    // What it is: nothing invites reaching for it. An expression is given named
    // parameters and nothing else, so a name it was not given is a mistake
    // rather than a capability.
    expect(evaluate('typeof hass', {})).toBe('undefined');
    expect(evaluate('typeof api', {})).toBe('undefined');
    expect(evaluate('typeof fetch', {})).toBe('function'); // the realm's, unavoidably
  });

  it('cannot see a device the widget did not declare', () => {
    // Expressions do not bypass the subscription model: an undeclared device
    // is simply not in `devices` (§6.4).
    expect(evaluate("devices['hue_9']", { devices: { hue_1: lamp() } })).toBeUndefined();
  });

  it('carries the timestamp it was evaluated at', () => {
    expect(evaluate('now', { now: 1234 })).toBe(1234);
  });
});

describe('a mistake', () => {
  it('is a compile error, with the message the browser gives', () => {
    // Rejected when the field loses focus in the designer, not discovered at
    // render time on a wall display (§6.5).
    const bad = compile('device.name ===');
    expect(bad instanceof Error).toBe(true);
    expect((bad as Error).message).toBeTruthy();
  });

  it('is undefined at render, never a thrown render', () => {
    // §6.6: a fallback, never a blank card.
    expect(evaluate('device.name.toUpperCase()', {})).toBeUndefined();
    expect(evaluate('null.x', {})).toBeUndefined();
  });
});

describe('compiling once', () => {
  it('keeps a compiled function by its source', () => {
    const src = `1 + ${Math.random()}`;
    const before = cacheSize();
    compile(src);
    compile(src);
    compile(src);
    expect(cacheSize()).toBe(before + 1);
  });
});

describe('the two forms', () => {
  it('recognises each without ambiguity', () => {
    expect(isExpr({ $expr: 'device.name' })).toBe(true);
    expect(isExpr({ expr: 'device.name' })).toBe(false);
    expect(hasInterpolation('{{ device.name }}')).toBe(true);
    expect(hasInterpolation('a plain string')).toBe(false);
  });

  it('interpolates inside a sentence', () => {
    expect(interpolate('{{ device.name }} is on', { device: lamp() })).toBe('Desk Lamp is on');
  });

  it('leaves the literal where an interpolation fails', () => {
    // Visibly wrong beats silently blank: a mistyped name shows itself.
    expect(interpolate('{{ dvice.name }}', { device: lamp() })).toBe('{{ dvice.name }}');
  });
});

describe('which devices an expression reads', () => {
  it('finds both spellings a document uses', () => {
    expect(readsDevices("devices['hue_1'].attributes.on").sort()).toEqual(['hue_1']);
    expect(readsDevices('devices.lutron_25 && devices["hue_1"]').sort()).toEqual([
      'hue_1',
      'lutron_25',
    ]);
  });
});

describe('expressions at the placement seam', () => {
  it('resolves both forms in a config', () => {
    const out = resolveConfig({ device_id: 'hue_1', text: '{{ device.name }}' }, [lamp()]);
    expect(out['text']).toBe('Desk Lamp');

    const icon = resolveConfig(
      { device_id: 'hue_1', icon: { $expr: "isOn(device) ? 'lamp-on' : 'lamp'" } },
      [lamp()],
    );
    expect(icon['icon']).toBe('lamp-on');
  });

  it('resolves `@picked` before the expression sees it', () => {
    // An expression sees the device the token means, not the token — the same
    // promise every other value at this seam gets (§14.1).
    const out = resolveConfig({ device_id: '@picked', text: '{{ device.name }}' }, [lamp()], {
      picked: 'hue_1',
    });
    expect(out['text']).toBe('Desk Lamp');
  });

  it('leaves a config with no expressions exactly as it was', () => {
    // Same object back, so an unchanged widget is not re-rendered for a copy.
    const config = { text: 'plain' };
    expect(resolveConfig(config, [])).toBe(config);
  });

  it('drops a key whose expression failed, so the widget keeps its default', () => {
    const out = resolveConfig({ device_id: 'nope', icon: { $expr: 'device.name' } }, [lamp()]);
    expect('icon' in out).toBe(false);
  });

  it('reads widget-local vars', () => {
    const out = resolveConfig({ vars: { unit: 'F' }, text: '{{ vars.unit }}' }, []);
    expect(out['text']).toBe('F');
  });
});
