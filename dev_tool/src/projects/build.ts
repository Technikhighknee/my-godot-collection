// Headless asset production. Build plans resolve dependencies first and
// individual resource artifacts are published atomically to a derived folder.
// Preview and bake invoke the same registered generator implementation.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {findGenerator,generateAsset} from '../../tools/asset-procgen/web/generators.mjs';
import {capturePaintedPixels,encodeRgbaPng} from './build-image.ts';
import type {BuildNode,BuildPlan} from './build-plan.ts';
import type {AssetEntry,ImportedAssetSource} from './library.ts';

export interface BuildFile {
  file:string;sha256:string;bytes:number;
  view?:string;profile?:string;width?:number;height?:number;
}
export interface BuildArtifact {
  format:'devtool-baked-asset';version:1;id:string;key:string;
  kind:'model'|'image';origin:'imported'|'procedural';
  files:BuildFile[];dependencies:{id:string;key:string}[];
}
export interface BuildResult {
  planKey:string;artifacts:BuildArtifact[];built:number;reused:number;
}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fileName=/^[a-z0-9][a-z0-9_-]*(?:--[a-z][a-z0-9_-]*)?\.(?:png|glb)$/;
async function regular(path:string):Promise<Buffer>{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
    throw Error('Build output path is not a regular file');
  return readFile(path);
}
async function existingArtifact(folder:string,node:BuildNode):Promise<BuildArtifact|null>{
  try{
    const info=await lstat(folder);
    if(!info.isDirectory()||info.isSymbolicLink())
      throw Error('Invalid built asset directory');
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw error;
  }
  const raw=JSON.parse((await regular(join(folder,'manifest.json'))).toString('utf8')) as BuildArtifact;
  if(raw.format!=='devtool-baked-asset'||raw.version!==1||
    raw.id!==node.id||raw.key!==node.key||raw.kind!==node.kind||
    raw.origin!==node.origin||!Array.isArray(raw.files)||!raw.files.length)
    throw Error('Built asset manifest is inconsistent: '+node.id);
  for(const file of raw.files){
    if(!fileName.test(file.file)||!Number.isSafeInteger(file.bytes)||
      typeof file.sha256!=='string'||!/^[0-9a-f]{64}$/.test(file.sha256))
      throw Error('Unsafe built asset manifest: '+node.id);
    const content=await regular(join(folder,file.file));
    if(content.length!==file.bytes||digest(content)!==file.sha256)
      throw Error('Built asset file changed: '+node.id+'/'+file.file);
  }
  return raw;
}
function safeName(name:string):void{
  if(!/^[a-z][a-z0-9_-]*$/.test(name))
    throw Error('Invalid generator output channel or profile: '+name);
}
async function produce(node:BuildNode,entry:AssetEntry,
  imported:(id:string)=>Promise<{bytes:Buffer;source:ImportedAssetSource}>):
  Promise<{meta:BuildFile;data:Buffer}[]>{
  if('origin' in entry.source){
    const {bytes}=await imported(node.id);
    const file=node.id+'.'+entry.source.imported.format;
    return [{meta:{file,sha256:digest(bytes),bytes:bytes.length},data:bytes}];
  }
  const source=entry.source,def=findGenerator(source.generator.id);
  if(!def||def.recipeVersion!==source.generator.version)
    throw Error('Unsupported generator version: '+source.generator.id);
  if(def.kind!=='image'||!def.headlessBake)
    throw Error('No headless bake capability for '+source.generator.id);
  // Important: use exactly the same registry/generate function as the editor.
  const image=generateAsset(def,source.generator.components);
  const views=image.views??['albedo'];
  const profiles=image.profiles?.length?image.profiles:[null];
  const result:{meta:BuildFile;data:Buffer}[]=[];
  for(const profile of profiles)for(const view of views){
    safeName(view);if(profile)safeName(profile);
    const pixels=capturePaintedPixels(image,view,profile??undefined);
    const bytes=encodeRgbaPng(pixels.width,pixels.height,pixels.rgba);
    const file=profile?profile+'--'+view+'.png':view+'.png';
    result.push({meta:{file,sha256:digest(bytes),bytes:bytes.length,
      view,...(profile?{profile}:{}),
      width:pixels.width,height:pixels.height},data:bytes});
  }
  return result;
}
export async function produceBuild(projectDir:string,plan:BuildPlan,
  entries:readonly AssetEntry[],
  imported:(id:string)=>Promise<{bytes:Buffer;source:ImportedAssetSource}>,
  currentRevision:(id:string)=>Promise<string>):Promise<BuildResult>{
  const lookup=new Map(entries.map(entry=>[entry.source.id,entry]));
  const buildRoot=join(projectDir,'build','assets');
  await mkdir(buildRoot,{recursive:true});
  let built=0,reused=0;
  const artifacts:BuildArtifact[]=[];
  const keys=new Map(plan.nodes.map(node=>[node.id,node.key]));
  for(const node of plan.nodes){
    const entry=lookup.get(node.id);
    if(!entry||entry.revision!==node.sourceRevision)
      throw Error('Asset source changed before build: '+node.id);
    if(await currentRevision(node.id)!==node.sourceRevision)
      throw Error('Asset source changed during build: '+node.id);
    const parent=join(buildRoot,node.id);
    await mkdir(parent,{recursive:true});
    const destination=join(parent,node.key);
    // Source payload integrity is checked even on a cache hit. A valid
    // cached copy must never conceal a damaged imported project file.
    if(node.origin==='imported')await imported(node.id);
    const cached=await existingArtifact(destination,node);
    if(cached){artifacts.push(cached);reused++;continue;}
    const parts=await produce(node,entry,imported);
    const dependencies=node.dependencies.map(id=>({id,key:keys.get(id)!}));
    const manifest:BuildArtifact={format:'devtool-baked-asset',version:1,
      id:node.id,key:node.key,kind:node.kind,origin:node.origin,
      files:parts.map(p=>p.meta),dependencies};
    const temp=join(parent,'.pending-'+randomUUID());
    await mkdir(temp,{recursive:false});
    try{
      for(const part of parts)await writeFile(join(temp,part.meta.file),part.data,{flag:'wx'});
      await writeFile(join(temp,'manifest.json'),
        JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
      if(await currentRevision(node.id)!==node.sourceRevision)
        throw Error('Asset source changed during build: '+node.id);
      await rename(temp,destination);
    }finally{await rm(temp,{recursive:true,force:true});}
    artifacts.push(manifest);built++;
  }
  return {planKey:plan.key,artifacts,built,reused};
}
