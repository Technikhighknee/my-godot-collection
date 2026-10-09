import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, type MapDocument } from './core/map.ts';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const responses: Record<string, [string, string]> = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['web/app.js', 'text/javascript; charset=utf-8'],
  '/mesh-data.mjs': ['web/mesh-data.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['web/style.css', 'text/css; charset=utf-8'],
  '/vendor/three/build/three.module.js': ['node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/build/three.core.js': ['node_modules/three/build/three.core.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/examples/jsm/controls/OrbitControls.js': ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'text/javascript; charset=utf-8'],
};

/** Browser payloads are snapshots. This server intentionally has no mutation endpoints. */
export function createEditorServer(source: MapDocument): Server {
  const doc = validateDocument(source);
  if (doc.heights.data.length > 1_500_000) throw new Error('Viewport currently supports at most 1,500,000 height samples');
  const metadata = Buffer.from(JSON.stringify({ map: doc.map, height: { width: doc.heights.width, height: doc.heights.height }, surface: { width: doc.surfaces.width, height: doc.surfaces.height }, readOnly: true }));
  const heights = Buffer.allocUnsafe(doc.heights.data.length * 4);
  for (let i = 0; i < doc.heights.data.length; i++) heights.writeFloatLE(doc.heights.data[i], i * 4);
  const surfaces = Buffer.from(doc.surfaces.data);
  const binary: Record<string, [Buffer, string]> = {
    '/api/map': [metadata, 'application/json; charset=utf-8'],
    '/api/heights': [heights, 'application/octet-stream'],
    '/api/surfaces': [surfaces, 'application/octet-stream'],
  };
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    // Avoid path decoding, directory traversal and any ambient file access.
    const path = req.url?.split('?')[0];
    if (!path || !/^\/[A-Za-z0-9/_.-]*$/.test(path) || path.includes('..') || path.includes('//')) {
      res.writeHead(404); res.end(); return;
    }
    try {
      const item = binary[path];
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
