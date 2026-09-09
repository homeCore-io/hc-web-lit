/**
 * hc-web-lit, serving itself.
 *
 * A self-contained system: it serves the built app and holds what a household
 * authored, in a directory the end user sizes. Container first, and a bare
 * install is the same program with a different `HC_CONTENT_DIR`.
 *
 * **It is not a proxy for core and does not want to be.** The browser talks to
 * hc-api directly for everything that is a fact about the house — devices,
 * dashboards, history — because those are core's and a second copy of them
 * here would be the mistake this whole arrangement exists to undo. What this
 * holds is only what a person made.
 *
 * §19.1 says no logic lives in hc-web that is not reachable over an API. That
 * still holds: everything here is HTTP, so a script can do what the UI can.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Auth, READ_SCOPE, WRITE_SCOPE } from './auth.ts';
import { Store } from './store.ts';

const PORT = Number(process.env['HC_PORT'] ?? 8090);
const HOST = process.env['HC_HOST'] ?? '0.0.0.0';
const CONTENT_DIR = resolve(process.env['HC_CONTENT_DIR'] ?? './var');
/**
 * Where core is — the same variable the dev server proxies with, so one
 * setting points both halves of a development machine at the same house.
 */
const CORE_URL = process.env['HC_CORE_URL'] ?? 'http://10.0.10.150:8080';
const WEB_DIR = resolve(process.env['HC_WEB_DIR'] ?? './dist');

/**
 * Who may read and write, decided by core.
 *
 * The household already has an identity system with roles and scopes, and a
 * second one here would be a second place to disagree about who somebody is.
 * The browser holds a bearer from core; this asks core what it is worth.
 */
const auth = new Auth({ base: CORE_URL });

const store = new Store(CONTENT_DIR, {
  maxBytes: Number(process.env['HC_MAX_BYTES'] ?? 16 * 1024 * 1024),
  maxTotalBytes: Number(process.env['HC_MAX_TOTAL_BYTES'] ?? 0),
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
};

async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    // Refused while it arrives rather than after: a client that will not take
    // no for an answer should not be able to fill a disk first.
    if (size > limit) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** The app itself, and index.html for anything that is not a file. */
async function serveWeb(url: string, res: ServerResponse): Promise<void> {
  const wanted = normalize(url.split('?')[0] ?? '/').replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(join(WEB_DIR, wanted === '/' ? 'index.html' : wanted));
  const file = candidate.startsWith(WEB_DIR) ? candidate : join(WEB_DIR, 'index.html');

  try {
    const info = await stat(file);
    const path = info.isDirectory() ? join(file, 'index.html') : file;
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  } catch {
    // A route the app owns, not a missing file: hand over the app and let it
    // decide. A dashboard link that 404s on reload is the classic version of
    // this bug.
    try {
      res.writeHead(200, { 'content-type': TYPES['.html']! });
      createReadStream(join(WEB_DIR, 'index.html')).pipe(res);
    } catch {
      send(res, 404, { error: 'not built' });
    }
  }
}

export const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  try {
    if (url === '/api/health') return send(res, 200, { ok: true, content: CONTENT_DIR });

    // The app itself is not behind the door — a browser has to load the login
    // screen before it has anything to log in with. Nor is an asset: a browser
    // sends no Authorization header for an `<img>`, and the id is the sha256
    // of the bytes, which is core's own reasoning for the same route.
    if (url.startsWith('/api/') && !/^\/api\/assets\/[0-9a-f]{64}$/.test(url)) {
      const caller = await auth.caller(Auth.bearer(req.headers.authorization));
      if (caller === undefined) {
        res.writeHead(401, { 'www-authenticate': 'Bearer' });
        return void res.end(JSON.stringify({ error: 'no valid bearer' }));
      }
      // Both directions use core's own scopes rather than a second rule: every
      // role core ships can read dashboards, and three of the seven cannot
      // write them, which is the line this content wants drawn too.
      const needed = method === 'GET' ? READ_SCOPE : WRITE_SCOPE;
      if (!caller.scopes.includes(needed)) {
        return send(res, 403, { error: `${caller.role} lacks ${needed}` });
      }
    }

    if (url === '/api/content' && method === 'GET') {
      return send(res, 200, { keys: await store.keys() });
    }

    const one = /^\/api\/content\/([a-z0-9._-]+)$/i.exec(url);
    if (one !== null) {
      const key = one[1]!;
      if (method === 'GET') {
        const value = await store.readContent(key);
        return value === undefined
          ? send(res, 404, { error: 'no such key' })
          : send(res, 200, value);
      }
      if (method === 'PUT') {
        const raw = await body(req, store.limits.maxBytes);
        await store.writeContent(key, JSON.parse(raw.toString('utf8')) as unknown);
        return send(res, 204, null);
      }
      if (method === 'DELETE') {
        await store.removeContent(key);
        return send(res, 204, null);
      }
    }

    if (url === '/api/assets' && method === 'POST') {
      const bytes = await body(req, store.limits.maxBytes);
      return send(res, 201, await store.putAsset(bytes, String(req.headers['x-extension'] ?? '')));
    }

    const asset = /^\/api\/assets\/([0-9a-f]{64})$/.exec(url);
    if (asset !== null && method === 'GET') {
      const bytes = await store.getAsset(asset[1]!);
      if (bytes === undefined) return send(res, 404, { error: 'no such asset' });
      // Addressed by the hash of its contents, so it can never change.
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      });
      return void res.end(bytes);
    }

    if (url.startsWith('/api/')) return send(res, 404, { error: 'no such route' });
    return await serveWeb(url, res);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return send(res, why === 'too large' ? 413 : 400, { error: why });
  }
};

// Started only when run directly, so a test can drive the handler.
if (process.argv[1]?.endsWith('server.ts') === true) {
  createServer((req, res) => void handler(req, res)).listen(PORT, HOST, () => {
    process.stdout.write(
      `hc-web-lit on ${HOST}:${PORT}, content in ${CONTENT_DIR}, asking ${CORE_URL} who is calling\n`,
    );
  });
}
