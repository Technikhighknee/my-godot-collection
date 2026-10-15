// Reproducible portable map-scene bundle, not a target-engine-specific scene.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectLibrary} from './library.ts';
import {findGenerator} from '../../tools/asset-procgen/web/generators.mjs';

async function main(){
  const args=process.argv.slice(2);
  if(args[0]==='--help'||!args.length){
    console.log('Usage: npm run build:scene -- <map-id> [--projects-dir <directory>]');
    return;
  }
  if(args.length!==1&&!(args.length===3&&args[1]==='--projects-dir'))
    throw Error('Unexpected scene build arguments');
  const root=resolve(args.length===3?args[2]!:
    fileURLToPath(new URL('../../projects',import.meta.url)));
  const lib=await ProjectLibrary.open(root,undefined,findGenerator);
  if(!lib.active())throw Error('No active project');
  const result=await lib.buildScene(args[0]!);
  console.log('Scene '+result.manifest.mapId+' @ '+result.manifest.key);
  console.log(result.published?'Published scene bundle':'Reused scene bundle');
  console.log(result.built+' assets generated · '+result.reused+' reused');
  console.log(result.manifest.placements.length+' placements, '+
    result.manifest.resources.length+' built resources');
  console.log(result.directory);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
