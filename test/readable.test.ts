/**
 * Could another client read this page? (§18.2, §18.3)
 *
 * The honest successor to "validate → diff → apply", which was designed when
 * core stored dashboards and has had nothing to apply to since pages moved
 * into this client's own store. The question survives because both clients are
 * still in use, and a page authored here is a page somebody may open there.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/vocabulary.json' with { type: 'json' };
import { readVocabulary, type Vocabulary } from '../src/core/vocabulary.js';
import { unreadableIn } from '../src/core/readable.js';
import type { DashboardDefinition } from '../src/core/dashboard.js';

const vocabulary = readVocabulary(fixture) as Vocabulary;

const page = (over: Partial<DashboardDefinition> = {}): DashboardDefinition => ({
  id: 'p1',
  name: 'One',
  icon: 'home',
  owner_user_id: 'u',
  widgets: [{ id: 'grid', type: 'device_grid', config: { selection_mode: 'manual' } }],
  layouts: [
    {
      breakpoint: 'desktop',
      columns: 12,
      row_height: 100,
      gap: 10,
      placements: [{ widget_id: 'grid', x: 0, y: 0, w: 6, h: 2 }],
    },
  ],
  ...over,
});

describe('what another client would have to guess about', () => {
  it('says nothing at all about a page that is fine', async () => {
    // The household's own two pages report nothing against core's forty
    // types, which is what makes the control worth offering only when it has
    // something to say.
    expect(unreadableIn(page(), vocabulary, [page()])).toEqual([]);
  });

  it('names a field that disagrees with the table core publishes', async () => {
    const bad = page({
      widgets: [
        {
          id: 'grid',
          type: 'device_grid',
          config: { selection_mode: 'manual', sort: 'sideways', limit: 'lots' },
        },
      ],
    });
    expect(unreadableIn(bad, vocabulary, [bad])).toEqual([
      { widget: 'grid', field: 'sort', why: 'Not one of: name, room, kind, on.' },
      { widget: 'grid', field: 'limit', why: 'Should be a number.' },
    ]);
  });

  it('follows a page a widget opens, and says when it is not there', async () => {
    // The check done by hand before deleting a page: nothing referenced its
    // id. Thirty-six widgets is not something anybody audits by opening each.
    const bad = page({
      widgets: [
        { id: 'rooms', type: 'room_field', config: { room_page: 'gone' } },
        { id: 'grid', type: 'device_grid', config: { selection_mode: 'manual' } },
      ],
    });
    expect(unreadableIn(bad, vocabulary, [bad])).toContainEqual({
      widget: 'rooms',
      why: 'Opens a page that is not here: gone.',
    });
  });

  it('follows a page a gesture opens', async () => {
    const bad = page({
      widgets: [
        {
          id: 'grid',
          type: 'device_grid',
          config: { selection_mode: 'manual', on_tap: { do: 'page', target: 'nowhere' } },
        },
      ],
    });
    expect(unreadableIn(bad, vocabulary, [bad])).toContainEqual({
      widget: 'grid',
      why: 'Opens a page that is not here: nowhere.',
    });
  });

  it('is happy with a page that is actually there', async () => {
    const other = page({ id: 'p2', name: 'Two' });
    const link = page({
      widgets: [{ id: 'rooms', type: 'room_field', config: { room_page: 'p2' } }],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 100,
          gap: 10,
          placements: [{ widget_id: 'rooms', x: 0, y: 0, w: 6, h: 2 }],
        },
      ],
    });
    expect(unreadableIn(link, vocabulary, [link, other])).toEqual([]);
  });

  it('catches the two halves of a page disagreeing with each other', async () => {
    // Either way round is a page that draws differently depending on which
    // half a reader starts from.
    const bad = page({
      widgets: [
        { id: 'grid', type: 'device_grid', config: { selection_mode: 'manual' } },
        { id: 'stray', type: 'text', config: { text: 'nothing places me' } },
      ],
      layouts: [
        {
          breakpoint: 'desktop',
          columns: 12,
          row_height: 100,
          gap: 10,
          placements: [
            { widget_id: 'grid', x: 0, y: 0, w: 6, h: 2 },
            { widget_id: 'ghost', x: 0, y: 2, w: 6, h: 2 },
          ],
        },
      ],
    });
    const found = unreadableIn(bad, vocabulary, [bad]);
    expect(found).toContainEqual({
      why: 'The desktop layout places a widget that is not here: ghost.',
    });
    expect(found).toContainEqual({ widget: 'stray', why: 'Nothing on any layout places it.' });
  });

  it('says nothing about a widget type core has never heard of', async () => {
    // Core accepts an unknown type and so does this client (§14.3) — a client
    // that coerced one to something it knew is the bug that made `type` a
    // plain string. A type this build cannot draw says so where it happens.
    const odd = page({
      widgets: [{ id: 'grid', type: 'com.example.dial', config: { whatever: 1 } }],
    });
    expect(unreadableIn(odd, vocabulary, [odd])).toEqual([]);
  });

  it('has nothing to say without a vocabulary to say it against', async () => {
    // A build that has not fetched the table is not a build that knows every
    // page is wrong.
    const bad = page({
      widgets: [{ id: 'grid', type: 'device_grid', config: { sort: 'sideways' } }],
    });
    expect(unreadableIn(bad, undefined, [bad])).toEqual([]);
  });
});
