// Explicit, project-scoped delivery into a real Godot 4 project.
// The only writable target is res://assets/1400/<project>/<resource>/.
// Binary outputs come exclusively from a previously verified project package.
import {randomUUID} from 'node:crypto';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {lstat,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {readGodotPackage,type GodotPackageResult} from './godot-package.ts';

const validId=/^[a-z0-9][a-z0-9_-]{0,47}$/;
async function existingDirectory(dir:string){
  const info=await lstat(dir);
  if(!info.isDirectory()||info.isSymbolicLink())
    throw Error('Godot target directory is not a regular directory: '+dir);
}
async function managedDirectory(dir:string){
  try{await mkdir(dir);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  }
  await existingDirectory(dir);
}
async function readRegular(path:string){
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())
    throw Error('Godot import file is redirected: '+path);
  return readFile(path);
}
export interface GodotSyncResult{
  target:string;
  resourcePath:string;
  synced:boolean;
  files:number;
  built:number;
  reused:number;
}
/** Export must be a successfully published and verified package. */
export async function syncGodotPackage(
  projectId:string,root:string,packageResult:GodotPackageResult,
  godotProjectDir:string):Promise<GodotSyncResult>{
  if(!validId.test(projectId)||!validId.test(root)||
    root!==packageResult.manifest.root)
    throw Error('Invalid Godot sync resource identity');
  if(typeof godotProjectDir!=='string'||!godotProjectDir.trim()||
    !isAbsolute(godotProjectDir)||godotProjectDir.includes('\0'))
    throw Error('Choose an absolute Godot project folder');
  const game=resolve(godotProjectDir);
  await existingDirectory(game);
  const projectFile=await readRegular(join(game,'project.godot'));
  if(!projectFile.length)
    throw Error('Godot project.godot is empty');
  // Re-verify the package after generation. A stale or modified package
  // cannot be copied to a game just because its manifest looks valid.
  const source=await readGodotPackage(packageResult.directory,root);
  if(!source||JSON.stringify(source)!==JSON.stringify(packageResult.manifest))
    throw Error('Godot export changed before sync');
  const assets=join(game,'assets');
  await managedDirectory(assets);
  const namespace=join(assets,'1400');
  await managedDirectory(namespace);
  const projectFolder=join(namespace,projectId);
  await managedDirectory(projectFolder);
  const target=join(projectFolder,root);
  const old=await readGodotPackage(target,root,true);
  const same=old&&JSON.stringify(old)===JSON.stringify(source);
  const rel='res://assets/1400/'+projectId+'/'+root+'/';
  if(same)return {target,resourcePath:rel,synced:false,
    files:source.files.length,built:packageResult.built,
    reused:packageResult.reused};
  const token=randomUUID();
  const staged=join(projectFolder,'.pending-'+token);
  const backup=join(projectFolder,'.previous-'+token);
  await managedDirectory(staged);
  let moved=false,published=false;
  try{
    const outputAssets=join(staged,'assets');
    await managedDirectory(outputAssets);
    for(const resource of source.resources){
      const folder=join(outputAssets,resource.id);
      await managedDirectory(folder);
      for(const file of resource.files){
        const filename=file.split('/')[2]!;
        const origin=join(packageResult.directory,'assets',resource.id,filename);
        await writeFile(join(folder,filename),await readRegular(origin),{flag:'wx'});
        if(old?.files.some(oldFile=>oldFile.path===file)){
          // Godot stores importer settings/UIDs in these sidecars.
          // Preserve them for paths that survive a sync, including on Windows.
          const sidecar=join(target,'assets',resource.id,filename+'.import');
          try{
            const bytes=await readRegular(sidecar);
            if(bytes.length>1024*1024)
              throw Error('Godot import sidecar too large: '+filename);
            await writeFile(join(folder,filename+'.import'),bytes,{flag:'wx'});
          }catch(error){
            if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
          }
        }
      }
    }
    await writeFile(join(staged,'manifest.json'),
      JSON.stringify(source,null,2)+'\n',{flag:'wx'});
    if(old){await rename(target,backup);moved=true;}
    try{await rename(staged,target);published=true;}
    catch(error){
      if(moved){await rename(backup,target);moved=false;}
      throw error;
    }
    if(moved){await rm(backup,{recursive:true});moved=false;}
    return {target,resourcePath:rel,synced:true,files:source.files.length,
      built:packageResult.built,reused:packageResult.reused};
  }finally{
    if(!published)await rm(staged,{recursive:true,force:true});
  }
}
