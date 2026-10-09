import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, type MapDocument } from './core/map.ts';
import { RoadConflict, RoadStore } from './editing/road-store.ts';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const responses: Record<string, [string, string]> = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['web/app.js', 'text/javascript; charset=utf-8'],
  '/road-edit.mjs': ['web/road-edit.mjs', 'text/javascript; charset=utf-8'],
  '/mesh-data.mjs': ['web/mesh-data.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['web/style.css', 'text/css; charset=utf-8'],
  '/vendor/three/build/three.module.js': ['node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/build/three.core.js': ['node_modules/three/build/three.core.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/examples/jsm/controls/OrbitControls.js': ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'text/javascript; charset=utf-8'],
};

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new RangeError('Road payload exceeds 2 MB');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Read-only by default; only an explicitly supplied store enables saving roads. */
export function createEditorServer(source: MapDocument, store?: RoadStore): Server {
  const doc = validateDocument(source);
  if (doc.heights.data.length > 1_500_000) throw new Error('Viewport currently supports at most 1,500,000 height samples');
  const heights = Buffer.allocUnsafe(doc.heights.data.length * 4);
  for (let i = 0; i < doc.heights.data.length; i++) heights.writeFloatLE(doc.heights.data[i], i * 4);
  const surfaces = Buffer.from(doc.surfaces.data);
  const binary: Record<string, [Buffer, string]> = {
    '/api/heights': [heights, 'application/octet-stream'],
    '/api/surfaces': [surfaces, 'application/octet-stream'],
  };
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    const path = req.url?.split('?')[0];
    if (!path || !/^\/[A-Za-z0-9/_.-]*$/.test(path) || path.includes('..') || path.includes('//')) {
      res.writeHead(404); res.end(); return;
    }
    if (path === '/api/roads' && req.method === 'PUT' && store) {
      // Protect local writes from cross-origin browser requests and DNS rebinding.
      const address = res.socket?.localAddress;
      const port = res.socket?.localPort;
      const host = `127.0.0.1:${port}`;
      if (address !== '127.0.0.1' || req.headers.host !== host || req.headers.origin !== `http://${host}` ||
          req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        res.writeHead(403); res.end(); return;
      }
      try {
        const body = await jsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some(key => !['revision', 'roads'].includes(key)) ||
            !Object.hasOwn(body, 'roads') || !Object.hasOwn(body, 'revision')) throw new Error('Expected revision and roads');
        const { revision, roads } = body as Record<string, unknown>;
        const saved = await store.save(roads, revision as string);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ revision: saved }));
      } catch (error) {
        const status = error instanceof RoadConflict ? 409 : error instanceof RangeError ? 413 : error instanceof SyntaxError || error instanceof Error && /^(Map:|Expected|Invalid)/.test(error.message) ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to save roads' }));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: store && path === '/api/roads' ? 'PUT' : 'GET, HEAD' }); res.end(); return;
    }
    try {
      const item = path === '/api/map'
        ? [Buffer.from(JSON.stringify({ map: doc.map, height: { width: doc.heights.width, height: doc.heights.height }, surface: { width: doc.surfaces.width, height: doc.surfaces.height }, readOnly: !store, revision: store?.getRevision() ?? null })), 'application/json; charset=utf-8'] as [Buffer, string]
        : binary[path];
      const file = responses[path];
      if (!item && !file) { res.writeHead(404); res.end(); return; }
      let bytes: Buffer;
      let mime: string;
      if (item) [bytes, mime] = item;
      else if (file) { bytes = await readFile(join(root, file[0])); mime = file[1]; }
      else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Local editor asset unavailable. Run npm install in map_system/editor.');
    }
  });
}
