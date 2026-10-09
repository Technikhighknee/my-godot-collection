import { loadMap, serializeMap } from './io/map-io.ts';
import { heightAt } from './core/map.ts';
const file=process.argv[2];
if(!file){console.error('Usage: node --experimental-strip-types src/cli.ts <map.json>');process.exitCode=2;}
else {
 try {
  const doc=await loadMap(file);
  const {map,heights,surfaces}=doc;
  const payload=serializeMap(doc);
  console.log(JSON.stringify({map:map.name,size:map.terrain.size,grid:[heights.width,heights.height],surfaceCells:[surfaces.width,surfaces.height],centerHeight:heightAt(doc,map.terrain.size[0]/2,map.terrain.size[1]/2),encodedBytes:{exr:payload.exr.length,png:payload.png.length}},null,2));
 } catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
