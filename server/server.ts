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
import { Auth, mayRead, mayWrite } from './auth.ts';
import { assetHeaders } from './assets.ts';
import { Extensions } from './extensions.ts';
import { Store } from './store.ts';

const PORT = Number(process.env['HC_PORT'] ?? 8090);
const HOST = process.env['HC_HOST'] ?? '0.0.0.0';
/**
 * Where this install lives, from the code's own location.
 *
 * **Not the working directory.** `resolve('./var')` means `cwd/var`, which is
 * the install directory only when somebody happens to have cd'd into it. Run
 * as `node /opt/hc-web-lit/server/server.ts` from a home directory and a
 * household's content lands in `~/var`; run from a systemd unit with no
 * `WorkingDirectory=` and it lands in `/var`, which the service user cannot
 * write. Both fail at the moment somebody first saves something, not at
 * startup, which is the worst time to find out.
 *
 * So the defaults hang off the install root: unpack it anywhere, start it from
 * anywhere, and its content and its app are beside it. That is what makes a
 * bare install on an existing server the same program as the container rather
 * than a different deployment story.
 */
const ROOT = resolve(import.meta.dirname, '..');

/**
 * What hc-web-lit's server keeps.
 *
 * An absolute `HC_CONTENT_DIR` wins outright, for an operator who wants the
 * content on a different disk. A relative one is relative to the **install**,
 * not to whatever directory the process was started from — because that is
 * what somebody setting `HC_CONTENT_DIR=data` means, and because the
 * alternative is a path that moves when the service does.
 */
const CONTENT_DIR = resolve(ROOT, process.env['HC_CONTENT_DIR'] ?? 'var');
/**
 * Where core is — the same variable the dev server proxies with, so one
 * setting points both halves of a development machine at the same house.
 */
const CORE_URL = process.env['HC_CORE_URL'] ?? 'http://10.0.10.150:8080';
const WEB_DIR = resolve(ROOT, process.env['HC_WEB_DIR'] ?? 'dist');

/**
 * Who may read and write, decided by core.
 *
 * The household already has an identity system with roles and scopes, and a
 * second one here would be a second place to disagree about who somebody is.
 * The browser holds a bearer from core; this asks core what it is worth.
 */
const auth = new Auth({ base: CORE_URL });

/**
 * What a third party shipped, served so a browser can import it.
 *
 * Beside the content store rather than inside it: content is JSON somebody
 * typed and this is code somebody installed, and the two have different
 * lifecycles, different sizes and different answers to "may I delete this".
 */
const extensions = new Extensions(CONTENT_DIR);

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
    //
    // An extension's *files* are the same case one step further: a dynamic
    // `import()` carries no header either, and a module the browser refuses to
    // fetch is a widget that silently never appears. Reading the **list** is
    // not — that is the app asking what is installed, and it has a bearer.
    const openExtFile = /^\/api\/extensions\/[^/]+\/.+$/.test(url);

    if (url.startsWith('/api/') && !/^\/api\/assets\/[0-9a-f]{64}$/.test(url) && !openExtFile) {
      const caller = await auth.caller(Auth.bearer(req.headers.authorization));
      if (caller === undefined) {
        res.writeHead(401, { 'www-authenticate': 'Bearer' });
        return void res.end(JSON.stringify({ error: 'no valid bearer' }));
      }
      // Both directions use core's own scopes rather than a second rule: every
      // role core ships can read dashboards, and three of the seven cannot
      // write them, which is the line this content wants drawn too.
      const allowed = method === 'GET' ? mayRead(caller.scopes) : mayWrite(caller.scopes);
      if (!allowed) {
        return send(res, 403, {
          error: `${caller.role} may not ${method === 'GET' ? 'read' : 'write'} here`,
        });
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

    if (url === '/api/extensions' && method === 'GET') {
      return send(res, 200, await extensions.list());
    }

    const extFile = /^\/api\/extensions\/([^/?]+)\/([^?]+)(?:\?.*)?$/.exec(url);
    if (extFile !== null && method === 'GET') {
      const file = await extensions.file(
        decodeURIComponent(extFile[1]!),
        decodeURIComponent(extFile[2]!),
      );
      if (file === undefined) return send(res, 404, { error: 'no such extension file' });
      res.writeHead(200, {
        'content-type': file.type,
        // The `?v=` cache-buster on the import URL is keyed to the manifest
        // version (§8.1), so an update takes effect on reload without any
        // service-worker gymnastics — and that only works if the response is
        // cacheable in the first place.
        'cache-control': 'public, max-age=31536000, immutable',
      });
      return void res.end(file.bytes);
    }

    if (url === '/api/extensions' && method === 'POST') {
      // §18.2's first retirement condition: a third party ships a `.tar.gz`
      // and a household installs it without rebuilding anything. What the
      // archive is allowed to contain is `tar.ts`'s business, and it refuses
      // nearly everything.
      const bytes = await body(req, store.limits.maxBytes);
      const got = await extensions.install(bytes, {
        maxBytes: store.limits.maxBytes,
        maxTotalBytes: store.limits.maxBytes,
        maxFiles: 200,
      });
      return send(res, 201, got);
    }

    if (url === '/api/assets' && method === 'POST') {
      const bytes = await body(req, store.limits.maxBytes);
      return send(res, 201, await store.putAsset(bytes, String(req.headers['x-extension'] ?? '')));
    }

    const asset = /^\/api\/assets\/([0-9a-f]{64})$/.exec(url);
    if (asset !== null && method === 'GET') {
      const found = await store.getAsset(asset[1]!);
      if (found === undefined) return send(res, 404, { error: 'no such asset' });
      // Typed so a browser will render it, and sandboxed so that being able
      // to render it is not a way into this origin (§ assets.ts). Both, and
      // for the same reason: the store exists to serve a household's own
      // pictures, and it serves them from the origin the session lives in.
      res.writeHead(200, assetHeaders(found.type));
      return void res.end(found.bytes);
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
