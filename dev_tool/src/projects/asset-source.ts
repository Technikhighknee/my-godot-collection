// Pure project asset source contracts. No filesystem, UI or rendering ownership.
import {assertGeneratorArtstyleSupport}
  from '../../tools/asset-procgen/web/artstyles/production-artstyles.mjs';
import type {ProductionArtstyleReference}
  from '../../tools/asset-procgen/web/artstyles/production-artstyles.mjs';
// Existing v1 procedural and v2 imported documents retain their exact formats.
export interface GeneratorDescriptor {
  kind:'model'|'image';recipeVersion:number;
  components:readonly {id:string}[];
  defaultOptions?:object;
  validateOptions?:(value:unknown)=>object;
  materialSlots?:readonly {id:string;generators:readonly string[]}[];
  productionStyleGeneration?:{styles:readonly ProductionArtstyleReference[]};
}
export type GeneratorLookup=(id:string)=>GeneratorDescriptor|null;
function validateSeed(value:unknown):void{
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>0xffffffff)
    throw Error('Invalid generator seed');
}

export const RESOURCE_ID_PATTERN=/^[a-z0-9][a-z0-9_-]{0,47}$/;
export const ASSET_REFERENCE_PATTERN=/^asset:([a-z0-9][a-z0-9_-]{0,47})$/;
const unique=<T>(array:T[])=>new Set(array).size===array.length;

export function resourceId(value:unknown):string {
  if(typeof value!=='string'||!RESOURCE_ID_PATTERN.test(value))throw Error('Invalid resource ID (use lowercase letters, numbers, - or _)');
  return value;
}
export function resourceName(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw Error('Name must contain 1–100 characters');
  return value.trim();
}

export interface AssetSource {
  format:'devtool-asset';version:1;id:string;name:string;
  generator:{id:string;version:number;masterSeed:number;components:Record<string,number>};
  dependencies:string[];
  options?:object;
  materials?:Record<string,string>;
  artstyle?:ProductionArtstyleReference;
}
// Imported files are project resources, not pseudo-generators. Format v2
// distinguishes their source contract without rewriting legacy v1 recipes.
export type ImportFormat='glb'|'png';
export interface ImportedAssetSource {
  format:'devtool-asset';version:2;id:string;name:string;origin:'imported';
  kind:'model'|'image';
  imported:{format:ImportFormat;path:string;sha256:string;byteLength:number};
  // Absent in imported sources: these capabilities require a real generator.
  generator?:never;options?:never;materials?:never;
  dependencies:string[];
}
export type ProjectAssetSource=AssetSource|ImportedAssetSource;
export type AssetEntry={source:ProjectAssetSource;revision:string;kind:'model'|'image'};
export const MAX_IMPORTED_ASSET_BYTES=32*1024*1024;
const hexHash=/^[0-9a-f]{64}$/;
export function importedAssetKind(format:ImportFormat):'model'|'image'{
  return format==='glb'?'model':'image';
}
export function validateImportedSource(raw:unknown,expectedId?:string):ImportedAssetSource{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('Invalid imported resource');
  const x=raw as Record<string,unknown>;
  if(Object.keys(x).sort().join()!=='dependencies,format,id,imported,kind,name,origin,version'||
    x.format!=='devtool-asset'||x.version!==2||x.origin!=='imported')
    throw Error('Unsupported imported resource format');
  const id=resourceId(x.id),name=resourceName(x.name);
  if(expectedId&&id!==expectedId)throw Error('Asset ID does not match filename');
  const imp=x.imported;
  if(!imp||typeof imp!=='object'||Array.isArray(imp))
    throw Error('Invalid imported file descriptor');
  const file=imp as Record<string,unknown>;
  if(Object.keys(file).sort().join()!=='byteLength,format,path,sha256')
    throw Error('Invalid imported file descriptor');
  if(file.format!=='glb'&&file.format!=='png')
    throw Error('Unsupported import format');
  const format=file.format as ImportFormat;
  const kind=importedAssetKind(format);
  if(x.kind!==kind||file.path!=='imports/'+id+'.'+format||
    typeof file.sha256!=='string'||!hexHash.test(file.sha256)||
    typeof file.byteLength!=='number'||!Number.isSafeInteger(file.byteLength)||
    file.byteLength<24||file.byteLength>MAX_IMPORTED_ASSET_BYTES)
    throw Error('Invalid imported file metadata');
  const dependencies=x.dependencies;
  if(!Array.isArray(dependencies)||!unique(dependencies)||
    dependencies.some(v=>typeof v!=='string'||!ASSET_REFERENCE_PATTERN.test(v)||
      v==='asset:'+id))
    throw Error('Invalid asset dependencies');
  return {format:'devtool-asset',version:2,id,name,origin:'imported',kind,
    imported:{format,path:file.path,sha256:file.sha256,byteLength:file.byteLength},
    dependencies:dependencies as string[]};
}
export function validateProjectSource(raw:unknown,id:string,
  lookup:GeneratorLookup):ProjectAssetSource{
  if(raw&&typeof raw==='object'&&'origin' in raw)
    return validateImportedSource(raw,id);
  return validateSource(raw,id,lookup);
}
export const projectAssetKind=(source:ProjectAssetSource,lookup:GeneratorLookup)=>
  'origin' in source?source.kind:lookup(source.generator.id)!.kind;

export function validateSource(raw:unknown,expectedId?:string,
  lookup:GeneratorLookup=()=>null):AssetSource{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid asset source');
  const x=raw as Record<string,unknown>;
  const validFields=['dependencies','format','generator','id','name','version'];
  if(!validFields.every(k=>Object.hasOwn(x,k))||
    Object.keys(x).some(k=>!validFields.includes(k)&&
      k!=='options'&&k!=='materials'&&k!=='artstyle')||
    x.format!=='devtool-asset'||x.version!==1)throw Error('Unsupported asset source');
  const id=resourceId(x.id);
  if(expectedId&&id!==expectedId)throw Error('Asset ID does not match filename');
  const name=resourceName(x.name);
  const g=x.generator;
  if(!g||typeof g!=='object'||Array.isArray(g))throw Error('Invalid generator');
  const gen=g as Record<string,unknown>;
  if(Object.keys(gen).sort().join()!=='components,id,masterSeed,version'||
    !Number.isSafeInteger(gen.version)||typeof gen.id!=='string')
    throw Error('Unsupported generator recipe');
  const def=lookup(gen.id);
  if(!def)throw Error('Unknown generator: '+gen.id);
  // A saved recipe cannot silently switch to a different algorithm version.
  // The legacy project format remains version 1; an incompatible generator
  // must be explicitly migrated instead of mutating a stored asset's meaning.
  if(gen.version!==def.recipeVersion)
    throw Error('Unsupported generator version for '+gen.id+
      ': saved '+gen.version+', available '+def.recipeVersion);
  if(typeof gen.masterSeed!=='number')throw Error('Invalid master seed');
  validateSeed(gen.masterSeed);
  const comps=gen.components;
  if(!comps||typeof comps!=='object'||Array.isArray(comps))throw Error('Invalid component seeds');
  const keys=Object.keys(comps);
  if(!unique(keys)||keys.slice().sort().join()!==def.components.map((c:{id:string})=>c.id).sort().join())
    throw Error('Generator component mismatch');
  for(const value of Object.values(comps))validateSeed(value);
  if(x.options!==undefined&&!def.validateOptions)
    throw Error('Generator does not support options');
  const options=def.validateOptions?
    def.validateOptions(x.options??def.defaultOptions):undefined;
  let materials:Record<string,string>|undefined;
  if(x.materials!==undefined){
    if(!def.materialSlots||!x.materials||typeof x.materials!=='object'||
      Array.isArray(x.materials))throw Error('Generator has no material slots');
    const rawMaterials=x.materials as Record<string,unknown>;
    materials={};
    for(const [slot,value] of Object.entries(rawMaterials)){
      if(!def.materialSlots.some(entry=>entry.id===slot)||
        typeof value!=='string'||!ASSET_REFERENCE_PATTERN.test(value))
        throw Error('Invalid material reference: '+slot);
      materials[slot]=value;
    }
  }
  const artstyle=x.artstyle===undefined?undefined:
    assertGeneratorArtstyleSupport(def,x.artstyle);
  const dependencies=x.dependencies;
  if(!Array.isArray(dependencies)||!unique(dependencies)||dependencies.some(v=>
    typeof v!=='string'||!ASSET_REFERENCE_PATTERN.test(v)||v==='asset:'+id))
    throw Error('Invalid asset dependencies');
  if(materials&&Object.values(materials).some(ref=>!dependencies.includes(ref)))
    throw Error('Material references must be project dependencies');
  return {format:'devtool-asset',version:1,id,name,
    generator:{id:gen.id,version:gen.version as number,
      masterSeed:gen.masterSeed as number,
      components:comps as Record<string,number>},
    dependencies:dependencies as string[],
    ...(options===undefined?{}:{options}),
    ...(materials===undefined?{}:{materials}),
    ...(artstyle===undefined?{}:{artstyle})};
}
export function createProceduralSource(input:unknown,id:string,lookup:GeneratorLookup,
  dependencies:string[]=[],oldMaterials:Record<string,string>={}):AssetSource{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid asset request');
  const x=input as Record<string,unknown>;
  const required=['components','generator','masterSeed','name'];
  if(!required.every(k=>Object.hasOwn(x,k))||
    Object.keys(x).some(k=>!required.includes(k)&&k!=='options'&&
      k!=='materials'&&k!=='artstyle'))
    throw Error('Invalid asset fields');
  const newMaterials=x.materials;
  if(newMaterials!==undefined&&(!newMaterials||typeof newMaterials!=='object'||
    Array.isArray(newMaterials)))throw Error('Invalid materials');
  const refs=Object.values(newMaterials??{}) as unknown[];
  const nextDeps=[...new Set([
    ...dependencies.filter(ref=>!Object.values(oldMaterials).includes(ref)),
    ...refs.filter((ref):ref is string=>typeof ref==='string'),
  ])];
  const def=typeof x.generator==='string'?lookup(x.generator):null;
  if(!def)throw Error('Unknown generator: '+String(x.generator));
  return validateSource({format:'devtool-asset',version:1,id,name:x.name,
    generator:{id:x.generator,version:def.recipeVersion,
      masterSeed:x.masterSeed,components:x.components},
    dependencies:nextDeps,
    ...(x.options===undefined?{}:{options:x.options}),
    ...(newMaterials===undefined?{}:{materials:newMaterials}),
    ...(x.artstyle===undefined?{}:{artstyle:x.artstyle})},id,lookup);
}
