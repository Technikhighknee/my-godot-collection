// Godot-specific delivery adapter for already-verified portable scene bundles.
// Never reinterprets generator seeds or rebuilds source map geometry.
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {lstat,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {readSceneBundle,type SceneBundleResult,type SceneBundleFile}
  from './scene-bundle.ts';
import {serializeGodotScene} from './godot-scene-format.ts';

export interface GodotScenePackageManifest{
  format:'devtool-godot-scene';version:1;
  mapId:string;sourceKey:string;sceneFile:string;
  files:SceneBundleFile[];
}
export interface GodotScenePackageResult{
  directory:string;sceneFile:string;published:boolean;
  manifest:GodotScenePackageManifest;built:number;reused:number;
}
const namePattern=/^[a-z0-9][a-z0-9_-]{0,47}$/;
const checksum=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function allowedPath(name:string,id:string){
  const parts=name.split('/');
  if(parts.some(part=>part===''||part==='.'||part==='..'||
    part.includes('\\')||part.includes(':')))return false;
  return name===id+'.tscn'||name==='maps/'+id+'.map.json'||
    /^geometry\/(terrain|roads|water)\.glb$/.test(name)||
    (parts[0]==='maps'&&parts.length>2&&
      (name.endsWith('.exr')||name.endsWith('.png')))||
    /^assets\/[a-z0-9][a-z0-9_-]{0,47}\/[a-z0-9][a-z0-9_-]*(?:--[a-z][a-z0-9_-]*)?\.(?:glb|png)$/.test(name);
}
async function safeDirectory(path:string){
  try{await mkdir(path);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  }
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink())
    throw Error('Godot scene export directory is redirected: '+path);
}
async function regular(path:string){
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
    throw Error('Godot scene export file is redirected: '+path);
  return readFile(path);
}
async function previousExport(dir:string,id:string):Promise<GodotScenePackageManifest|null>{
  try{
    const info=await lstat(dir);
    if(!info.isDirectory()||info.isSymbolicLink())
      throw Error('Invalid managed Godot scene export directory');
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw error;
  }
  const old:GodotScenePackageManifest=JSON.parse(
    (await regular(join(dir,'manifest.json'))).toString('utf8'));
  if(old.format!=='devtool-godot-scene'||old.version!==1||
    old.mapId!==id||old.sceneFile!==id+'.tscn'||
    !/^[a-f0-9]{64}$/.test(old.sourceKey)||!Array.isArray(old.files))
    throw Error('Invalid managed Godot scene export manifest');
  const expected=new Set(['manifest.json']);
  for(const item of old.files){
    if(!item||typeof item.path!=='string'||!allowedPath(item.path,id)||
      expected.has(item.path)||!Number.isSafeInteger(item.bytes)||
      item.bytes<1||typeof item.sha256!=='string'||
      !/^[a-f0-9]{64}$/.test(item.sha256))
      throw Error('Unsafe Godot scene export manifest');
    expected.add(item.path);
    const bytes=await regular(join(dir,...item.path.split('/')));
    if(bytes.length!==item.bytes||checksum(bytes)!==item.sha256)
      throw Error('Godot scene export was modified: '+item.path);
  }
  if(!expected.has(old.sceneFile))throw Error('Missing Godot scene file in export');
  const seen=new Set<string>();
  async function walk(path:string,base=''){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const rel=base+entry.name;
      if(entry.isSymbolicLink())throw Error('Godot scene export contains a symlink');
      if(entry.isDirectory())await walk(join(path,entry.name),rel+'/');
      else if(entry.isFile())seen.add(rel);
      else throw Error('Invalid Godot scene export file type');
    }
  }
  await walk(dir);
  if(seen.size!==expected.size||[...seen].some(path=>!expected.has(path)))
    throw Error('Unmanaged files in Godot scene export');
  return old;
}

export async function publishGodotScene(projectDir:string,
  bundle:SceneBundleResult):Promise<GodotScenePackageResult>{
  const {directory,manifest:source}=bundle;
  const id=source.mapId;
  if(!namePattern.test(id))throw Error('Invalid Godot scene identity');
  // Content-addressed source snapshots are not trusted without rechecking
  // their on-disk manifest, files and every published file hash.
  const verified=await readSceneBundle(directory);
  if(!verified||JSON.stringify(verified)!==JSON.stringify(source))
    throw Error('Portable scene changed before Godot export');
  const sceneFile=id+'.tscn';
  const tscn=serializeGodotScene(source);
  const all=new Map<string,Buffer>();
  const files:SceneBundleFile[]=[];
  for(const entry of source.files){
    if(!allowedPath(entry.path,id)||all.has(entry.path))
      throw Error('Unsafe portable scene file for Godot: '+entry.path);
    const bytes=await regular(join(directory,...entry.path.split('/')));
    if(bytes.length!==entry.bytes||checksum(bytes)!==entry.sha256)
      throw Error('Portable scene file changed during Godot export: '+entry.path);
    all.set(entry.path,bytes);
    files.push({...entry});
  }
  if(all.has(sceneFile))throw Error('Godot scene path conflicts with portable bundle');
  all.set(sceneFile,tscn);
  files.push({path:sceneFile,bytes:tscn.length,sha256:checksum(tscn)});
  const manifest:GodotScenePackageManifest={
    format:'devtool-godot-scene',version:1,
    mapId:id,sourceKey:source.key,sceneFile,files,
  };
  const exports=join(projectDir,'exports');await safeDirectory(exports);
  const scenes=join(exports,'godot-scenes');await safeDirectory(scenes);
  const target=join(scenes,id);
  const old=await previousExport(target,id);
  if(old&&JSON.stringify(old)===JSON.stringify(manifest))
    return {directory:target,sceneFile,published:false,manifest,
      built:bundle.built,reused:bundle.reused};
  const token=randomUUID(),staged=join(scenes,'.pending-'+token),
    backup=join(scenes,'.previous-'+token);
  await safeDirectory(staged);
  let backedUp=false,published=false;
  try{
    for(const [path,bytes] of all){
      const destination=join(staged,...path.split('/'));
      await mkdir(dirname(destination),{recursive:true});
      await writeFile(destination,bytes,{flag:'wx'});
    }
    await writeFile(join(staged,'manifest.json'),
      JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    // Stage first. Failed verifications never modify an existing export.
    if(old){await rename(target,backup);backedUp=true;}
    try{await rename(staged,target);published=true;}
    catch(error){
      if(backedUp){await rename(backup,target);backedUp=false;}
      throw error;
    }
    if(backedUp){await rm(backup,{recursive:true});backedUp=false;}
    return {directory:target,sceneFile,published:true,manifest,
      built:bundle.built,reused:bundle.reused};
  }finally{
    if(!published)await rm(staged,{recursive:true,force:true});
  }
}
