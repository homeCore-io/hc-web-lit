/**
 * Identifiers as words — the humanising rule, in one place.
 *
 * Every string a person reads comes from somewhere: a plugin's attribute key,
 * an area slug, an event type, an option value. None of them were written to be
 * read. The rule is the one the September schema contract states —
 * `label ?? humanise(value)`, `medium-high` → "Medium high" — and the reason it
 * belongs here rather than at each call site is that it was at each call site:
 * a dozen `replace(/_/g, ' ')`s, half of them capitalising and half not, so the
 * same attribute read as "Colour temperature" in a control and "color temp" two
 * inches below it.
 *
 * **A declaration always wins.** `display_name`, `states`, an option's `label`
 * — where a plugin supplies the words, these functions are not called at all.
 * This is what to do when nobody said.
 */

/**
 * The words in an identifier, cased as they arrived.
 *
 * For mid-sentence use, where a capital would be wrong: a feed line reads
 * "Office Motion — no motion", and "No motion" there is a new sentence starting
 * inside an old one.
 */
export function words(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * An identifier as a label: the words, with a leading capital.
 *
 * Only the first, because the rest of the words are not proper nouns —
 * "Colour temperature", not "Colour Temperature", which reads as a heading
 * rather than a name for a thing.
 */
export function humanise(id: string): string {
  return words(id).replace(/^./, (c) => c.toUpperCase());
}

/** A label put back mid-sentence: "Not water detected", from "Water detected". */
export function lowerFirst(s: string): string {
  return s.replace(/^./, (c) => c.toLowerCase());
}

/**
 * A device's name without the room it is already in.
 *
 * The house names devices for the whole house — "Family Room Ceiling Light",
 * "Office Desk Lamp" — which is right on a page that shows every room and
 * wrong on a page that shows one. Four chips in a 44px row give each about
 * 150px, so the full name renders as "Family …" four times: the same word
 * repeated, and the part that distinguishes them cut off.
 *
 * Only a leading match, only when the page is scoped to that room, and only
 * when something is left over — "Office" in the office stays "Office" rather
 * than becoming nothing.
 */
export function withoutRoom(name: string, room: string | undefined): string {
  if (room === undefined || room === '') return name;
  const prefix = words(room).toLowerCase();
  const lowered = name.toLowerCase();
  if (!lowered.startsWith(prefix)) return name;
  // At a word boundary, or "Officer Hallway Light" in the office becomes
  // "r Hallway Light".
  const next = name[prefix.length];
  if (next !== undefined && !/[\s-]/.test(next)) return name;
  const rest = name.slice(prefix.length).replace(/^[\s-]+/, '');
  return rest === '' ? name : rest;
}
