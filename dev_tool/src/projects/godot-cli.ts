// Export one saved resource and its material dependencies as a stable Godot
// package, separate from the disposable content-addressed build cache.
// Usage: npm run export:godot -- <asset-id> [--projects-dir <directory>]
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectLibrary} from './library.ts';
import {findGenerator} from '../../tools/asset-procgen/web/generators.mjs';

async function main(){
  const args=process.argv.slice(2);
  if(!args.length||args[0]==='--help'){
    console.log('Usage: npm run export:godot -- <asset-id> [--projects-dir <directory>]');
    return;
  }
  const id=args[0]!;
  if(args.length!==1&&!(args.length===3&&args[1]==='--projects-dir'))
    throw Error('Unexpected export arguments');
  const root=resolve(args.length===3?args[2]!:
    fileURLToPath(new URL('../../projects',import.meta.url)));
  const library=await ProjectLibrary.open(root,undefined,findGenerator);
  if(!library.active())throw Error('No active project');
  const result=await library.exportGodot(id);
  console.log(result.published?'Godot package updated':'Godot package unchanged');
  console.log(result.directory);
  console.log(result.manifest.files.length+' output file(s) · '+
    result.built+' generated · '+result.reused+' cached');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
