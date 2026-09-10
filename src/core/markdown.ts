/**
 * Just enough Markdown, parsed to a tree rather than to HTML (§7.3).
 *
 * **No library, and no HTML string anywhere.** A dashboard note is written by
 * whoever can edit the dashboard, and interpolation (§6) puts *device data*
 * into it before it is rendered — a device whose name a plugin took from a
 * network response. Producing an HTML string and handing it to `unsafeHTML`
 * would make every one of those an injection point, and the escaping that
 * prevents it is the part people get wrong. So this parses to nodes and the
 * widget renders them as Lit templates: there is no path from the text to
 * markup, which is a property of the shape rather than a claim about the
 * escaping.
 *
 * **A useful subset, chosen from what a house note actually contains**:
 * headings, paragraphs, bullet and numbered lists, block quotes, fenced and
 * inline code, rules, bold, italic, and links. What is missing — tables,
 * images, footnotes, nested lists — is missing on purpose: each is more
 * parser than a note is worth, and unhandled syntax renders as the literal
 * text somebody typed rather than disappearing.
 */

/** A run of text inside a block. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

/** One block of a document. */
export type Block =
  | { kind: 'heading'; level: number; spans: Inline[] }
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; spans: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/**
 * Only what a browser will follow to somewhere ordinary.
 *
 * `javascript:` is the reason this exists; `data:` is the other one. A link
 * with a scheme that is not on this list keeps its text and loses its href,
 * so the note still reads and nothing can be clicked into running.
 */
function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  // A relative link inside this app is fine; anything with a colon before the
  // first slash is a scheme somebody chose.
  if (/^[./#?]/.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return undefined;
}

const INLINE =
  /(\[[^\]\n]*\]\([^)\s]*\))|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/;

/** The runs inside one line. Anything unmatched stays as typed. */
export function spansIn(line: string): Inline[] {
  const out: Inline[] = [];
  let rest = line;

  while (rest !== '') {
    const found = INLINE.exec(rest);
    if (found === null || found.index === undefined) break;

    if (found.index > 0) out.push({ kind: 'text', text: rest.slice(0, found.index) });
    const token = found[0];

    if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const text = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      // A refused scheme keeps the words and loses the link, rather than
      // deleting what somebody wrote.
      out.push(href === undefined ? { kind: 'text', text } : { kind: 'link', text, href });
    } else if (token.startsWith('`')) {
      out.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push({ kind: 'strong', text: token.slice(2, -2) });
    } else {
      out.push({ kind: 'em', text: token.slice(1, -1) });
    }

    rest = rest.slice(found.index + token.length);
  }

  if (rest !== '') out.push({ kind: 'text', text: rest });
  return out;
}

/** A note, as blocks. Empty input is an empty document, not an error. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: spansIn(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      flush();
      continue;
    }

    if (line.startsWith('```')) {
      flush();
      const body: string[] = [];
      i++;
      for (; i < lines.length && !(lines[i] ?? '').startsWith('```'); i++)
        body.push(lines[i] ?? '');
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        spans: spansIn(heading[2] ?? ''),
      });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      blocks.push({ kind: 'quote', spans: spansIn(line.replace(/^\s*>\s?/, '')) });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      flush();
      const ordered = bullet === null;
      const item = spansIn((bullet ?? numbered)?.[1] ?? '');
      const last = blocks[blocks.length - 1];
      // Consecutive items are one list, so a five-item list is one element
      // with five children rather than five lists of one.
      if (last !== undefined && last.kind === 'list' && last.ordered === ordered) {
        last.items.push(item);
      } else {
        blocks.push({ kind: 'list', ordered, items: [item] });
      }
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
