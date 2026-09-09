/**
 * Saying how old what is on screen is (§16).
 *
 * "Reconnecting" says the socket is down and nothing about whether the picture
 * is a minute old or since breakfast. On a wall panel that difference is the
 * whole question: a lamp that was dark a minute ago is information, and one
 * that was dark at 7am is a picture of the past.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sinceHeard } from '../src/shell/hc-app.js';

// Read from a path, not an `import.meta.url` URL: under jsdom the document's
// base is an http URL, so resolving one relative to it stops being a file.
const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]): string => readFileSync(join(here, '..', ...parts), 'utf8');

describe('how long since the house said anything', () => {
  const at = (secondsAgo: number) => Date.now() - secondsAgo * 1000;

  it('does not count seconds at somebody', () => {
    // A number that ticks draws the eye to itself rather than to what it is
    // about, and nobody standing at a panel needs the second.
    expect(sinceHeard(at(0))).toBe('just now');
    expect(sinceHeard(at(30))).toBe('just now');
  });

  it('reads in the unit that matters at that distance', () => {
    expect(sinceHeard(at(120))).toBe('2m ago');
    expect(sinceHeard(at(3 * 3600))).toBe('3h ago');
    expect(sinceHeard(at(50 * 3600))).toBe('2d ago');
  });

  it('says so plainly before anything has arrived', () => {
    // Not "0s ago", which claims a measurement nobody took.
    expect(sinceHeard(0)).toBe('not yet');
  });

  it('never reports the future, whatever the clock does', () => {
    // A tablet whose clock is ahead of the server's would otherwise show a
    // negative age, which reads as a bug in the house rather than in the
    // tablet.
    expect(sinceHeard(Date.now() + 60_000)).toBe('just now');
  });
});

describe('the shell caches itself but never the house', () => {
  it('refuses to cache anything under /api', () => {
    // Devices, dashboards, history and a household's content are all things
    // whose value is being current; a cached answer is a lie with a timestamp.
    const sw = read('public', 'sw.js');
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/);
    expect(sw).toMatch(/return;/);
  });

  it('is registered only where it will not eat an edit', () => {
    // A service worker in development caches the shell Vite is replacing, and
    // the symptom is an edit that appears to do nothing.
    const main = read('src', 'main.ts');
    expect(main).toMatch(/import\.meta\.env\.PROD/);
  });
});
