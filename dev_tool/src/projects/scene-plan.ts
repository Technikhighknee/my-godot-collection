// Scene placement planning uses the existing map and asset source contracts.
// It does not bake meshes, inspect Godot resources or decide UI behavior.
import {validateDocument,heightAt} from '../../tools/map-editor/src/core/map.ts';
import type {MapDocument} from '../../tools/map-editor/src/core/map.ts';
import type {AssetEntry} from './asset-source.ts';
import {ASSET_REFERENCE_PATTERN,resourceId} from './asset-source.ts';

export interface ScenePlacement {
  id:string;kind:'building'|'object';definition:string;
  source:'project-asset'|'game-definition';
  assetId?:string;
  position:[number,number,number];
  rotationDegrees:number;
}
export interface ScenePlan {
  mapId:string;assetRoots:string[];materialRoots:string[];placements:ScenePlacement[];
}
export function planMapScene(mapId:string,doc:MapDocument,
  entries:readonly AssetEntry[]):ScenePlan{
  resourceId(mapId);
  validateDocument(doc);
  const known=new Map(entries.map(entry=>[entry.source.id,entry]));
  const roots=new Set<string>(),materialRoots=new Set<string>();
  for(const [surface,binding] of Object.entries(doc.map.terrain.surface_materials??{})){
    const id=binding.asset.slice('asset:'.length);
    const target=known.get(id);
    if(!target)throw Error('Missing map material dependency: '+binding.asset+
      ' for '+surface+' in '+mapId);
    if(target.kind!=='image'||'origin' in target.source)
      throw Error('Map surface requires a procedural material image: '+binding.asset);
    materialRoots.add(id);
  }
  const placements:ScenePlacement[]=[];
  for(const [kind,list] of [
    ['building',doc.map.buildings],['object',doc.map.objects],
  ] as const){
    for(const entry of list){
      const match=ASSET_REFERENCE_PATTERN.exec(entry.definition);
      if(entry.definition.startsWith('asset:')&&!match)
        throw Error('Invalid scene asset reference: '+entry.definition);
      const assetId=match?.[1];
      if(assetId){
        const asset=known.get(assetId);
        if(!asset)throw Error('Missing scene asset dependency: asset:'+assetId+
          ' in map '+mapId+' / '+entry.id);
        if(asset.kind!=='model')
          throw Error('Scene placement requires a model asset: asset:'+assetId);
        roots.add(assetId);
      }
      placements.push({
        id:entry.id,kind,definition:entry.definition,
        source:assetId?'project-asset':'game-definition',
        ...(assetId?{assetId}:{}),
        position:[entry.position[0],heightAt(doc,...entry.position),
          entry.position[1]],rotationDegrees:entry.rotation,
      });
    }
  }
  // Map validators already enforce unique IDs across all map layers.
  // Sort instances independently from document order for stable manifests.
  placements.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {mapId,assetRoots:[...roots].sort(),materialRoots:[...materialRoots].sort(),placements};
}
