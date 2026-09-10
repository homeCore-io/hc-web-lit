/**
 * Where an install keeps its things.
 *
 * A bare install on an existing server is meant to be the same program as the
 * container with a different `HC_CONTENT_DIR`. That only holds if the paths
 * are somewhere an ordinary service user can write, and if they do not move
 * depending on where the process happened to be started.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('the server’s default paths', () => {
  it('hang off the install, not the working directory', () => {
    // `resolve('./var')` means `cwd/var`, which is the install directory only
    // when somebody has cd'd into it. Started by a systemd unit with no
    // `WorkingDirectory=`, that is `/var` — which the service user cannot
    // write, and which fails when somebody first saves rather than at startup.
    const source = readFileSync(join(root, 'server', 'server.ts'), 'utf8');
    expect(source).toContain("const ROOT = resolve(import.meta.dirname, '..')");
    expect(source).toMatch(/CONTENT_DIR = resolve\(\s*ROOT,/);
    expect(source).toMatch(/WEB_DIR = resolve\(ROOT,/);
    expect(source).not.toMatch(/resolve\(process\.env\['HC_(CONTENT|WEB)_DIR'\]/);
  });

  it('reports a store beside the code when started from somewhere else', () => {
    // The behaviour the two rules above exist for, exercised rather than read:
    // run the resolution with a different cwd and see where it lands.
    const script = [
      "const { resolve } = require('node:path');",
      `const ROOT = resolve(${JSON.stringify(join(root, 'server'))}, '..');`,
      'process.stdout.write(resolve(ROOT, process.env.HC_CONTENT_DIR ?? "var"));',
    ].join('');
    const got = execFileSync(process.execPath, ['-e', script], {
      cwd: '/tmp',
      encoding: 'utf8',
    });
    expect(got).toBe(join(root, 'var'));
    expect(got).not.toBe('/tmp/var');
  });

  it('lets an absolute override win outright', () => {
    // For an operator putting content on a different disk. `resolve` already
    // does this; the test says it is intended rather than incidental.
    expect(resolve(join(root, 'server'), '/srv/hc')).toBe('/srv/hc');
  });
});

describe('the container', () => {
  const containerfile = readFileSync(join(root, 'Containerfile'), 'utf8');

  it('keeps everything it writes inside the application directory', () => {
    // `/var/lib/...` is unwritable by the unprivileged user this runs as, and
    // is a path a person deploying onto an existing server may not own either.
    //
    // Directives only: the comment above the ENV explains why that path is not
    // used, and a blunter check flags the explanation as the offence.
    const directives = containerfile
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');

    expect(directives).not.toContain('/var/lib');
    expect(directives).toContain('VOLUME /app/var');
    expect(directives).toContain('HC_CONTENT_DIR=/app/var');
  });

  it('hands the directory over before dropping privileges', () => {
    // Afterwards is too late: a volume mounted over an empty path inherits
    // root ownership, and `node` cannot chown its way out of that.
    const chown = containerfile.indexOf('chown -R node:node');
    const user = containerfile.indexOf('USER node');
    expect(chown).toBeGreaterThan(-1);
    expect(chown).toBeLessThan(user);
  });
});
