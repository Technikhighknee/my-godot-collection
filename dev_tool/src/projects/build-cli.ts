// Headless production entrypoint for the active Dev Tool project.
// Usage: npm run build:asset -- <resource-id> [--projects-dir <directory>]
//        npm run build:project [-- --projects-dir <directory>]
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectLibrary} from './library.ts';
import {findGenerator} from '../../tools/asset-procgen/web/generators.mjs';

async function main(){
  const args=process.argv.slice(2);
  if(!args.length||args[0]==='--help'){
    console.log('Usage: npm run build:asset -- <asset-id> [--projects-dir <directory>]');
    console.log('       npm run build:project [-- --projects-dir <directory>]');
    return;
  }
  const id=args[0]!;
  if(args.length!==1&&!(args.length===3&&args[1]==='--projects-dir'))
    throw Error('Unexpected build arguments');
  const root=resolve(args.length===3?args[2]!:
    fileURLToPath(new URL('../../projects',import.meta.url)));
  const library=await ProjectLibrary.open(root,undefined,findGenerator);
  if(!library.active())throw Error('No active project');
  const result=id==='--all'?await library.buildProject():await library.buildAsset(id);
  console.log('Build '+result.planKey);
  console.log(result.built+' generated · '+result.reused+' reused');
  for(const artifact of result.artifacts)
    console.log(artifact.id+' → '+library.active()!.id+
      '/build/assets/'+artifact.id+'/'+artifact.key+
      ' ('+artifact.files.length+' file(s))');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
