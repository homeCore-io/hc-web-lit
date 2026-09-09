/**
 * Where authored content lives.
 *
 * Templates and icon rules are things a person made, not facts about the
 * house. These pin the two properties that matter: that saving and applying
 * happen together, and that a browser refusing to store anything is a client
 * that forgets rather than a client that breaks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Authored } from '../src/core/authored.js';
import { BrowserContent, MemoryContent } from '../src/core/content.js';
import { iconFor, iconRules, setIconRules } from '../src/design/icons.js';

afterEach(() => setIconRules([]));

describe('a store', () => {
  it('round-trips what it was given', () => {
    const s = new MemoryContent();
    s.write('a', { x: 1 });
    expect(s.read('a')).toEqual({ x: 1 });
    expect(s.keys()).toEqual(['a']);
    s.remove('a');
    expect(s.read('a')).toBeUndefined();
  });

  it('hands back a copy, not a live reference', () => {
    // The one way a memory store could behave differently from a real one: a
    // caller keeping a reference and changing what is "saved" without saving.
    const s = new MemoryContent();
    const value = { x: 1 };
    s.write('a', value);
    value.x = 2;
    expect(s.read<{ x: number }>('a')?.x).toBe(1);
  });

  it('forgets rather than breaks when the browser says no', () => {
    // Private browsing, a full quota, and site data switched off all throw
    // rather than returning nothing. A dashboard that fails to start because
    // it could not save a preference is a worse product than one that forgets.
    const boom = () => {
      throw new Error('QuotaExceededError');
    };
    vi.stubGlobal('localStorage', {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      key: boom,
      get length(): number {
        throw new Error('nope');
      },
    });

    const s = new BrowserContent();
    expect(() => s.write('a', { x: 1 })).not.toThrow();
    expect(s.read('a')).toBeUndefined();
    expect(s.keys()).toEqual([]);
    expect(() => s.remove('a')).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('reads a corrupt entry as a missing one', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'not json',
      setItem: () => undefined,
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    });
    expect(new BrowserContent().read('a')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('what a household authored', () => {
  it('puts saved rules into force on startup', () => {
    const store = new MemoryContent();
    store.write('icon-rules', [{ match: 'holiday', icon: 'light' }]);

    new Authored(store).apply();
    expect(iconRules()).toHaveLength(1);
    expect(iconFor({ name: 'Holiday Lights', device_type: 'switch' })).toBe('light');
  });

  it('saves and applies in one act', () => {
    // Rules saved but not in force would be a page that changes when you
    // reload, which reads as a bug rather than as a save.
    const authored = new Authored(new MemoryContent());
    authored.saveIconRules([{ match: 'fan', icon: 'fan' }]);
    expect(iconFor({ name: 'Ceiling Fan', device_type: 'switch' })).toBe('fan');
    expect(authored.iconRules()).toHaveLength(1);
  });

  it('keeps templates across a restart', () => {
    const store = new MemoryContent();
    const first = new Authored(store);
    first.saveTemplate({ id: 'room-tile', widget: { type: 'device_grid', config: {} } });

    // A second instance is what a page reload is.
    expect(new Authored(store).templates().get('room-tile')?.widget.type).toBe('device_grid');
  });

  it('starts empty rather than inventing content', () => {
    const authored = new Authored(new MemoryContent());
    expect(authored.iconRules()).toEqual([]);
    expect(authored.templates().list()).toEqual([]);
  });
});
