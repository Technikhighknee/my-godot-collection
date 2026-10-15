// ProjectLibrary coordinates durable storage and production workflows.
// Asset schemas, binary validation and dependency rules have independent owners.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,rename,rm,lstat,realpath,open} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {encodeExr} from '../../tools/map-editor/src/formats/exr.ts';
import {encodeSurfacePng} from '../../tools/map-editor/src/formats/png.ts';
import {MapWorkspace} from '../../tools/map-editor/src/editing/map-workspace.ts';
import {validateMap} from '../../tools/map-editor/src/core/map.ts';
import {loadMap,serializeMap} from '../../tools/map-editor/src/io/map-io.ts';
import {planMapScene} from './scene-plan.ts';
import {publishSceneBundle,readSceneBundle} from './scene-bundle.ts';
import {publishGodotScene} from './godot-scene.ts';
import {planAssetBuild} from './build-plan.ts';
import {produceBuild} from './build.ts';
import {publishGodotPackage} from './godot-package.ts';
import {syncGodotPackage,validateGodotProject} from './godot-sync.ts';
import {assertAssetDependencies} from './asset-graph.ts';
import {emptyProjectArtDirection,validateProjectArtDirection,
  applyProjectArtDirection} from '../../tools/asset-procgen/web/artstyles/project-art-direction.mjs';
import type {ProjectArtDirection}
  from '../../tools/asset-procgen/web/artstyles/project-art-direction.mjs';
import {validateImportBytes} from './import-validation.ts';
import {
  RESOURCE_ID_PATTERN,ASSET_REFERENCE_PATTERN,resourceId,resourceName,
  validateProjectSource,validateImportedSource,importedAssetKind,
  projectAssetKind,createProceduralSource,
} from './asset-source.ts';
import type {
  AssetSource,AssetEntry,GeneratorLookup,ImportedAssetSource,ImportFormat,
} from './asset-source.ts';
// Preserve existing consumer import paths while the owning modules are explicit.
export type {
  GeneratorDescriptor,GeneratorLookup,AssetSource,ImportedAssetSource,
  ImportFormat,ProjectAssetSource,AssetEntry,
} from './asset-source.ts';
export {validateSource,validateImportedSource,validateProjectSource} from './asset-source.ts';

const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?
  a.toLowerCase()===b.toLowerCase():a===b;
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
function parseProject(data:unknown,id:string):ProjectInfo{
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid project manifest');
  const p=data as Record<string,unknown>;
  if(Object.keys(p).sort().join()!=='format,id,name,version'||p.format!=='devtool-project'||
    p.version!==1||p.id!==id)throw Error('Unsupported project manifest');
  return {format:'devtool-project',version:1,id:resourceId(p.id),name:resourceName(p.name)};
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
      if(!entry.isDirectory()||!RESOURCE_ID_PATTERN.test(entry.name))continue;
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
    id=resourceId(id);
    const base=join(this.root,id);
    await directory(base);
    await directory(join(base,'maps'));
    await directory(join(base,'assets'));
    const p=parseProject(JSON.parse((await regular(join(base,'project.json'))).toString('utf8')),id);
    const maps=await readdir(join(base,'maps'));
    const first=maps.filter(v=>RESOURCE_ID_PATTERN.test(v.replace(/\.map\.json$/,''))&&v.endsWith('.map.json')).sort()[0];
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
      id=resourceId(id);name=resourceName(name);
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
  async artDirection():Promise<{source:ProjectArtDirection;revision:string|null}>{
    const file=join(this.requireActive(),'art-direction.json');
    try{
      const bytes=await regular(file);
      return {source:validateProjectArtDirection(
        JSON.parse(bytes.toString('utf8')),this.lookup),revision:hash(bytes)};
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      return {source:emptyProjectArtDirection(),revision:null};
    }
  }
  async updateArtDirection(raw:unknown,revision:string|null){
    return this.enqueue(async()=>{
      if(revision!==null&&
        (typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision)))
        throw Error('Invalid art direction revision');
      const source=validateProjectArtDirection(raw,this.lookup);
      const existing=await this.artDirection();
      if(existing.revision!==revision)
        throw Error('Art direction was modified; reload before saving');
      const bytes=Buffer.from(JSON.stringify(source,null,2)+'\n');
      const target=join(this.requireActive(),'art-direction.json');
      if(revision===null)await writeFile(target,bytes,{flag:'wx'});
      else{
        if(hash(await regular(target))!==revision)
          throw Error('Art direction changed on disk');
        await atomic(target,bytes);
      }
      return {source,revision:hash(bytes)};
    });
  }
  private async effectiveAssets():Promise<AssetEntry[]>{
    const [entries,{source}]=await Promise.all([this.assets(),this.artDirection()]);
    return applyProjectArtDirection(entries,source,this.lookup);
  }
  async assets():Promise<AssetEntry[]>{
    const dir=join(this.requireActive(),'assets');
    await directory(dir);
    const files=await readdir(dir,{withFileTypes:true});
    const result:AssetEntry[]=[];
    for(const entry of files){
      if(!entry.isFile()||!entry.name.endsWith('.asset.json'))continue;
      const id=entry.name.slice(0,-'.asset.json'.length);
      resourceId(id);
      const bytes=await regular(join(dir,entry.name));
      const source=validateProjectSource(JSON.parse(bytes.toString('utf8')),id,this.lookup);
      result.push({source,revision:hash(bytes),kind:projectAssetKind(source,this.lookup)});
    }
    return result.sort((a,b)=>a.source.name.localeCompare(b.source.name));
  }
  async asset(id:string):Promise<AssetEntry>{
    const target=join(this.requireActive(),'assets',resourceId(id)+'.asset.json');
    const bytes=await regular(target);
    const source=validateProjectSource(JSON.parse(bytes.toString('utf8')),id,this.lookup);
    return {source,revision:hash(bytes),kind:projectAssetKind(source,this.lookup)};
  }
  async importAsset(id:string,name:string,format:ImportFormat,
    content:Buffer):Promise<AssetEntry>{
    return this.enqueue(async()=>{
      id=resourceId(id);name=resourceName(name);
      if(format!=='glb'&&format!=='png')throw Error('Unsupported import format');
      validateImportBytes(format,content);
      const folder=join(this.requireActive(),'assets');
      const importFolder=join(folder,'imports');
      await mkdir(importFolder,{recursive:true});
      await directory(importFolder);
      const file=join(importFolder,id+'.'+format);
      const target=join(folder,id+'.asset.json');
      // Metadata is published only after its binary payload is fully written.
      // Avoid overwriting another resource with the same logical identity.
      try{await lstat(target);throw Error('Asset already exists');}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      }
      const source:ImportedAssetSource=validateImportedSource({
        format:'devtool-asset',version:2,id,name,origin:'imported',
        kind:importedAssetKind(format),
        imported:{format,path:'imports/'+id+'.'+format,
          sha256:hash(content),byteLength:content.length},
        dependencies:[],
      },id);
      const bytes=Buffer.from(JSON.stringify(source,null,2)+'\n');
      // Exclusive creation prevents replacement. A failed partial write
      // leaves no asset record and no orphaned payload.
      const handle=await open(file,'wx');
      let ready=false;
      try{
        await handle.writeFile(content);
        await handle.sync();
        ready=true;
      }finally{
        await handle.close();
        if(!ready)await rm(file,{force:true});
      }
      try{await writeFile(target,bytes,{flag:'wx'});}
      catch(error){await rm(file,{force:true});throw error;}
      return {source,revision:hash(bytes),kind:source.kind};
    });
  }
  async importedBytes(id:string):Promise<{bytes:Buffer;source:ImportedAssetSource}>{
    const entry=await this.asset(id);
    if(!('origin' in entry.source))throw Error('Not an imported asset');
    const source=entry.source;
    // The only accepted path is derived from the validated ID and format.
    const path=join(this.requireActive(),'assets','imports',
      source.id+'.'+source.imported.format);
    const bytes=await regular(path);
    if(bytes.length!==source.imported.byteLength||
      hash(bytes)!==source.imported.sha256)
      throw Error('Imported asset content changed or corrupted: '+id);
    validateImportBytes(source.imported.format,bytes);
    return {bytes,source};
  }
  async createAsset(id:string,input:unknown):Promise<AssetEntry>{
    return this.enqueue(async()=>{
      id=resourceId(id);
      const source=createProceduralSource(input,id,this.lookup);
      assertAssetDependencies(source,await this.assets(),this.lookup);
      const target=join(this.requireActive(),'assets',id+'.asset.json');
      const bytes=Buffer.from(JSON.stringify(source,null,2)+'\n');
      await writeFile(target,bytes,{flag:'wx'});
      return {source,revision:hash(bytes),kind:this.lookup(source.generator.id)!.kind};
    });
  }
  /** Create several independent, shared image recipes in one workspace
   * operation. Validate before writing and discard files on failure.
   */
  async createMaterialAssets(inputs: unknown): Promise<AssetEntry[]> {
    return this.enqueue(async () => {
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 8) {
        throw Error('A material set must contain 1 to 8 recipes');
      }

      const seen = new Set<string>();
      const existing = await this.assets();
      const prepared = inputs.map(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw Error('Invalid material recipe');
        }
        const {id, ...recipe} = raw as Record<string, unknown>;
        const name = resourceId(id);
        if (seen.has(name)) {
          throw Error('Duplicate material resource ID: ' + name);
        }
        seen.add(name);

        const source = createProceduralSource(recipe, name, this.lookup);
        const generator = this.lookup(source.generator.id);
        if (generator?.kind !== 'image' || source.dependencies.length) {
          throw Error('A material set can only contain independent image recipes');
        }
        assertAssetDependencies(source, existing, this.lookup);
        const bytes = Buffer.from(JSON.stringify(source, null, 2) + '\n');
        const target = join(this.requireActive(), 'assets', name + '.asset.json');
        return {source, bytes, target};
      });

      const written: string[] = [];
      try {
        for (const item of prepared) {
          const handle = await open(item.target, 'wx');
          written.push(item.target);
          try {
            await handle.writeFile(item.bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
      } catch (error) {
        for (const path of written) {
          await rm(path, {force: true});
        }
        throw error;
      }

      return prepared.map(({source, bytes}): AssetEntry => ({
        source,
        revision: hash(bytes),
        kind: 'image',
      }));
    });
  }
  async updateAsset(id:string,input:unknown,revision:string):Promise<AssetEntry>{
    return this.enqueue(async()=>{
      id=resourceId(id);
      const old=await this.asset(id);
      if(old.revision!==revision)throw Error('Asset was modified; reload before saving');
      if('origin' in old.source)
        throw Error('Imported resources cannot be updated as generator recipes');
      const source=createProceduralSource(input,id,this.lookup,old.source.dependencies,
        old.source.materials);
      if(source.generator.id!==old.source.generator.id)
        throw Error('Cannot change generator of an existing asset; save a new asset');
      assertAssetDependencies(source,await this.assets(),this.lookup);
      const target=join(this.requireActive(),'assets',id+'.asset.json');
      const bytes=Buffer.from(JSON.stringify(source,null,2)+'\n');
      if(hash(await regular(target))!==revision)throw Error('Asset changed on disk');
      await atomic(target,bytes);
      return {source,revision:hash(bytes),kind:this.lookup(source.generator.id)!.kind};
    });
  }
  async buildPlan(only?:readonly string[]){
    await this.queue;
    return planAssetBuild(await this.effectiveAssets(),only);
  }
  // Both single-root and all-project builds resolve effective Art Direction
  // and the transitive DAG once inside the same serialized project operation.
  // Production is always delegated to the existing content-addressed baker.
  private async buildAssets(only?:readonly string[]){
    const entries=await this.effectiveAssets();
    const plan=planAssetBuild(entries,only);
    return produceBuild(this.requireActive(),plan,entries,
      importedId=>this.importedBytes(importedId),
      async assetId=>(await this.asset(assetId)).revision);
  }
  async buildAsset(id:string){
    return this.enqueue(()=>this.buildAssets([resourceId(id)]));
  }
  async buildProject(){
    return this.enqueue(()=>this.buildAssets());
  }
  private async buildSceneInternal(mapId:string){
      mapId=resourceId(mapId);
      const mapFile=join(this.requireActive(),'maps',mapId+'.map.json');
      // Refuse redirected map documents. loadMap validates both terrain images
      // and uses the same interpolation as the runtime Map System.
      const original=await regular(mapFile);
      const doc=await loadMap(mapFile);
      const serialized=serializeMap(doc);
      const plan=planMapScene(mapId,doc,await this.effectiveAssets());
      const roots=[...new Set([...plan.assetRoots,...plan.materialRoots])].sort();
      const build=roots.length?await this.buildAssets(roots):null;
      // A parallel map-editor or external write must not publish a snapshot
      // whose map and model artifacts describe different source revisions.
      if(!(await regular(mapFile)).equals(original))
        throw Error('Map changed during scene build: '+mapId);
      const finalDoc=serializeMap(await loadMap(mapFile));
      if(!finalDoc.json.equals(serialized.json)||
        !finalDoc.exr.equals(serialized.exr)||
        !finalDoc.png.equals(serialized.png))
        throw Error('Map terrain changed during scene build: '+mapId);
      return publishSceneBundle(this.requireActive(),plan,serialized,
        doc.map.terrain.heightmap,doc.map.terrain.surface_map,build,doc);
  }
  async buildScene(mapId:string){
    return this.enqueue(()=>this.buildSceneInternal(mapId));
  }
  /** Read only an existing, hash-verified portable terrain artifact.
   * Never initiates a build or exposes an arbitrary project filesystem path.
   */
  async sceneGeometry(mapId:string,key:string,
    kind:'terrain'|'roads'|'water'):Promise<Buffer|null>{
    await this.queue;
    mapId=resourceId(mapId);
    if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid scene bundle key');
    const root=join(this.requireActive(),'build','scenes',mapId,key);
    const scene=await readSceneBundle(root);
    if(!scene)return null;
    if(scene.mapId!==mapId||scene.key!==key)
      throw Error('Scene bundle identity mismatch');
    if(!['terrain','roads','water'].includes(kind))
      throw Error('Invalid requested scene geometry');
    const file=scene.geometry[kind];
    if(!file)return null; // Optional road and water GLBs may not exist.
    if(file!=='geometry/'+kind+'.glb')
      throw Error('Invalid baked scene geometry: '+kind);
    const entry=scene.files.find(item=>item.path===file);
    if(!entry)throw Error('Missing baked scene geometry: '+kind);
    const bytes=await regular(join(root,...entry.path.split('/')));
    if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)
      throw Error('Scene geometry changed during preview retrieval: '+kind);
    return bytes;
  }
  async exportGodotScene(mapId:string){
    return this.enqueue(async()=>{
      const bundle=await this.buildSceneInternal(mapId);
      return publishGodotScene(this.requireActive(),bundle);
    });
  }
  private async exportOneAsset(id:string){
    const result=await this.buildAssets([id]);
    return publishGodotPackage(this.requireActive(),id,result);
  }
  async exportGodot(id:string){
    return this.enqueue(()=>this.exportOneAsset(resourceId(id)));
  }
  async syncGodot(id:string,target:string){
    return this.enqueue(async()=>{
      id=resourceId(id);
      if(!this.activeId)throw Error('No active project');
      // Never nest queued public methods. The package and sync use the same
      // serialized project operation and see one consistent active project.
      const godot=await validateGodotProject(target);
      const pkg=await this.exportOneAsset(id);
      return syncGodotPackage(this.activeId,id,pkg,godot);
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
      if(!RESOURCE_ID_PATTERN.test(id))continue;
      const map=validateMap(JSON.parse(
        (await regular(join(folder,file))).toString('utf8')));
      for(const binding of Object.values(map.terrain.surface_materials??{})){
        edges.push({from:'map:'+id,to:binding.asset});
        if(!known.has(binding.asset.slice('asset:'.length)))
          missing.add(binding.asset);
      }
      for(const item of [...map.buildings,...map.objects]){
        const found=ASSET_REFERENCE_PATTERN.exec(item.definition);
        if(found){
          edges.push({from:'map:'+id,to:item.definition});
          if(!known.has(found[1]))missing.add(item.definition);
        }
      }
    }
    return {edges,missing:[...missing].sort()};
  }
}
