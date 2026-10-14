// Sync one project resource to an explicit local Godot project.
// Usage: npm run sync:godot -- <asset-id> --target <godot-project-dir>
//   [--projects-dir <directory>]
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectLibrary} from './library.ts';
import {findGenerator} from '../../tools/asset-procgen/web/generators.mjs';

async function main(){
  const args=process.argv.slice(2);
  if(!args.length||args.includes('--help')){
    console.log('Usage: npm run sync:godot -- <asset-id> --target <absolute-godot-project-dir> [--projects-dir <directory>]');
    return;
  }
  const id=args.shift()!;
  let target:string|undefined,projects:string|undefined;
  while(args.length){
    const flag=args.shift();
    const value=args.shift();
    if(!value||value.startsWith('--'))throw Error('Missing '+flag+' value');
    if(flag==='--target'&&!target)target=value;
    else if(flag==='--projects-dir'&&!projects)projects=value;
    else throw Error('Unknown or repeated sync option: '+flag);
  }
  if(!target)throw Error('Missing required --target Godot project folder');
  const library=await ProjectLibrary.open(resolve(projects??
    fileURLToPath(new URL('../../projects',import.meta.url))),
    undefined,findGenerator);
  if(!library.active())throw Error('No active project');
  const result=await library.syncGodot(id,target);
  console.log(result.synced?'Godot resource synchronized':'Godot resource unchanged');
  console.log(result.resourcePath);
  console.log(result.target);
  console.log(result.files+' files · '+result.built+' generated · '+
    result.reused+' cached');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
