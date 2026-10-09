import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, type MapDocument } from './core/map.ts';
import { RoadConflict, RoadStore } from './editing/road-store.ts';
import { MapWorkspace } from './editing/map-workspace.ts';
import { validatePlacementDefinitions, type PlacementDefinitions } from '../web/building-placement.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const responses: Record<string, [string, string]> = {
  '/': ['../../web/index.html', 'text/html; charset=utf-8'],
  '/dev-tool.css': ['../../web/dev-tool.css', 'text/css; charset=utf-8'],
  '/dev-tool.js': ['../../web/dev-tool.js', 'text/javascript; charset=utf-8'],
  '/tools/map-editor': ['web/index.html', 'text/html; charset=utf-8'],
  '/tools/map-editor/': ['web/index.html', 'text/html; charset=utf-8'],
  '/tools/asset-procgen': ['../../tools/asset-procgen/web/index.html', 'text/html; charset=utf-8'],
  '/tools/asset-procgen/': ['../../tools/asset-procgen/web/index.html', 'text/html; charset=utf-8'],
  '/tools/asset-procgen/app.js': ['../../tools/asset-procgen/web/app.js', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/style.css': ['../../tools/asset-procgen/web/style.css', 'text/css; charset=utf-8'],
  '/tools/asset-procgen/tree.mjs': ['../../tools/asset-procgen/web/tree.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/math.mjs': ['../../tools/asset-procgen/web/math.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak.mjs': ['../../tools/asset-procgen/web/oak.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/growth.mjs': ['../../tools/asset-procgen/web/growth.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/meshing.mjs': ['../../tools/asset-procgen/web/meshing.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/glb.mjs': ['../../tools/asset-procgen/web/glb.mjs', 'text/javascript; charset=utf-8'],
  '/app.js': ['web/app.js', 'text/javascript; charset=utf-8'],
  '/road-edit.mjs': ['web/road-edit.mjs', 'text/javascript; charset=utf-8'],
  '/terrain-edit.mjs': ['web/terrain-edit.mjs', 'text/javascript; charset=utf-8'],
  '/tool-state.mjs': ['web/tool-state.mjs', 'text/javascript; charset=utf-8'],
  '/edit-shortcuts.mjs': ['web/edit-shortcuts.mjs', 'text/javascript; charset=utf-8'],
  '/terrain-ray.mjs': ['web/terrain-ray.mjs', 'text/javascript; charset=utf-8'],
  '/terrain-patch.mjs': ['web/terrain-patch.mjs', 'text/javascript; charset=utf-8'],
  '/water-field.mjs': ['web/water-field.mjs', 'text/javascript; charset=utf-8'],
  '/entity-edit.mjs': ['web/entity-edit.mjs', 'text/javascript; charset=utf-8'],
  '/polygon-edit.mjs': ['web/polygon-edit.mjs', 'text/javascript; charset=utf-8'],
  '/mesh-data.mjs': ['web/mesh-data.mjs', 'text/javascript; charset=utf-8'],
  '/building-placement.mjs': ['web/building-placement.mjs', 'text/javascript; charset=utf-8'],
  '/workflow.mjs': ['web/workflow.mjs', 'text/javascript; charset=utf-8'],
  '/map-management.mjs': ['web/map-management.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['web/style.css', 'text/css; charset=utf-8'],
  '/vendor/three/build/three.module.js': ['../../node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/build/three.core.js': ['../../node_modules/three/build/three.core.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/examples/jsm/controls/OrbitControls.js': ['../../node_modules/three/examples/jsm/controls/OrbitControls.js', 'text/javascript; charset=utf-8'],
};

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 12_000_000) throw new RangeError('Map payload exceeds 12 MB');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Read-only by default; optional local workspace enables multi-map management. */
export function createEditorServer(source: MapDocument, store?: RoadStore, placementDefinitions?: PlacementDefinitions, workspace?: MapWorkspace): Server {
  const doc = validateDocument(source);
  const definitions = validatePlacementDefinitions(placementDefinitions ?? { buildings: [] });
  if (doc.heights.data.length > 1_500_000) throw new Error('Viewport currently supports at most 1,500,000 height samples');
  const binary = (current: MapDocument, path: string): Buffer => {
    if (path === '/api/surfaces') return Buffer.from(current.surfaces.data);
    const bytes = Buffer.allocUnsafe(current.heights.data.length * 4);
    for (let i = 0; i < current.heights.data.length; i++) bytes.writeFloatLE(current.heights.data[i], i * 4);
    return bytes;
  };
  // Canonical base64 only: no coercion, whitespace, partial decoding or oversized buffers.
  const encoded = (value: unknown, byteLength: number): Buffer => {
    if (typeof value !== 'string' || value.length !== Math.ceil(byteLength / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid asset encoding');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== byteLength || bytes.toString('base64') !== value) throw new Error('Invalid asset length');
    return bytes;
  };
  return createServer(async (req, res) => {
    const activeStore = workspace?.getStore() ?? store;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    const path = req.url?.split('?')[0];
    if (!path || !/^\/[A-Za-z0-9/_.-]*$/.test(path) || path.includes('..') || path.includes('//')) {
      res.writeHead(404); res.end(); return;
    }
    const writePaths = ['/api/roads', '/api/document', '/api/maps/active', '/api/maps/settings', '/api/maps/create'];
    if (writePaths.includes(path) && (req.method === 'PUT' || req.method === 'POST') && activeStore) {
      if (req.method !== (path === '/api/maps/create' ? 'POST' : 'PUT')) { res.writeHead(405); res.end(); return; }
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
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request body');
        const params = body as Record<string, unknown>;
        const { revision, roads } = params;
        if (typeof revision !== 'string') throw new Error('Invalid revision');
        let saved: string;
        if (path.startsWith('/api/maps/')) {
          if (!workspace) { res.writeHead(405); res.end(); return; }
          const expectedKeys = path === '/api/maps/active' ? ['file', 'mapFile', 'revision']
            : path === '/api/maps/create' ? ['form', 'mapFile', 'revision'] : ['mapFile', 'revision', 'settings'];
          if (Object.keys(params).sort().join() !== expectedKeys.sort().join()) throw new Error('Invalid workspace payload');
          if (typeof params.mapFile !== 'string') throw new Error('Invalid active map');
          if (path === '/api/maps/active') await workspace.activate(params.file as string, params.mapFile, revision);
          else if (path === '/api/maps/create') await workspace.create(params.form, params.mapFile, revision);
          else await workspace.saveSettings(params.settings as Parameters<MapWorkspace['saveSettings']>[0], revision, params.mapFile);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ file: workspace.getFile(), revision: workspace.getRevision() }));
          return;
        }
        if (!Object.hasOwn(body, 'roads')) throw new Error('Expected revision and roads');
        if (workspace && params.mapFile !== workspace.getFile()) throw new RoadConflict('Active map changed; reload before saving');
        if (path === '/api/roads') {
          if (Object.keys(body).some(key => !['revision', 'roads', ...(workspace ? ['mapFile'] : [])].includes(key))) throw new Error('Invalid road payload');
          saved = workspace ? await workspace.saveDocument({ roads }, revision, params.mapFile as string) : await activeStore.save(roads, revision);
        } else {
          if (Object.keys(body).some(key => !['revision', 'roads', 'buildings', 'objects', 'water', 'settlements', 'heights', 'surfaces', ...(workspace ? ['mapFile'] : [])].includes(key))) throw new Error('Invalid map payload');
          const current = activeStore.getDocument();
          const changes: { roads: unknown; buildings?: unknown; objects?: unknown; water?: unknown; settlements?: unknown; heights?: Float32Array; surfaces?: Uint8Array } = { roads };
          if (Object.hasOwn(body, 'buildings')) changes.buildings = (body as Record<string, unknown>).buildings;
          if (Object.hasOwn(body, 'objects')) changes.objects = (body as Record<string, unknown>).objects;
          if (Object.hasOwn(body, 'water')) changes.water = (body as Record<string, unknown>).water;
          if (Object.hasOwn(body, 'settlements')) changes.settlements = (body as Record<string, unknown>).settlements;
          if (Object.hasOwn(body, 'heights')) {
            const bytes = encoded((body as Record<string,unknown>).heights, current.heights.data.length * 4);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            changes.heights = Float32Array.from({ length: current.heights.data.length }, (_, i) => view.getFloat32(i * 4, true));
          }
          if (Object.hasOwn(body, 'surfaces')) {
            changes.surfaces = new Uint8Array(encoded((body as Record<string,unknown>).surfaces, current.surfaces.data.length));
          }
          saved = workspace ? await workspace.saveDocument(changes, revision, params.mapFile as string) : await activeStore.saveDocument(changes, revision);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ revision: saved, terrain: (workspace?.getStore() ?? activeStore).getDocument().map.terrain }));
      } catch (error) {
        const status = error instanceof RoadConflict ? 409 : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : error instanceof RangeError ? 413 : error instanceof SyntaxError || error instanceof Error && /^(Map:|Expected|Invalid)/.test(error.message) ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to write map' }));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: activeStore && (path === '/api/roads' || path === '/api/document') ? 'PUT' : 'GET, HEAD' }); res.end(); return;
    }
    try {
      const current = workspace?.getDocument() ?? activeStore?.getDocument() ?? doc;
      const readRevision = workspace?.getRevision() ?? activeStore?.getRevision() ?? null;
      // A different tab can switch active maps between /api/map and the two
      // binary downloads. Never serve an unrelated binary for old metadata.
      if ((path === '/api/heights' || path === '/api/surfaces') && req.headers['if-match'] !== undefined &&
          (readRevision === null || req.headers['if-match'] !== `"${readRevision}"`)) {
        res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Map revision changed during load');
        return;
      }
      if (path === '/api/heights' || path === '/api/surfaces') {
        if (readRevision !== null) res.setHeader('ETag', `"${readRevision}"`);
      }
      const item = path === '/api/maps' && workspace
        ? [Buffer.from(JSON.stringify({ maps: await workspace.list(), activeFile: workspace.getFile() })), 'application/json; charset=utf-8'] as [Buffer, string]
        : path === '/api/placement-definitions'
        ? [Buffer.from(JSON.stringify(definitions)), 'application/json; charset=utf-8'] as [Buffer, string]
        : path === '/api/map'
        ? [Buffer.from(JSON.stringify({ map: current.map, height: { width: current.heights.width, height: current.heights.height }, surface: { width: current.surfaces.width, height: current.surfaces.height }, readOnly: !activeStore, revision: workspace?.getRevision() ?? activeStore?.getRevision() ?? null, mapFile: workspace?.getFile() ?? null, workspace: Boolean(workspace) })), 'application/json; charset=utf-8'] as [Buffer, string]
        : path === '/api/heights' || path === '/api/surfaces'
          ? [binary(current, path), 'application/octet-stream'] as [Buffer, string] : undefined;
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
      res.end('Local editor asset unavailable. Run npm ci in dev_tool.');
    }
  });
}
