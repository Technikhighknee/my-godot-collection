import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, link, stat, chmod } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { validateDocument, validateMap, type MapDocument, type MapJson } from '../core/map.ts';
import { encodeExr } from '../formats/exr.ts';
import { encodeSurfacePng } from '../formats/png.ts';
import { loadMap } from '../io/map-io.ts';
import { RoadConflict, RoadStore, type MapSettings } from './road-store.ts';
import type { PlacementDefinitions } from '../../web/building-placement.mjs';

const filenamePattern = /^[a-z0-9][a-z0-9_-]{0,47}\.map\.json$/;
const slugPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const inside = (root: string, file: string) => {
  const path = relative(root, file);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
};

/** Write bytes without ever replacing an existing file, even across processes. */
async function publishNew(path: string, bytes: Buffer): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, 'wx', 0o644);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temp, path);
  } finally { await rm(temp, { force: true }); }
}

async function safeRead(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) throw new RoadConflict('Map file redirected or replaced');
  return readFile(path);
}

/** Workspace is restricted to the startup map's directory, not an arbitrary filesystem browser. */
export class MapWorkspace {
  readonly root: string;
  private activeFile: string;
  private activeStore: RoadStore;
  private definitions?: PlacementDefinitions;
  private queue: Promise<void> = Promise.resolve();

  private constructor(root: string, filename: string, store: RoadStore, definitions?: PlacementDefinitions) {
    this.root = root;
    this.activeFile = filename;
    this.activeStore = store;
    this.definitions = definitions;
  }

  static async open(file: string, definitions?: PlacementDefinitions): Promise<MapWorkspace> {
    const target = resolve(file);
    const root = await realpath(dirname(target));
    if (!inside(root, target)) throw new RoadConflict('Map path escapes workspace');
    await safeRead(target);
    const doc = await loadMap(target);
    return new MapWorkspace(root, basename(target), await RoadStore.open(target, doc, definitions), definitions);
  }

  getFile(): string { return this.activeFile; }
  getRevision(): string { return this.activeStore.getRevision(); }
  getDocument(): MapDocument { return this.activeStore.getDocument(); }
  getStore(): RoadStore { return this.activeStore; }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const action = this.queue.then(task);
    this.queue = action.then(() => {}, () => {});
    return action;
  }

  saveDocument(changes: Parameters<RoadStore['saveDocument']>[0], revision: string, file: string): Promise<string> {
    return this.run(async () => {
      this.assertActive(file, revision);
      return this.activeStore.saveDocument(changes, revision);
    });
  }

  saveSettings(settings: MapSettings, revision: string, file: string): Promise<string> {
    return this.run(async () => {
      this.assertActive(file, revision);
      return this.activeStore.saveDocument({ roads: this.activeStore.getDocument().map.roads, settings }, revision);
    });
  }

  private assertActive(file: string, revision: string): void {
    if (file !== this.activeFile || revision !== this.activeStore.getRevision())
      throw new RoadConflict('The active map changed; reload before writing');
  }

  async list(): Promise<{ file: string; name: string; valid: boolean; active: boolean }[]> {
    // Waiting for pending writes gives callers a coherent view of this process.
    await this.queue;
    const files = await readdir(this.root, { withFileTypes: true });
    const result: { file: string; name: string; valid: boolean; active: boolean }[] = [];
    for (const file of files) {
      if (!file.isFile() || !(filenamePattern.test(file.name) || file.name === this.activeFile)) continue;
      let valid = true, name = file.name;
      try {
        const path = join(this.root, file.name);
        // Only advertise maps that this workspace can actually open, including
        // their EXR/PNG dimensions, contents and symlink protections.
        await safeRead(path);
        const doc = await loadMap(path);
        await RoadStore.open(path, doc, this.definitions);
        name = doc.map.name;
      } catch { valid = false; }
      result.push({ file: file.name, name, valid, active: file.name === this.activeFile });
    }
    return result.sort((a, b) => a.file.localeCompare(b.file));
  }

  activate(file: string, currentFile: string, revision: string): Promise<void> {
    return this.run(async () => {
      this.assertActive(currentFile, revision);
      if (!filenamePattern.test(file) && file !== this.activeFile) throw new Error('Invalid map filename');
      if (file === this.activeFile) return;
      const target = resolve(this.root, file);
      if (!inside(this.root, target)) throw new Error('Invalid map path');
      await safeRead(target);
      const doc = await loadMap(target);
      const next = await RoadStore.open(target, doc, this.definitions);
      this.activeFile = file;
      this.activeStore = next;
    });
  }

  create(input: unknown, currentFile: string, revision: string): Promise<void> {
    return this.run(async () => {
      this.assertActive(currentFile, revision);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid map creation parameters');
      const form = input as Record<string, unknown>;
      if (Object.keys(form).sort().join() !== 'heightSamples,maxHeight,minHeight,name,slug,surfacePalette,worldSize')
        throw new Error('Invalid map creation parameters');
      const { slug, name, worldSize, heightSamples, minHeight, maxHeight, surfacePalette } = form;
      if (typeof slug !== 'string' || !slugPattern.test(slug)) throw new Error('Invalid map slug');
      if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('Invalid map name');
      const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
      if (!isPair(worldSize) || worldSize.some((n: number) => n <= 0 || n > 8192)) throw new Error('Invalid map world dimensions');
      if (!isPair(heightSamples) || heightSamples.some((n: number) => !Number.isInteger(n) || n < 2 || n > 1025) || heightSamples[0] * heightSamples[1] > 1_500_000)
        throw new Error('Invalid height sample dimensions');
      if (typeof minHeight !== 'number' || !Number.isFinite(minHeight) || typeof maxHeight !== 'number' || !Number.isFinite(maxHeight) || maxHeight <= minHeight || maxHeight - minHeight > 100000)
        throw new Error('Invalid height range');
      if (!Array.isArray(surfacePalette) || surfacePalette.length < 1 || surfacePalette.length > 16 ||
          surfacePalette.some(x => typeof x !== 'string' || !x.trim() || x.length > 120) || new Set(surfacePalette).size !== surfacePalette.length)
        throw new Error('Invalid surface palette');
      const file = `${slug}.map.json`;
      const heightmap = `assets/${slug}.height.exr`, surface_map = `assets/${slug}.surface.png`;
      const map: MapJson = {
        name, terrain: { size: [...worldSize] as [number, number], heightmap, surface_map, min_height: minHeight, max_height: maxHeight, surface_palette: [...surfacePalette] },
        roads: [], settlements: [], water: [{ id: 'sea', definition: 'water.sea', height: 0 }], buildings: [], objects: [],
      };
      const [width, height] = heightSamples as number[];
      const normalizedZero = Math.max(0, Math.min(1, -minHeight / (maxHeight - minHeight)));
      const heights = { width, height, data: new Float32Array(width * height).fill(normalizedZero) };
      const surfaces = { width: width - 1, height: height - 1, data: new Uint8Array((width - 1) * (height - 1)) };
      const doc = validateDocument({ map, heights, surfaces });
      const outputs = [
        [heightmap, encodeExr(heights)],
        [surface_map, encodeSurfacePng(surfaces)],
        [file, Buffer.from(JSON.stringify(map, null, 2) + '\n')],
      ] as const;
      // Check all names first. No overwrite, including if an external process races us.
      const assetsDir = join(this.root, 'assets');
      try { await mkdir(assetsDir); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (await realpath(assetsDir) !== assetsDir || !(await stat(assetsDir)).isDirectory()) throw new RoadConflict('Assets directory is redirected');
      for (const [path] of outputs) {
        if (!inside(this.root, resolve(this.root, path))) throw new Error('Invalid output path');
        try { await lstat(resolve(this.root, path)); throw new RoadConflict('Map or asset file already exists'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      }
      const manifestPath = join(this.root, 'manifest.json');
      let manifest: { files: string[] } | null = null;
      let manifestBytes: Buffer | null = null;
      try {
        manifestBytes = await safeRead(manifestPath);
        const data: unknown = JSON.parse(manifestBytes.toString('utf8'));
        if (!data || typeof data !== 'object' || !('files' in data) || !Array.isArray(data.files) || !data.files.every(x => typeof x === 'string'))
          throw new Error('Invalid deployment manifest');
        manifest = data as { files: string[] };
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const created: string[] = [];
      let manifestPublished = false;
      try {
        for (const [path, bytes] of outputs.slice(0, 2)) {
          await publishNew(join(this.root, path), bytes);
          created.push(join(this.root, path));
        }
        if (manifest && manifestBytes) {
          const updated = { ...manifest, files: [...manifest.files] };
          for (const [path] of outputs) if (!updated.files.includes(path)) updated.files.push(path);
          if (sha(await safeRead(manifestPath)) !== sha(manifestBytes)) throw new RoadConflict('Deployment manifest changed on disk');
          const temp = join(this.root, `.manifest.${randomUUID()}.tmp`);
          try {
            const handle = await open(temp, 'wx', (await stat(manifestPath)).mode & 0o777);
            try { await handle.writeFile(JSON.stringify(updated, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
            await chmod(temp, (await stat(manifestPath)).mode & 0o777);
            if (sha(await safeRead(manifestPath)) !== sha(manifestBytes)) throw new RoadConflict('Deployment manifest changed on disk');
            await rename(temp, manifestPath);
            manifestPublished = true;
          } finally { await rm(temp, { force: true }); }
        }
        for (const [path, bytes] of outputs.slice(0, 2)) {
          if (sha(await safeRead(join(this.root, path))) !== sha(bytes))
            throw new RoadConflict('New map asset changed during creation');
        }
        await publishNew(join(this.root, file), outputs[2][1]);
        created.push(join(this.root, file));
        const store = await RoadStore.open(join(this.root, file), doc, this.definitions);
        this.activeFile = file;
        this.activeStore = store;
      } catch (error) {
        // Before the map file is published the newly created assets have no owner.
        // Once a deployment manifest references assets, never remove those files on failure.
        if (!manifestPublished && !created.includes(join(this.root, file))) for (const path of created) await rm(path, { force: true });
        throw error;
      }
    });
  }
}
