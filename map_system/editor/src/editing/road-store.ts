import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, lstat, rename, rm, realpath, chmod, stat, link } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { validateMap, validateDocument, type MapDocument } from '../core/map.ts';
import { encodeExr } from '../formats/exr.ts';
import { encodeSurfacePng } from '../formats/png.ts';
import { validateBuildingChanges, type PlacementDefinitions } from '../../web/building-placement.mjs';

export class RoadConflict extends Error {}
export interface MapSettings {
  name: string;
  min_height: number;
  max_height: number;
  surface_palette: string[];
}
const hash = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};

async function safeFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !samePath(await realpath(path), path)) throw new RoadConflict('File was redirected or replaced');
  return readFile(path);
}

async function atomicWrite(path: string, bytes: Buffer, mode = 0o644): Promise<void> {
  const tmp = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(tmp, 'wx', mode);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await chmod(tmp, mode);
    await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); }
}

/** Map-file commit point is the JSON rename; newly encoded assets are immutable. */
export class RoadStore {
  private readonly file: string;
  private revision: string;
  private readonly doc: MapDocument;
  private queue: Promise<void> = Promise.resolve();
  private assets = new Map<string, string>();
  private manifestHash: string | null = null;
  private readonly definitions?: PlacementDefinitions;

  private constructor(file: string, doc: MapDocument, revision: string, definitions?: PlacementDefinitions) {
    this.file = file; this.doc = doc; this.revision = revision; this.definitions = definitions;
  }

  static async open(file: string, doc: MapDocument, definitions?: PlacementDefinitions): Promise<RoadStore> {
    const target = resolve(file);
    const bytes = await safeFile(target);
    const parsed = validateMap(JSON.parse(bytes.toString('utf8')));
    if (JSON.stringify(parsed) !== JSON.stringify(doc.map)) throw new RoadConflict('Map changed while editor was opening');
    const store = new RoadStore(target, doc, hash(bytes), definitions);
    for (const name of [parsed.terrain.heightmap, parsed.terrain.surface_map]) {
      const path = resolve(dirname(target), name);
      try { store.assets.set(path, hash(await store.assetBytes(path))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const manifest = resolve(dirname(target), 'manifest.json');
    try { store.manifestHash = hash(await safeFile(manifest)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return store;
  }

  getRevision(): string { return this.revision; }
  getDocument(): MapDocument { return this.doc; }

  save(roads: unknown, expectedRevision: string): Promise<string> {
    return this.saveDocument({ roads }, expectedRevision);
  }

  saveDocument(changes: { roads: unknown; buildings?: unknown; objects?: unknown; water?: unknown; settlements?: unknown; heights?: Float32Array; surfaces?: Uint8Array; settings?: MapSettings }, expectedRevision: string): Promise<string> {
    const run = this.queue.then(() => this.persist(changes, expectedRevision));
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  private async assetBytes(path: string): Promise<Buffer> {
    const root = dirname(this.file);
    if (!inside(root, path)) throw new RoadConflict('Map asset lies outside map directory');
    const realRoot = await realpath(root), actual = await realpath(path);
    if (!inside(realRoot, actual) || !samePath(actual, path)) throw new RoadConflict('Map asset path uses a symlink');
    return safeFile(path);
  }

  private async verifySource(): Promise<void> {
    if (hash(await safeFile(this.file)) !== this.revision) throw new RoadConflict('Map changed on disk; edits were not written');
    for (const [path, digest] of this.assets) {
      if (hash(await this.assetBytes(path)) !== digest) throw new RoadConflict('Map asset changed on disk; edits were not written');
    }
    if (this.manifestHash !== null && hash(await safeFile(join(dirname(this.file), 'manifest.json'))) !== this.manifestHash) {
      throw new RoadConflict('Deployment manifest changed on disk; edits were not written');
    }
  }

  private async stageAsset(oldName: string, bytes: Buffer): Promise<string> {
    const root = dirname(this.file), ext = extname(oldName);
    const oldStem = oldName.slice(0, -ext.length).replace(/\.edit-[0-9a-f]{64}$/, '');
    const name = `${oldStem}.edit-${hash(bytes)}${ext}`;
    const target = resolve(root, name), parent = dirname(target);
    if (!inside(root, target) || !samePath(await realpath(parent), parent)) throw new RoadConflict('Invalid asset destination');
    try {
      const existing = await this.assetBytes(target);
      if (hash(existing) !== hash(bytes)) throw new RoadConflict('Existing generated asset has unexpected contents');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Publish a fully written temp file with an atomic no-replace hard link.
      // Directly writing the final path could expose half an EXR/PNG after a crash.
      const tmp = resolve(parent, `.${basename(target)}.${randomUUID()}.tmp`);
      try {
        const handle = await open(tmp, 'wx', 0o644);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        try { await link(tmp, target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (hash(await this.assetBytes(target)) !== hash(bytes)) throw new RoadConflict('Generated asset collision');
        }
      } finally { await rm(tmp, { force: true }); }
    }
    return name.split(sep).join('/');
  }

  private async persist(changes: { roads: unknown; buildings?: unknown; objects?: unknown; water?: unknown; settlements?: unknown; heights?: Float32Array; surfaces?: Uint8Array; settings?: MapSettings }, expectedRevision: string): Promise<string> {
    if (typeof expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(expectedRevision)) throw new Error('Invalid save revision');
    if (expectedRevision !== this.revision) throw new RoadConflict('Map revision is stale; refresh before saving');
    const next = structuredClone(this.doc.map);
    next.roads = changes.roads as typeof next.roads;
    if (changes.buildings !== undefined) next.buildings = changes.buildings as typeof next.buildings;
    if (changes.objects !== undefined) next.objects = changes.objects as typeof next.objects;
    if (changes.water !== undefined) next.water = changes.water as typeof next.water;
    if (changes.settlements !== undefined) next.settlements = changes.settlements as typeof next.settlements;
    if (changes.settings !== undefined) {
      const settings = changes.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
          Object.keys(settings).sort().join() !== 'max_height,min_height,name,surface_palette') throw new Error('Invalid map settings');
      next.name = settings.name;
      next.terrain.min_height = settings.min_height;
      next.terrain.max_height = settings.max_height;
      next.terrain.surface_palette = settings.surface_palette;
    }
    const heights = changes.heights ?? this.doc.heights.data;
    const surfaces = changes.surfaces ?? this.doc.surfaces.data;
    if (!(heights instanceof Float32Array) || heights.length !== this.doc.heights.data.length ||
        !(surfaces instanceof Uint8Array) || surfaces.length !== this.doc.surfaces.data.length) throw new Error('Invalid map asset dimensions');
    if (changes.heights) for (const h of heights) if (!Number.isFinite(h) || h < 0 || h > 1) throw new Error('Invalid height sample (expected 0..1)');
    const candidate = { map: next, heights: { ...this.doc.heights, data: heights }, surfaces: { ...this.doc.surfaces, data: surfaces } };
    validateDocument(candidate);
    if (this.definitions) validateBuildingChanges(
      { map: next, height: candidate.heights },
      { map: this.doc.map, height: this.doc.heights },
      this.definitions
    );
    await this.verifySource();
    // Require source assets to have been loaded from disk before replacing their references.
    if (changes.heights && !this.assets.has(resolve(dirname(this.file), next.terrain.heightmap))) throw new RoadConflict('Cannot edit a missing heightmap file');
    if (changes.surfaces && !this.assets.has(resolve(dirname(this.file), next.terrain.surface_map))) throw new RoadConflict('Cannot edit a missing surface map file');
    const generated: string[] = [];
    if (changes.heights) {
      next.terrain.heightmap = await this.stageAsset(next.terrain.heightmap, encodeExr({ ...this.doc.heights, data: heights }));
      generated.push(next.terrain.heightmap);
    }
    if (changes.surfaces) {
      next.terrain.surface_map = await this.stageAsset(next.terrain.surface_map, encodeSurfacePng({ ...this.doc.surfaces, data: surfaces }));
      generated.push(next.terrain.surface_map);
    }
    validateMap(next);
    const verifyGenerated = async () => {
      for (const name of generated) {
        const path = resolve(dirname(this.file), name);
        if (!await this.assetBytes(path).then(bytes => hash(bytes) === name.match(/\.edit-([a-f0-9]{64})\./)?.[1])) throw new RoadConflict('Staged asset changed unexpectedly');
      }
    };
    // Manifest is published before the map starts referencing generated assets.
    if (generated.length && this.manifestHash !== null) {
      const manifestFile = join(dirname(this.file), 'manifest.json');
      const original = await safeFile(manifestFile);
      if (hash(original) !== this.manifestHash) throw new RoadConflict('Deployment manifest changed on disk');
      const manifest: unknown = JSON.parse(original.toString('utf8'));
      if (!manifest || typeof manifest !== 'object' || !('files' in manifest) ||
          !Array.isArray(manifest.files) || !manifest.files.every(x => typeof x === 'string')) {
        throw new Error('Invalid deployment manifest');
      }
      for (const name of generated) if (!manifest.files.includes(name)) manifest.files.push(name);
      const output = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
      await this.verifySource();
      await atomicWrite(manifestFile, output, (await stat(manifestFile)).mode & 0o777);
      this.manifestHash = hash(output);
    }
    const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
    await this.verifySource();
    await verifyGenerated();
    await atomicWrite(this.file, bytes, (await stat(this.file)).mode & 0o777);
    this.doc.map = next;
    if (changes.heights) this.doc.heights.data = new Float32Array(heights);
    if (changes.surfaces) this.doc.surfaces.data = new Uint8Array(surfaces);
    this.assets = new Map(await Promise.all(
      [next.terrain.heightmap, next.terrain.surface_map].filter(name =>
        this.assets.has(resolve(dirname(this.file), name)) || generated.includes(name)
      ).map(async name => {
        const path = resolve(dirname(this.file), name);
        return [path, hash(await this.assetBytes(path))] as const;
      })
    ));
    this.revision = hash(bytes);
    return this.revision;
  }
}
