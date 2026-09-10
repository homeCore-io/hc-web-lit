/**
 * Going back.
 *
 * Every authoring action in this client writes straight to the household's
 * store, which is the right behaviour and only tolerable with a way back.
 * These pin the two things an undo stack is usually wrong about: which state
 * a step goes back *to*, and what happens to the redo list once somebody
 * carries on.
 */
import { describe, expect, it } from 'vitest';
import { Undo } from '../src/core/undo.js';

describe('a step back', () => {
  it('goes to what was there before the change', () => {
    // Recording the state *after* a change means the first undo does nothing
    // and every later one is off by a step — the classic way to get this
    // wrong.
    const undo = new Undo<string>();
    undo.push('one');
    expect(undo.undo('two')).toBe('one');
  });

  it('has nothing to go back to before anything happened', () => {
    const undo = new Undo<string>();
    expect(undo.canUndo).toBe(false);
    expect(undo.undo('one')).toBeUndefined();
  });

  it('walks back through several, in order', () => {
    const undo = new Undo<string>();
    undo.push('one');
    undo.push('two');
    undo.push('three');

    expect(undo.undo('four')).toBe('three');
    expect(undo.undo('three')).toBe('two');
    expect(undo.undo('two')).toBe('one');
    expect(undo.canUndo).toBe(false);
  });
});

describe('going forward again', () => {
  it('returns what was undone', () => {
    const undo = new Undo<string>();
    undo.push('one');
    const back = undo.undo('two');
    expect(back).toBe('one');
    expect(undo.redo('one')).toBe('two');
  });

  it('is gone the moment somebody does something else', () => {
    // A new branch: what was undone is no longer ahead of anything, and
    // offering to redo it would put back a change that no longer fits.
    const undo = new Undo<string>();
    undo.push('one');
    undo.undo('two');
    expect(undo.canRedo).toBe(true);

    undo.push('one');
    expect(undo.canRedo).toBe(false);
    expect(undo.redo('other')).toBeUndefined();
  });

  it('can be walked back and forth without drifting', () => {
    const undo = new Undo<string>();
    undo.push('a');
    undo.push('b');

    expect(undo.undo('c')).toBe('b');
    expect(undo.undo('b')).toBe('a');
    expect(undo.redo('a')).toBe('b');
    expect(undo.redo('b')).toBe('c');
    expect(undo.canRedo).toBe(false);
  });
});

describe('how far back it goes', () => {
  it('drops the oldest step rather than refusing a new one', () => {
    // A stack that stopped recording once full would stop exactly when it was
    // being used most.
    const undo = new Undo<number>(3);
    for (const n of [1, 2, 3, 4, 5]) undo.push(n);

    expect(undo.undo(6)).toBe(5);
    expect(undo.undo(5)).toBe(4);
    expect(undo.undo(4)).toBe(3);
    expect(undo.canUndo).toBe(false);
  });

  it('keeps at least one step, whatever it is asked for', () => {
    const undo = new Undo<number>(0);
    undo.push(1);
    expect(undo.undo(2)).toBe(1);
  });
});

describe('forgetting', () => {
  it('has nothing either way afterwards', () => {
    const undo = new Undo<string>();
    undo.push('one');
    undo.undo('two');
    undo.clear();
    expect(undo.canUndo).toBe(false);
    expect(undo.canRedo).toBe(false);
  });
});
