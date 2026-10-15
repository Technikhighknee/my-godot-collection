// Portable, engine-independent scene bundle publisher.
// Uses only prebuilt verified assets and the validated Map System document.
// Target-engine adapters may consume this bundle without rerunning generators.
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {BuildResult} from './build.ts';
import type {ScenePlan,ScenePlacement} from './scene-plan.ts';
import type {MapDocument} from '../../tools/map-editor/src/core/map.ts';
import {bakeMapBinaries} from './map-glb.ts';
import {validateSceneContract} from './scene-contract.ts';

export interface SceneBundleFile {path:string;bytes:number;sha256:string}
export interface SceneBundleResource {
  id:string;kind:'model'|'image';key:string;files:string[];
}
export interface SceneBundlePlacement extends ScenePlacement {
  modelFile?:string;
}
export interface SceneBundleManifest {
  format:'devtool-scene-bundle';version:1;
  mapId:string;key:string;assetPlanKey:string|null;
  mapFile:string;
  terrain:{heightmap:string;surfaceMap:string};
  geometry:{terrain:string;roads?:string;water?:string};
  resources:SceneBundleResource[];
  placements:SceneBundlePlacement[];
  files:SceneBundleFile[];
}
export interface SceneBundleResult {
  directory:string;published:boolean;manifest:SceneBundleManifest;
  built:number;reused:number;
}

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const validFile=/^[a-z0-9][a-z0-9_-]*(?:--[a-z][a-z0-9_-]*)?\.(?:glb|png)$/;
const validId=/^[a-z0-9][a-z0-9_-]{0,47}$/;
function validRelative(path:string):boolean{
  return path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'&&
    !part.includes('\\')&&!part.includes(':'))&&!path.startsWith('/');
}
async function safeDirectory(path:string){
  try{await mkdir(path);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  }
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error('Scene bundle directory redirected: '+path);
}
async function regular(path:string){
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
    throw Error('Scene bundle file redirected: '+path);
  return readFile(path);
}
export async function readSceneBundle(path:string):Promise<SceneBundleManifest|null>{
  try{
    const info=await lstat(path);
    if(!info.isDirectory()||info.isSymbolicLink())
      throw Error('Invalid existing scene bundle directory');
  }catch(e){
    if((e as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw e;
  }
  const manifest=JSON.parse((await regular(join(path,'manifest.json'))).toString('utf8')) as SceneBundleManifest;
  if(manifest.format!=='devtool-scene-bundle'||manifest.version!==1||
    !validId.test(manifest.mapId)||!/^[a-f0-9]{64}$/.test(manifest.key)||
    !Array.isArray(manifest.files))
    throw Error('Invalid scene bundle manifest');
  validateSceneContract(manifest);
  const declared=new Set(['manifest.json']);
  for(const entry of manifest.files){
    if(!validRelative(entry.path)||declared.has(entry.path)||
      !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
      !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw Error('Unsafe scene bundle manifest');
    declared.add(entry.path);
    const bytes=await regular(join(path,...entry.path.split('/')));
    if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)
      throw Error('Scene bundle content was modified: '+entry.path);
  }
  const actual=new Set<string>();
  async function walk(dir:string,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const rel=prefix+entry.name;
      if(entry.isSymbolicLink())throw Error('Scene bundle symlink is not allowed: '+rel);
      if(entry.isDirectory())await walk(join(dir,entry.name),rel+'/');
      else if(entry.isFile())actual.add(rel);
      else throw Error('Unexpected scene bundle file type: '+rel);
    }
  }
  await walk(path);
  if(declared.size!==actual.size||[...actual].some(file=>!declared.has(file)))
    throw Error('Unmanaged files in scene bundle');
  return manifest;
}
function modelFile(id:string,files:readonly {file:string}[]):string {
  const models=files.map(x=>x.file).filter(file=>file.endsWith('.glb'));
  if(!models.length)throw Error('Scene model has no GLB output: '+id);
  const selected=models.includes('level-1-exterior.glb')?'level-1-exterior.glb':
    models.includes('model.glb')?'model.glb':
    models.length===1?models[0]:null;
  if(!selected)throw Error('Ambiguous model variants for scene asset: '+id);
  return 'assets/'+id+'/'+selected;
}
export async function publishSceneBundle(projectDir:string,plan:ScenePlan,
  map:{json:Buffer;exr:Buffer;png:Buffer},
  heightmap:string,surfaceMap:string,
  build:BuildResult|null,doc:MapDocument):Promise<SceneBundleResult>{
  if(!validId.test(plan.mapId)||!validRelative(heightmap)||
    !validRelative(surfaceMap)||heightmap===surfaceMap)
    throw Error('Invalid scene map paths');
  const artifacts=build?.artifacts??[];
  const byId=new Map(artifacts.map(artifact=>[artifact.id,artifact]));
  const rootModels=new Map<string,string>();
  for(const id of plan.assetRoots){
    const artifact=byId.get(id);
    if(!artifact||artifact.kind!=='model')
      throw Error('Missing built scene model: '+id);
    rootModels.set(id,modelFile(id,artifact.files));
  }
  const placements=plan.placements.map(placement=>({
    ...placement,
    ...(placement.assetId?{modelFile:rootModels.get(placement.assetId)!}:{}),
  }));
  const files:SceneBundleFile[]=[];
  const input=new Map<string,Buffer>();
  function add(path:string,bytes:Buffer){
    if(!validRelative(path)||input.has(path)||bytes.length<1)
      throw Error('Invalid or duplicate scene bundle path: '+path);
    input.set(path,bytes);
    files.push({path,bytes:bytes.length,sha256:digest(bytes)});
  }
  const mapFile='maps/'+plan.mapId+'.map.json';
  add(mapFile,map.json);
  add('maps/'+heightmap,map.exr);
  add('maps/'+surfaceMap,map.png);
  const baked=bakeMapBinaries(doc);
  const geometry:SceneBundleManifest['geometry']={terrain:'geometry/terrain.glb'};
  add(geometry.terrain,baked.terrain);
  if(baked.roads){geometry.roads='geometry/roads.glb';add(geometry.roads,baked.roads);}
  if(baked.water){geometry.water='geometry/water.glb';add(geometry.water,baked.water);}
  const buildRoot=join(projectDir,'build','assets');
  const resources:SceneBundleResource[]=[];
  for(const artifact of artifacts){
    const paths:string[]=[];
    for(const file of artifact.files){
      if(!validId.test(artifact.id)||!validFile.test(file.file))
        throw Error('Unsafe asset file in scene bundle');
      const bytes=await regular(join(buildRoot,artifact.id,
        artifact.key,file.file));
      if(digest(bytes)!==file.sha256||bytes.length!==file.bytes)
        throw Error('Cached asset changed before scene publication: '+artifact.id);
      const path='assets/'+artifact.id+'/'+file.file;
      add(path,bytes);
      paths.push(path);
    }
    resources.push({id:artifact.id,kind:artifact.kind,key:artifact.key,files:paths});
  }
  // Canonical map payloads and *transitive* asset keys determine the scene.
  // Unrelated project assets must never invalidate this scene.
  const key=digest(Buffer.from(JSON.stringify({schema:2,mapId:plan.mapId,
    files:files.filter(file=>file.path.startsWith('maps/')||
      file.path.startsWith('geometry/')).map(({path,sha256})=>({path,sha256})),
    assets:resources.map(({id,key})=>({id,key}))})));
  const manifest:SceneBundleManifest={
    format:'devtool-scene-bundle',version:1,mapId:plan.mapId,key,
    assetPlanKey:build?.planKey??null,mapFile,
    terrain:{heightmap:'maps/'+heightmap,surfaceMap:'maps/'+surfaceMap},
    geometry,resources,placements,files,
  };
  validateSceneContract(manifest);
  const buildDir=join(projectDir,'build');
  await safeDirectory(buildDir);
  const scenes=join(buildDir,'scenes');await safeDirectory(scenes);
  const mapRoot=join(scenes,plan.mapId);await safeDirectory(mapRoot);
  const destination=join(mapRoot,key);
  const cached=await readSceneBundle(destination);
  if(cached){
    if(JSON.stringify(cached)!==JSON.stringify(manifest))
      throw Error('Existing scene bundle conflicts with new manifest');
    return {directory:destination,published:false,manifest,
      built:build?.built??0,reused:build?.reused??0};
  }
  const staged=join(mapRoot,'.pending-'+randomUUID());
  await mkdir(staged);
  let published=false;
  try{
    for(const [path,bytes] of input){
      const target=join(staged,...path.split('/'));
      await mkdir(dirname(target),{recursive:true});
      await writeFile(target,bytes,{flag:'wx'});
    }
    await writeFile(join(staged,'manifest.json'),
      JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    await rename(staged,destination);
    published=true;
    return {directory:destination,published:true,manifest,
      built:build?.built??0,reused:build?.reused??0};
  }finally{if(!published)await rm(staged,{recursive:true,force:true});}
}
