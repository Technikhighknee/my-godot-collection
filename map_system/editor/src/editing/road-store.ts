import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, lstat, rename, rm, realpath, chmod } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { validateMap, type MapDocument, type Road } from '../core/map.ts';

export class RoadConflict extends Error {}
const hash = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Opt-in JSON-only persistence. Heightmaps and surface maps are never rewritten. */
export class RoadStore {
  private readonly file: string;
  private revision: string;
  private readonly doc: MapDocument;
  private queue: Promise<void> = Promise.resolve();

  private constructor(file: string, doc: MapDocument, revision: string) {
    this.file = file;
    this.doc = doc;
    this.revision = revision;
  }

  static async open(file: string, doc: MapDocument): Promise<RoadStore> {
    const target = resolve(file);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Map JSON must be a regular file, not a symlink');
    if (!samePath(await realpath(target), target)) throw new Error('Map JSON path must not contain symbolic links');
    const bytes = await readFile(target);
    const parsed = validateMap(JSON.parse(bytes.toString('utf8')));
    if (JSON.stringify(parsed) !== JSON.stringify(doc.map)) throw new RoadConflict('Map changed while editor was opening');
    return new RoadStore(target, doc, hash(bytes));
  }

  getRevision(): string { return this.revision; }

  save(roads: unknown, expectedRevision: string): Promise<string> {
    // Serializes requests from multiple browser tabs on this process.
    const run = this.queue.then(() => this.persist(roads, expectedRevision));
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  private async persist(roads: unknown, expectedRevision: string): Promise<string> {
    if (typeof expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(expectedRevision)) throw new Error('Invalid save revision');
    if (expectedRevision !== this.revision) throw new RoadConflict('Map revision is stale; refresh before saving');
    const next = validateMap({ ...this.doc.map, roads });
    const nextBytes = Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8');
    const stat = await lstat(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await realpath(this.file), this.file)) {
      throw new RoadConflict('Map file was replaced or redirected');
    }
    if (hash(await readFile(this.file)) !== this.revision) throw new RoadConflict('Map changed on disk; your edits were not written');
    const temporary = resolve(dirname(this.file), `.${basename(this.file)}.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', stat.mode & 0o777);
      try { await handle.writeFile(nextBytes); await handle.sync(); } finally { await handle.close(); }
      await chmod(temporary, stat.mode & 0o777);
      // Check again just before the atomic replacement. Never overwrite a detected external edit.
      const latest = await lstat(this.file);
      if (!latest.isFile() || latest.isSymbolicLink() || !samePath(await realpath(this.file), this.file) || hash(await readFile(this.file)) !== this.revision) {
        throw new RoadConflict('Map changed on disk; your edits were not written');
      }
      await rename(temporary, this.file);
      this.doc.map = next;
      this.revision = hash(nextBytes);
      return this.revision;
    } finally { await rm(temporary, { force: true }); }
  }
}
