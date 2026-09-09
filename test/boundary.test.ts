/**
 * Phase 2's exit gate: nothing reaches around the host (§18.3, §19.4).
 *
 * The rule is that a widget touches the socket, the token and the API through
 * the host or not at all. §19.4 states it and §8.2 is honest that it is a rule
 * rather than a boundary — extensions run in the main realm, so nothing stops
 * a determined author. That is exactly why it has to fail something here: an
 * unenforced convention is one refactor from being false, and the first widget
 * that quietly holds an API client is the one that makes the seam optional for
 * everyone after it.
 *
 * Read from the sources, because the question is about what the code *may*
 * do, not what one render happened to do.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const widgets = join(here, '..', 'src', 'widgets');
const files = readdirSync(widgets).filter((f) => f.endsWith('.ts'));
const source = (f: string): string => readFileSync(join(widgets, f), 'utf8');

/**
 * The code, without the prose.
 *
 * "token" is two words: a session token, which a widget must never hold, and a
 * design token, which every widget talks about. Matching the raw file flagged
 * three comments explaining the rule as breaches of it — a check that reads
 * commentary is a check that punishes writing things down.
 */
const code = (f: string): string =>
  source(f)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

/** An import of values, as opposed to `import type`, which erases. */
const importsValuesFrom = (s: string, module: string): boolean =>
  new RegExp(`^import\\s+(?!type\\b)[^;]*from '[^']*${module}';`, 'm').test(s);

describe('the capability boundary', () => {
  it.each(files)('%s holds no API client', (file) => {
    const s = code(file);
    // Types are fine and necessary — a widget must be able to name what it is
    // given. Constructing or calling one is the thing.
    expect(importsValuesFrom(s, 'core/api'), `${file} imports the API client`).toBe(false);
    expect(/new HcApi\b/.test(s), `${file} constructs an API client`).toBe(false);
  });

  it.each(files)('%s opens no socket of its own', (file) => {
    const s = code(file);
    expect(/new WebSocket\b/.test(s), `${file} opens a socket`).toBe(false);
    expect(importsValuesFrom(s, 'core/events'), `${file} drives the event stream`).toBe(false);
  });

  it.each(files)('%s does not reach the network directly', (file) => {
    const s = code(file);
    // eslint forbids the bare global; this also catches the spellings that
    // slip past it.
    expect(/\b(globalThis|window)\.fetch\b/.test(s), `${file} calls fetch`).toBe(false);
    expect(/\bXMLHttpRequest\b/.test(s), `${file} opens an XHR`).toBe(false);
  });

  it.each(files)('%s keeps no credential', (file) => {
    const s = code(file);
    expect(/localStorage|sessionStorage|document\.cookie/.test(s), `${file} touches storage`).toBe(
      false,
    );
    // A *session* token. The design tokens every widget reads are `--hc-…`
    // custom properties and are not this.
    expect(/\btoken\b/i.test(s), `${file} holds a token`).toBe(false);
  });

  it('lets the SDK depend downward only', () => {
    // A package cannot depend on the application that contains it. Nothing
    // external imports this yet, so the boundary costs nothing to keep and
    // everything to discover late — the tidy-up would land exactly when it is
    // most expensive, under the deadline of publishing.
    const sdk = join(here, '..', 'src', 'sdk');
    for (const file of readdirSync(sdk)) {
      const s = readFileSync(join(sdk, file), 'utf8');
      for (const m of s.matchAll(/from '\.\.\/([a-z]+)\//g)) {
        expect(['core', 'design'], `${file} imports from ${m[1]}/`).toContain(m[1]);
      }
    }
  });

  it('lets the host do all of it, so the rule is possible to keep', () => {
    // The shell is where these belong, and if none of it were here the rule
    // above would be passing because nobody does anything.
    const app = readFileSync(join(here, '..', 'src', 'shell', 'hc-app.ts'), 'utf8');
    expect(app).toMatch(/new HcApi\b/);
    expect(app).toMatch(/EventStream/);
  });
});
