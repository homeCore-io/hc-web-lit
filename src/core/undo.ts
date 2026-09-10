/**
 * Undo, for edits that are otherwise immediate and permanent.
 *
 * Every authoring action in this client writes straight to the household's
 * store: a drag lands, a save lands, a page goes. That is the right behaviour
 * — an editor that asks "are you sure" about moving a card is an editor nobody
 * wants — and it is only tolerable with a way back. This client's own
 * development destroyed real content twice by accident (a household's icon
 * rules, and later its main page), and both times the only fix was to go and
 * find another copy.
 *
 * **Whole states, not inverse operations.** An undo stack of "the opposite of
 * what you just did" has to know how to invert every action, and gets a
 * quieter kind of wrong every time somebody adds one: an inverse that is
 * *nearly* right leaves a document subtly different from the one somebody had.
 * Snapshots cannot be nearly right. The documents are small — the reference
 * house's three pages are 25KB together — and this is memory, not storage.
 *
 * **Not persisted, deliberately.** A history that survived a reload would let
 * somebody undo, tomorrow, a change they made today and have forgotten, on a
 * page they have edited since. Undo is about the last few minutes.
 */

/** How many steps back. Enough for a wrong drag and the ones around it. */
const DEPTH = 40;

export class Undo<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];
  private readonly depth: number;

  constructor(depth = DEPTH) {
    this.depth = Math.max(1, depth);
  }

  /**
   * Record the state *before* a change, which is what undo goes back to.
   *
   * Called by whatever is about to write. Doing it the other way round — the
   * state after — means the first undo does nothing and every later one is
   * off by a step, which is the classic way to get this wrong.
   */
  push(before: T): void {
    this.past.push(before);
    // The oldest step goes rather than the newest: somebody undoing wants the
    // last few things they did, and a stack that refused new steps once full
    // would stop recording exactly when it was being used most.
    if (this.past.length > this.depth) this.past.shift();
    // A new branch. What was undone is no longer ahead of anything.
    this.future.length = 0;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** The state to go back to, given the one in force. */
  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(current);
    return previous;
  }

  /** The state to go forward to, given the one in force. */
  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    return next;
  }

  /** Forget everything, for a session that has moved on to another house. */
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
