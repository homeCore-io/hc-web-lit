/**
 * The group model: a path in config, and the path is the identity.
 *
 * Pure, so the rules are testable without a surface. Most of these are the
 * cases hc-web-flutter's `groups.dart` names in its own comments — the bugs it
 * hit are the reason each rule is the shape it is.
 */
import { describe, expect, it } from 'vitest';
import {
  GROUP_KEY,
  clickTarget,
  commonGroup,
  freshName,
  groupOf,
  isUnder,
  membersOf,
  nameOf,
  namesIn,
  normalise,
  parentOf,
  regrouped,
  relativeTo,
  renamedPath,
  stepOut,
  ungrouped,
  uniqueName,
  withGroup,
} from '../src/core/groups.js';

describe('a path read off a config', () => {
  it('is whatever a normal document says', () => {
    expect(groupOf({ group: 'Wall/Lights' })).toBe('Wall/Lights');
    expect(groupOf({})).toBeUndefined();
    expect(groupOf(undefined)).toBeUndefined();
  });

  it('is repaired rather than trusted', () => {
    // A hand-edited `//a//` would otherwise make a path with empty segments
    // that matches nothing, hides its members from every group operation, and
    // cannot be selected in order to be fixed.
    expect(normalise('//a//')).toBe('a');
    expect(normalise(' Wall / Lights ')).toBe('Wall/Lights');
    expect(normalise(7)).toBeUndefined();
    expect(normalise('///')).toBeUndefined();
    expect(normalise('')).toBeUndefined();
  });
});

describe('writing a group back', () => {
  it('leaves the document as it was found when the group goes', () => {
    // Grouping and then ungrouping must not accumulate a record of every idle
    // click in a household's stored page.
    const was = { text: 'Hall' };
    const grouped = withGroup(was, 'Wall');
    expect(grouped).toEqual({ text: 'Hall', group: 'Wall' });
    expect(withGroup(grouped, undefined)).toEqual(was);
    expect(GROUP_KEY in withGroup(grouped, undefined)).toBe(false);
  });

  it('does not touch the config it was given', () => {
    const was = { text: 'Hall' };
    withGroup(was, 'Wall');
    expect(was).toEqual({ text: 'Hall' });
  });

  it('tidies what it stores', () => {
    expect(withGroup({}, ' Wall // Lights ')).toEqual({ group: 'Wall/Lights' });
  });
});

describe('what is inside what', () => {
  it('is segment-aware, so Wallpaper is not inside Wall', () => {
    // A plain `startsWith` gets this wrong, and the failure is a group that
    // silently swallows a card with a similar name.
    expect(isUnder('Wall/Lights', 'Wall')).toBe(true);
    expect(isUnder('Wall', 'Wall')).toBe(true);
    expect(isUnder('Wallpaper', 'Wall')).toBe(false);
  });

  it('knows where it sits and what it is called', () => {
    expect(parentOf('Wall/Lights')).toBe('Wall');
    expect(parentOf('Wall')).toBeUndefined();
    expect(nameOf('Wall/Lights')).toBe('Lights');
    expect(relativeTo('Wall/Lights/Lamp', 'Wall')).toBe('Lights/Lamp');
    expect(relativeTo('Wall', 'Wall')).toBeUndefined();
    expect(relativeTo('Other', 'Wall')).toBeUndefined();
  });

  it('collects everything at or below a group', () => {
    const paths = new Map([
      ['a', 'Wall'],
      ['b', 'Wall/Lights'],
      ['c', 'Wallpaper'],
      ['d', undefined],
    ]);
    expect([...membersOf(paths, 'Wall')].sort()).toEqual(['a', 'b']);
  });
});

describe('what a click puts in hand', () => {
  it('holds the whole cluster from outside it', () => {
    // The whole point of grouping: one click holds the cluster, and getting at
    // a single member means going in first.
    expect(clickTarget('Wall/Lights', undefined)).toBe('Wall');
  });

  it('holds one level deeper once you have gone in', () => {
    expect(clickTarget('Wall/Lights', 'Wall')).toBe('Wall/Lights');
  });

  it('is the element itself for a direct member of where you stand', () => {
    expect(clickTarget('Wall', 'Wall')).toBeUndefined();
    expect(clickTarget(undefined, undefined)).toBeUndefined();
  });

  it('takes you out when you click something that is not in here', () => {
    // Ignoring the click instead would be a surface that stops responding for
    // reasons nothing on screen explains.
    expect(clickTarget('Other/Thing', 'Wall')).toBe('Other');
  });
});

describe('the group several elements share', () => {
  it('is the deepest one containing all of them', () => {
    expect(commonGroup(['Wall/Lights', 'Wall/Lights/Lamp'])).toBe('Wall/Lights');
    expect(commonGroup(['Wall/Lights', 'Wall/Blinds'])).toBe('Wall');
  });

  it('is nothing when any of them is loose or they share none', () => {
    // Which is exactly when there is no single group in hand to name, ungroup
    // or report.
    expect(commonGroup(['Wall/Lights', undefined])).toBeUndefined();
    expect(commonGroup(['Wall', 'Other'])).toBeUndefined();
    expect(commonGroup([])).toBeUndefined();
  });
});

describe('naming a group', () => {
  it('counts from one and skips what exists', () => {
    // So grouping, ungrouping and grouping again gives `Group 1` back rather
    // than climbing forever.
    expect(freshName(new Set())).toBe('Group 1');
    expect(freshName(new Set(['Group 1', 'Group 2']))).toBe('Group 3');
    expect(freshName(new Set(['Group 2']))).toBe('Group 1');
  });

  it('keeps siblings unique, because the name is the address', () => {
    // Letting two siblings share a name would merge them, which is a far worse
    // surprise than a `2` appearing after what somebody typed.
    expect(uniqueName('Lights', new Set())).toBe('Lights');
    expect(uniqueName('Lights', new Set(['Lights']))).toBe('Lights 2');
    expect(uniqueName('  ', new Set())).toBe('Group');
  });

  it('lists the names sitting directly inside a group', () => {
    const paths = ['Wall/Lights', 'Wall/Lights/Lamp', 'Wall/Blinds', 'Other'];
    expect([...namesIn(paths, 'Wall')].sort()).toEqual(['Blinds', 'Lights']);
    expect([...namesIn(paths, undefined)].sort()).toEqual(['Other', 'Wall']);
  });
});

describe('grouping and ungrouping', () => {
  it('keeps a cluster intact when something is put beside it', () => {
    // Grouping a group with a loose card gives `Group 2/Group 1` and
    // `Group 2` — the cluster you had does not dissolve.
    expect(regrouped('Group 1', 'Group 2', undefined)).toBe('Group 2/Group 1');
    expect(regrouped(undefined, 'Group 2', undefined)).toBe('Group 2');
  });

  it('nests under where you are standing', () => {
    expect(regrouped('Wall/Lights', 'Wall/New', 'Wall')).toBe('Wall/New/Lights');
  });

  it('dissolves the group named, not the innermost', () => {
    // Holding `Wall` and ungrouping must leave `Lights` standing, or
    // ungrouping the thing in hand would take apart something else.
    expect(ungrouped('Wall/Lights', 'Wall')).toBe('Lights');
    expect(ungrouped('Wall', 'Wall')).toBeUndefined();
    expect(ungrouped('Wall/Lights/Lamp', 'Wall/Lights')).toBe('Wall/Lamp');
  });

  it('leaves alone what is not in the group being dissolved', () => {
    expect(ungrouped('Other', 'Wall')).toBe('Other');
    expect(ungrouped(undefined, 'Wall')).toBeUndefined();
  });

  it('carries the members when a group is renamed', () => {
    expect(renamedPath('Wall/Lights', 'Wall', 'Hall')).toBe('Hall/Lights');
    expect(renamedPath('Wall', 'Wall', 'Hall')).toBe('Hall');
    expect(renamedPath('Other', 'Wall', 'Hall')).toBe('Other');
  });

  it('steps out to the group that holds this one', () => {
    expect(stepOut('Wall/Lights')).toBe('Wall');
    expect(stepOut('Wall')).toBeUndefined();
    expect(stepOut(undefined)).toBeUndefined();
  });
});
