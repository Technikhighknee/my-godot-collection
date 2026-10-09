import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { decodeExr, encodeExr } from '../formats/exr.ts';
import { decodeSurfacePng, encodeSurfacePng } from '../formats/png.ts';
import { validateDocument, validateMap, type MapDocument } from '../core/map.ts';

/** Load into memory only. Never writes to a deployed Godot package. */
export async function loadMap(mapFile: string): Promise<MapDocument> {
  const input=JSON.parse(await readFile(mapFile,'utf8')) as unknown;
  const map=validateMap(input);
  const root=resolve(dirname(mapFile));
  const safe=async (p:string) => {
    const dest=resolve(root,p),rel=relative(root,dest);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw new Error('Map asset escapes map directory');
    // Reject symbolic links, including links in ancestor directories.
    const { realpath }=await import('node:fs/promises');
    const realRoot=await realpath(root), realTarget=await realpath(dest);
    const actual=relative(realRoot,realTarget);
    if(isAbsolute(actual)||actual==='..'||actual.startsWith(`..${sep}`))throw new Error('Map asset symlink escapes map directory');
    return readFile(realTarget);
  };
  const [heightBytes,surfaceBytes]=await Promise.all([safe(map.terrain.heightmap),safe(map.terrain.surface_map)]);
  return validateDocument({map,heights:decodeExr(heightBytes),surfaces:decodeSurfacePng(surfaceBytes)});
}
/** Deterministic export in memory; publishing a multi-file map is M3's responsibility. */
export function serializeMap(doc: MapDocument): { json: Buffer; exr: Buffer; png: Buffer } {
  validateDocument(doc);
  return {
    json:Buffer.from(JSON.stringify(doc.map,null,2)+'\n','utf8'),
    exr:encodeExr(doc.heights),
    png:encodeSurfacePng(doc.surfaces),
  };
}
