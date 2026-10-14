// Project sources are authoritative; generated meshes and textures are not.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,rename,rm,lstat,realpath,open} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {encodeExr} from '../../tools/map-editor/src/formats/exr.ts';
import {encodeSurfacePng} from '../../tools/map-editor/src/formats/png.ts';
import {MapWorkspace} from '../../tools/map-editor/src/editing/map-workspace.ts';
import {validateMap} from '../../tools/map-editor/src/core/map.ts';
// Project storage is independent of generator implementations.
export interface GeneratorDescriptor {
  kind:'model'|'image';recipeVersion:number;
  components:readonly {id:string}[];
  defaultOptions?:object;
  validateOptions?:(value:unknown)=>object;
  materialSlots?:readonly {id:string;generators:readonly string[]}[];
}
export type GeneratorLookup=(id:string)=>GeneratorDescriptor|null;
function validateSeed(value:unknown):void{
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>0xffffffff)
    throw Error('Invalid generator seed');
}

const slugPattern=/^[a-z0-9][a-z0-9_-]{0,47}$/;
const assetRef=/^asset:([a-z0-9][a-z0-9_-]{0,47})$/;
const unique=<T>(array:T[])=>new Set(array).size===array.length;
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?
  a.toLowerCase()===b.toLowerCase():a===b;
function slug(value:unknown):string {
  if(typeof value!=='string'||!slugPattern.test(value))throw Error('Invalid resource ID (use lowercase letters, numbers, - or _)');
  return value;
}
function title(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw Error('Name must contain 1–100 characters');
  return value.trim();
}
async function regular(path:string):Promise<Buffer>{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||!samePath(await realpath(path),path))
    throw Error('Project file redirected or replaced');
  return readFile(path);
}
async function directory(path:string):Promise<void>{
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||!samePath(await realpath(path),path))
    throw Error('Project directory redirected or replaced');
}
async function atomic(path:string,bytes:Buffer):Promise<void>{
  const temp=join(dirname(path),'.'+randomUUID()+'.tmp');
  try{
    const handle=await open(temp,'wx',0o644);
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    await rename(temp,path);
  }finally{await rm(temp,{force:true});}
}
export interface ProjectInfo {id:string;name:string;format:'devtool-project';version:1;}
export interface AssetSource {
  format:'devtool-asset';version:1;id:string;name:string;
  generator:{id:string;version:1;masterSeed:number;components:Record<string,number>};
  dependencies:string[];
  options?:object;
  materials?:Record<string,string>;
}
export interface AssetEntry {source:AssetSource;revision:string;kind:'model'|'image';}
export function validateSource(raw:unknown,expectedId?:string,
  lookup:GeneratorLookup=()=>null):AssetSource{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid asset source');
  const x=raw as Record<string,unknown>;
  const validFields=['dependencies','format','generator','id','name','version'];
  if(!validFields.every(k=>Object.hasOwn(x,k))||
    Object.keys(x).some(k=>!validFields.includes(k)&&
      k!=='options'&&k!=='materials')||
    x.format!=='devtool-asset'||x.version!==1)throw Error('Unsupported asset source');
  const id=slug(x.id);
  if(expectedId&&id!==expectedId)throw Error('Asset ID does not match filename');
  const name=title(x.name);
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
        typeof value!=='string'||!assetRef.test(value))
        throw Error('Invalid material reference: '+slot);
      materials[slot]=value;
    }
  }
  const dependencies=x.dependencies;
  if(!Array.isArray(dependencies)||!unique(dependencies)||dependencies.some(v=>
    typeof v!=='string'||!assetRef.test(v)||v==='asset:'+id))
    throw Error('Invalid asset dependencies');
  if(materials&&Object.values(materials).some(ref=>!dependencies.includes(ref)))
    throw Error('Material references must be project dependencies');
  return {format:'devtool-asset',version:1,id,name,
    generator:{id:gen.id,version:gen.version as number,
      masterSeed:gen.masterSeed as number,
      components:comps as Record<string,number>},
    dependencies:dependencies as string[],
    ...(options===undefined?{}:{options}),
    ...(materials===undefined?{}:{materials})};
}
function makeSource(input:unknown,id:string,lookup:GeneratorLookup,
  dependencies:string[]=[],oldMaterials:Record<string,string>={}):AssetSource{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid asset request');
  const x=input as Record<string,unknown>;
  const required=['components','generator','masterSeed','name'];
  if(!required.every(k=>Object.hasOwn(x,k))||
    Object.keys(x).some(k=>!required.includes(k)&&k!=='options'&&k!=='materials'))
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
    ...(newMaterials===undefined?{}:{materials:newMaterials})},id,lookup);
}
function parseProject(data:unknown,id:string):ProjectInfo{
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid project manifest');
  const p=data as Record<string,unknown>;
  if(Object.keys(p).sort().join()!=='format,id,name,version'||p.format!=='devtool-project'||
    p.version!==1||p.id!==id)throw Error('Unsupported project manifest');
  return {format:'devtool-project',version:1,id:slug(p.id),name:title(p.name)};
}
function starterMap(){
  const samples=65,width=128;
  const heights={width:samples,height:samples,data:new Float32Array(samples*samples).fill(.25)};
  const surfaces={width:samples-1,height:samples-1,data:new Uint8Array((samples-1)**2)};
  const map={
    name:'World',terrain:{size:[width,width],heightmap:'assets/world.height.exr',
      surface_map:'assets/world.surface.png',min_height:-10,max_height:30,
      surface_palette:['terrain.grass','terrain.dirt','terrain.rock']},
    roads:[],settlements:[],water:[],buildings:[],objects:[],
  };
  return {heights,surfaces,map};
}
export class ProjectLibrary {
  readonly root:string;
  private activeId:string|null=null;
  private activeManifest:ProjectInfo|null=null;
  private activeWorkspace:MapWorkspace|null=null;
  private definitions?:import('../../tools/map-editor/web/building-placement.mjs').PlacementDefinitions;
  private lookup:GeneratorLookup;
  private queue:Promise<void>=Promise.resolve();
  private constructor(root:string,
    definitions:import('../../tools/map-editor/web/building-placement.mjs').PlacementDefinitions|undefined,
    lookup:GeneratorLookup){
    this.root=root;this.definitions=definitions;this.lookup=lookup;
  }
  static async open(path:string,
    definitions?:import('../../tools/map-editor/web/building-placement.mjs').PlacementDefinitions,
    lookup:GeneratorLookup=()=>null):Promise<ProjectLibrary>{
    const root=resolve(path);
    await mkdir(root,{recursive:true});
    await directory(root);
    const lib=new ProjectLibrary(root,definitions,lookup);
    try{
      const bytes=await regular(join(root,'.active-project.json'));
      const active=JSON.parse(bytes.toString('utf8')) as {id?:string};
      if(active?.id)await lib.select(active.id,false);
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    }
    return lib;
  }
  private enqueue<T>(fn:()=>Promise<T>):Promise<T>{
    const result=this.queue.then(fn);
    this.queue=result.then(()=>{},()=>{});
    return result;
  }
  async list():Promise<ProjectInfo[]>{
    await this.queue;
    const entries=await readdir(this.root,{withFileTypes:true});
    const result:ProjectInfo[]=[];
    for(const entry of entries){
      if(!entry.isDirectory()||!slugPattern.test(entry.name))continue;
      const folder=join(this.root,entry.name);
      await directory(folder);
      const meta=JSON.parse((await regular(join(folder,'project.json'))).toString('utf8'));
      result.push(parseProject(meta,entry.name));
    }
    return result.sort((a,b)=>a.name.localeCompare(b.name));
  }
  active(){return this.activeManifest;}
  mapWorkspace(){return this.activeWorkspace;}
  private async activate(id:string,persist=true):Promise<ProjectInfo>{
    id=slug(id);
    const base=join(this.root,id);
    await directory(base);
    await directory(join(base,'maps'));
    await directory(join(base,'assets'));
    const p=parseProject(JSON.parse((await regular(join(base,'project.json'))).toString('utf8')),id);
    const maps=await readdir(join(base,'maps'));
    const first=maps.filter(v=>slugPattern.test(v.replace(/\.map\.json$/,''))&&v.endsWith('.map.json')).sort()[0];
    const workspace=first?
      await MapWorkspace.open(join(base,'maps',first),this.definitions):null;
    if(persist)await atomic(join(this.root,'.active-project.json'),Buffer.from(JSON.stringify({id})+'\n'));
    this.activeId=id;this.activeManifest=p;this.activeWorkspace=workspace;
    return p;
  }
  async select(id:string,persist=true):Promise<ProjectInfo>{
    return this.enqueue(()=>this.activate(id,persist));
  }
  async create(id:string,name:string):Promise<ProjectInfo>{
    return this.enqueue(async()=>{
      id=slug(id);name=title(name);
      const base=join(this.root,id);
      await mkdir(base); // fails closed when the slug already exists
      try{
        await mkdir(join(base,'maps'));await mkdir(join(base,'maps','assets'));
        await mkdir(join(base,'assets'));
        const data=starterMap();
        await writeFile(join(base,'maps','assets','world.height.exr'),encodeExr(data.heights),{flag:'wx'});
        await writeFile(join(base,'maps','assets','world.surface.png'),encodeSurfacePng(data.surfaces),{flag:'wx'});
        await writeFile(join(base,'maps','world.map.json'),JSON.stringify(data.map,null,2)+'\n',{flag:'wx'});
        const manifest:ProjectInfo={format:'devtool-project',version:1,id,name};
        await writeFile(join(base,'project.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
        await this.activate(id);
        return manifest;
      }catch(e){await rm(base,{recursive:true,force:true});throw e;}
    });
  }
  private requireActive():string{
    if(!this.activeId)throw Error('No active project');
    return join(this.root,this.activeId);
  }
  async assets():Promise<AssetEntry[]>{
    const dir=join(this.requireActive(),'assets');
    await directory(dir);
    const files=await readdir(dir,{withFileTypes:true});
    const result:AssetEntry[]=[];
    for(const entry of files){
      if(!entry.isFile()||!entry.name.endsWith('.asset.json'))continue;
      const id=entry.name.slice(0,-'.asset.json'.length);
      slug(id);
      const bytes=await regular(join(dir,entry.name));
      const source=validateSource(JSON.parse(bytes.toString('utf8')),id,this.lookup);
      result.push({source,revision:hash(bytes),kind:this.lookup(source.generator.id)!.kind});
    }
    return result.sort((a,b)=>a.source.name.localeCompare(b.source.name));
  }
  async asset(id:string):Promise<AssetEntry>{
    const target=join(this.requireActive(),'assets',slug(id)+'.asset.json');
    const bytes=await regular(target);
    const source=validateSource(JSON.parse(bytes.toString('utf8')),id,this.lookup);
    return {source,revision:hash(bytes),kind:this.lookup(source.generator.id)!.kind};
  }
  private async checkDependencies(source:AssetSource):Promise<void>{
    const entries=await this.assets();
    const byId=new Map(entries.map(x=>[x.source.id,x]));
    const def=this.lookup(source.generator.id);
    for(const [slot,ref] of Object.entries(source.materials??{})){
      const target=byId.get(ref.slice('asset:'.length));
      const allowed=def?.materialSlots?.find(s=>s.id===slot);
      if(!target||!allowed?.generators.includes(target.source.generator.id)||
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
  async createAsset(id:string,input:unknown):Promise<AssetEntry>{
    return this.enqueue(async()=>{
      id=slug(id);
      const source=makeSource(input,id,this.lookup);
      await this.checkDependencies(source);
      const target=join(this.requireActive(),'assets',id+'.asset.json');
      const bytes=Buffer.from(JSON.stringify(source,null,2)+'\n');
      await writeFile(target,bytes,{flag:'wx'});
      return {source,revision:hash(bytes),kind:this.lookup(source.generator.id)!.kind};
    });
  }
  async updateAsset(id:string,input:unknown,revision:string):Promise<AssetEntry>{
    return this.enqueue(async()=>{
      id=slug(id);
      const old=await this.asset(id);
      if(old.revision!==revision)throw Error('Asset was modified; reload before saving');
      const source=makeSource(input,id,this.lookup,old.source.dependencies,
        old.source.materials);
      if(source.generator.id!==old.source.generator.id)
        throw Error('Cannot change generator of an existing asset; save a new asset');
      await this.checkDependencies(source);
      const target=join(this.requireActive(),'assets',id+'.asset.json');
      const bytes=Buffer.from(JSON.stringify(source,null,2)+'\n');
      if(hash(await regular(target))!==revision)throw Error('Asset changed on disk');
      await atomic(target,bytes);
      return {source,revision:hash(bytes),kind:this.lookup(source.generator.id)!.kind};
    });
  }
  async graph(){
    const project=this.requireActive();
    const assets=await this.assets();
    const known=new Set(assets.map(a=>a.source.id));
    const edges:{from:string;to:string}[]=[];
    const missing=new Set<string>();
    for(const a of assets)
      for(const ref of a.source.dependencies){
        edges.push({from:'asset:'+a.source.id,to:ref});
        if(!known.has(ref.slice('asset:'.length)))missing.add(ref);
      }
    const folder=join(project,'maps');
    for(const file of (await readdir(folder)).filter(x=>x.endsWith('.map.json'))){
      const id=file.slice(0,-'.map.json'.length);
      if(!slugPattern.test(id))continue;
      const map=validateMap(JSON.parse(
        (await regular(join(folder,file))).toString('utf8')));
      for(const item of [...map.buildings,...map.objects]){
        const found=assetRef.exec(item.definition);
        if(found){
          edges.push({from:'map:'+id,to:item.definition});
          if(!known.has(found[1]))missing.add(item.definition);
        }
      }
    }
    return {edges,missing:[...missing].sort()};
  }
}
