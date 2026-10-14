// Publish a reproducible, copyable Godot asset package from verified build
// artifacts. Export structure is stable; content-addressed caches stay private.
// Each root owns one package, so exporting another resource never removes it.
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
import type {BuildResult,BuildArtifact} from './build.ts';

export interface GodotPackageFile {
  path:string;sha256:string;bytes:number;
}
export interface GodotPackageResource {
  id:string;kind:'model'|'image';origin:'procedural'|'imported';
  key:string;dependencies:readonly {id:string;key:string}[];
  files:readonly string[];
}
export interface GodotPackageManifest {
  format:'devtool-godot-package';version:1;root:string;
  planKey:string;resources:GodotPackageResource[];files:GodotPackageFile[];
}
export interface GodotPackageResult {
  directory:string;published:boolean;manifest:GodotPackageManifest;
  built:number;reused:number;
}
const slug=/^[a-z0-9][a-z0-9_-]*$/;
const fileName=/^[a-z0-9][a-z0-9_-]*(?:--[a-z][a-z0-9_-]*)?\.(?:glb|png)$/;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function directory(path:string):Promise<void>{
  try{await mkdir(path);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  }
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink())
    throw Error('Godot export directory is redirected: '+path);
}
async function regular(path:string):Promise<Buffer>{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
    throw Error('Godot export path is not a regular file: '+path);
  return readFile(path);
}
function safeRelative(path:string):boolean{
  return path.split('/').length===3&&
    path.split('/')[0]==='assets'&&
    slug.test(path.split('/')[1]??'')&&
    fileName.test(path.split('/')[2]??'');
}
function verifyManifest(value:unknown,root:string):GodotPackageManifest{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('Existing Godot export is not managed by the Dev Tool');
  const m=value as GodotPackageManifest;
  if(m.format!=='devtool-godot-package'||m.version!==1||m.root!==root||
    typeof m.planKey!=='string'||!Array.isArray(m.files)||
    !Array.isArray(m.resources)||!m.files.length)
    throw Error('Existing Godot export is not managed by the Dev Tool');
  const names=new Set<string>();
  for(const f of m.files){
    if(typeof f.path!=='string'||!safeRelative(f.path)||
      typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||
      !Number.isSafeInteger(f.bytes)||f.bytes<1||names.has(f.path))
      throw Error('Unsafe Godot export manifest');
    names.add(f.path);
  }
  return m;
}
async function readPublished(directoryPath:string,root:string):
  Promise<GodotPackageManifest|null>{
  try{
    const info=await lstat(directoryPath);
    if(!info.isDirectory()||info.isSymbolicLink())
      throw Error('Existing Godot export is not a regular directory');
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw error;
  }
  const manifest=verifyManifest(JSON.parse((await regular(
    join(directoryPath,'manifest.json'))).toString('utf8')),root);
  for(const file of manifest.files){
    const parts=file.path.split('/');
    const folder=join(directoryPath,parts[0]!,parts[1]!);
    const sub=await lstat(folder);
    if(!sub.isDirectory()||sub.isSymbolicLink())
      throw Error('Godot export resource directory is redirected');
    const data=await regular(join(folder,parts[2]!));
    if(data.length!==file.bytes||hash(data)!==file.sha256)
      throw Error('Published Godot file was modified: '+file.path);
  }
  return manifest;
}
function manifestFor(root:string,build:BuildResult):GodotPackageManifest{
  if(!slug.test(root)||!build.artifacts.some(a=>a.id===root))
    throw Error('Missing export root: '+root);
  const files:GodotPackageFile[]=[];
  const resources:GodotPackageResource[]=[];
  for(const artifact of build.artifacts){
    if(!slug.test(artifact.id)||!Array.isArray(artifact.files)||!artifact.files.length)
      throw Error('Invalid built resource in Godot package');
    const names:string[]=[];
    for(const file of artifact.files){
      if(!fileName.test(file.file)||!Number.isSafeInteger(file.bytes)||
        file.bytes<1||typeof file.sha256!=='string'||
        !/^[a-f0-9]{64}$/.test(file.sha256))
        throw Error('Unsafe built file in Godot package');
      const path='assets/'+artifact.id+'/'+file.file;
      if(files.some(x=>x.path===path))throw Error('Duplicate Godot export file');
      files.push({path,bytes:file.bytes,sha256:file.sha256});
      names.push(path);
    }
    resources.push({id:artifact.id,kind:artifact.kind,origin:artifact.origin,
      key:artifact.key,dependencies:artifact.dependencies,files:names});
  }
  return {format:'devtool-godot-package',version:1,root,
    planKey:build.planKey,resources,files};
}
export async function publishGodotPackage(projectDir:string,root:string,
  build:BuildResult):Promise<GodotPackageResult>{
  const manifest=manifestFor(root,build);
  const exportsRoot=join(projectDir,'exports');
  await directory(exportsRoot);
  const packages=join(exportsRoot,'godot');
  await directory(packages);
  const destination=join(packages,root);
  const previous=await readPublished(destination,root);
  if(previous&&JSON.stringify(previous)===JSON.stringify(manifest))
    return {directory:destination,published:false,manifest,
      built:build.built,reused:build.reused};
  // Staging is wholly inside the same parent to keep rename atomic per
  // directory on Windows and POSIX. No user content outside this package
  // is overwritten, including packages belonging to other root assets.
  const uuid=randomUUID();
  const staged=join(packages,'.pending-'+uuid);
  const backup=join(packages,'.previous-'+uuid);
  await directory(staged);
  let backupMoved=false,published=false;
  try{
    const buildRoot=join(projectDir,'build','assets');
    for(const resource of manifest.resources){
      const output=join(staged,'assets');
      await directory(output);
      const targetDir=join(output,resource.id);
      await directory(targetDir);
      const originDir=join(buildRoot,resource.id,resource.key);
      const cacheDirectory=await lstat(originDir);
      if(!cacheDirectory.isDirectory()||cacheDirectory.isSymbolicLink())
        throw Error('Unsafe build cache directory: '+resource.id);
      for(const relativePath of resource.files){
        const match=manifest.files.find(f=>f.path===relativePath)!;
        const source=join(originDir,relativePath.split('/')[2]!);
        const bytes=await regular(source);
        if(bytes.length!==match.bytes||hash(bytes)!==match.sha256)
          throw Error('Build cache changed before Godot export: '+relativePath);
        await writeFile(join(targetDir,relativePath.split('/')[2]!),bytes,{flag:'wx'});
      }
    }
    await writeFile(join(staged,'manifest.json'),
      JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    if(previous){
      await rename(destination,backup);
      backupMoved=true;
    }
    try{await rename(staged,destination);published=true;}
    catch(error){
      if(backupMoved){await rename(backup,destination);backupMoved=false;}
      throw error;
    }
    if(backupMoved){await rm(backup,{recursive:true});backupMoved=false;}
    return {directory:destination,published:true,manifest,
      built:build.built,reused:build.reused};
  }finally{
    if(!published)await rm(staged,{recursive:true,force:true});
  }
}
