// Resolve map surface bindings through the existing verified project build.
// Source maps only carry asset references; this module consumes baked PBR maps,
// never invokes a material generator or creates an engine-specific asset.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import type {MapDocument} from '../../tools/map-editor/src/core/map.ts';
import type {BuildArtifact,BuildFile} from './build.ts';
import type {SurfaceMaterialTextures} from './map-glb.ts';

const checksum=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');

export async function resolveSceneMaterials(projectDir:string,doc:MapDocument,
  artifacts:readonly BuildArtifact[]):Promise<Map<number,SurfaceMaterialTextures>>{
  const lookup=new Map(artifacts.map(item=>[item.id,item]));
  const result=new Map<number,SurfaceMaterialTextures>();
  for(const [index,definition] of doc.map.terrain.surface_palette.entries()){
    const binding=doc.map.terrain.surface_materials?.[definition];
    if(!binding)continue;
    const assetId=binding.asset.slice('asset:'.length);
    const artifact=lookup.get(assetId);
    if(!artifact||artifact.kind!=='image'||artifact.origin!=='procedural')
      throw Error('Missing built procedural surface material: '+binding.asset);
    const profiles=[...new Set(artifact.files.filter(f=>f.view==='albedo').
      map(f=>f.profile??'default'))];
    const profile=binding.profile??(profiles.length===1?profiles[0]:undefined);
    if(!profile||!profiles.includes(profile))
      throw Error('Map material needs a valid explicit profile: '+definition);
    const channel=async(view:'albedo'|'normal'|'roughness'):Promise<Buffer>=>{
      const selected=artifact.files.filter(f=>f.view===view&&
        (f.profile??'default')===profile);
      if(selected.length!==1)throw Error('Missing or ambiguous '+view+
        ' map for scene surface '+definition);
      const file:BuildFile=selected[0];
      const filename=join(projectDir,'build','assets',assetId,artifact.key,file.file);
      const stat=await lstat(filename);
      if(!stat.isFile()||stat.isSymbolicLink())
        throw Error('Scene material file redirected: '+file.file);
      const bytes=await readFile(filename);
      if(bytes.length!==file.bytes||checksum(bytes)!==file.sha256)
        throw Error('Built scene material was modified: '+assetId+'/'+file.file);
      return bytes;
    };
    result.set(index,{
      assetId,profile,tileSize:binding.tile_size,
      albedo:await channel('albedo'),
      normal:await channel('normal'),
      roughness:await channel('roughness'),
    });
  }
  return result;
}
