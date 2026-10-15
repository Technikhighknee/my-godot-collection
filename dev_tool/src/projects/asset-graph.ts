// Domain rules for shared material assignments and dependency cycles.
// Independent of disk storage, UI and production builds.
import type {AssetEntry,AssetSource,GeneratorLookup} from './asset-source.ts';

export function assertAssetDependencies(source:AssetSource,
  entries:readonly AssetEntry[],lookup:GeneratorLookup):void{
    const byId=new Map(entries.map(x=>[x.source.id,x]));
    const def=lookup(source.generator.id);
    for(const [slot,ref] of Object.entries(source.materials??{})){
      const target=byId.get(ref.slice('asset:'.length));
      const allowed=def?.materialSlots?.find(s=>s.id===slot);
      if(!target||'origin' in target.source||
        !allowed?.generators.includes(target.source.generator.id)||
        target.kind!=='image')
        throw Error('Material '+slot+' requires an existing compatible texture asset');
    }
    const graph=new Map(entries.map(x=>[x.source.id,x.source.dependencies]));
    graph.set(source.id,source.dependencies);
    const seen=new Set<string>(),stack=new Set<string>();
    const visit=(id:string)=>{
      if(stack.has(id))throw Error('Asset dependency cycle');
      if(seen.has(id))return;
      const edges=graph.get(id);
      if(!edges)throw Error('Missing asset dependency: '+id);
      stack.add(id);
      for(const edge of edges)visit(edge.slice('asset:'.length));
      stack.delete(id);seen.add(id);
    };
    for(const id of graph.keys())visit(id);
}
