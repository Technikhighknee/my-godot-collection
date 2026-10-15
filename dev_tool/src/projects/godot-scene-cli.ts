// Godot-specific scene export from the verified, portable map-scene pipeline.
// Usage: npm run export:godot-scene -- <map-id> [--projects-dir <directory>]
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectLibrary} from './library.ts';
import {findGenerator} from '../../tools/asset-procgen/web/generators.mjs';

async function main(){
  const args=process.argv.slice(2);
  if(args.length===0||args[0]==='--help'){
    console.log('Usage: npm run export:godot-scene -- <map-id> [--projects-dir <directory>]');
    return;
  }
  if(args.length!==1&&!(args.length===3&&args[1]==='--projects-dir'))
    throw Error('Unexpected Godot scene export arguments');
  const root=resolve(args.length===3?args[2]!:
    fileURLToPath(new URL('../../projects',import.meta.url)));
  const library=await ProjectLibrary.open(root,undefined,findGenerator);
  if(!library.active())throw Error('No active project');
  const result=await library.exportGodotScene(args[0]!);
  console.log((result.published?'Published':'Reused')+
    ' Godot scene '+result.manifest.mapId+' @ '+result.manifest.sourceKey);
  console.log(result.built+' asset(s) generated · '+result.reused+' reused');
  console.log(result.directory+'/'+result.sceneFile);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
