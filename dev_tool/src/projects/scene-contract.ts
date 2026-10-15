// Engine-neutral relationships for portable scene bundles.
// The producer, cache reader and target-engine adapters share this contract.
import type {SceneBundleManifest} from './scene-bundle.ts';

const idPattern=/^[a-z0-9][a-z0-9_-]{0,47}$/;
const hashPattern=/^[a-f0-9]{64}$/;
function relative(path:unknown):path is string {
  return typeof path==='string'&&path.length>0&&
    !path.startsWith('/')&&path.split('/').every(part=>
      part!==''&&part!=='.'&&part!=='..'&&
      !part.includes('\\')&&!part.includes(':'));
}
function present(files:Set<string>,path:unknown,label:string){
  if(!relative(path)||!files.has(path))
    throw Error('Missing or invalid scene '+label+': '+String(path));
}

/** Validate scene reference semantics independently of any export format.
 * The bundle publisher separately verifies file contents and SHA-256 hashes.
 */
export function validateSceneContract(scene:SceneBundleManifest):void{
  if(!scene||scene.format!=='devtool-scene-bundle'||scene.version!==1||
    !idPattern.test(scene.mapId)||!hashPattern.test(scene.key)||
    (scene.assetPlanKey!==null&&!hashPattern.test(scene.assetPlanKey))||
    !Array.isArray(scene.files)||!Array.isArray(scene.resources)||
    !Array.isArray(scene.placements))
    throw Error('Invalid portable scene manifest');

  const files=new Set<string>();
  for(const file of scene.files){
    if(!file||!relative(file.path)||files.has(file.path)||
      !Number.isSafeInteger(file.bytes)||file.bytes<1||
      typeof file.sha256!=='string'||!hashPattern.test(file.sha256))
      throw Error('Invalid or duplicate portable scene file');
    files.add(file.path);
  }
  if(scene.mapFile!=='maps/'+scene.mapId+'.map.json')
    throw Error('Invalid scene map source');
  present(files,scene.mapFile,'map source');
  if(!scene.terrain||!relative(scene.terrain.heightmap)||
    !scene.terrain.heightmap.startsWith('maps/')||
    !scene.terrain.heightmap.endsWith('.exr')||
    !relative(scene.terrain.surfaceMap)||
    !scene.terrain.surfaceMap.startsWith('maps/')||
    !scene.terrain.surfaceMap.endsWith('.png')||
    scene.terrain.heightmap===scene.terrain.surfaceMap)
    throw Error('Invalid scene terrain sources');
  present(files,scene.terrain.heightmap,'heightmap');
  present(files,scene.terrain.surfaceMap,'surface map');

  if(!scene.geometry||scene.geometry.terrain!=='geometry/terrain.glb')
    throw Error('Portable scene lacks baked terrain geometry');
  present(files,scene.geometry.terrain,'terrain geometry');
  for(const kind of ['roads','water'] as const){
    const path=scene.geometry[kind];
    if(path===undefined)continue;
    if(path!=='geometry/'+kind+'.glb')
      throw Error('Invalid baked scene '+kind+' geometry');
    present(files,path,kind+' geometry');
  }

  const resources=new Map<string,{kind:string;files:Set<string>}>();
  const owned=new Set<string>();
  for(const resource of scene.resources){
    if(!resource||!idPattern.test(resource.id)||
      (resource.kind!=='model'&&resource.kind!=='image')||
      !hashPattern.test(resource.key)||
      !Array.isArray(resource.files)||resource.files.length===0||
      resources.has(resource.id))
      throw Error('Invalid or duplicate scene resource');
    const resourceFiles=new Set<string>();
    for(const path of resource.files){
      if(!relative(path)||!path.startsWith('assets/'+resource.id+'/')||
        !/\.(glb|png)$/.test(path)||resourceFiles.has(path)||owned.has(path))
        throw Error('Invalid scene resource file: '+String(path));
      present(files,path,'resource file');
      resourceFiles.add(path);
      owned.add(path);
    }
    if(resource.kind==='image'&&[...resourceFiles].some(x=>x.endsWith('.glb')))
      throw Error('Image scene resource contains a model');
    if(resource.kind==='model'&&![...resourceFiles].some(x=>x.endsWith('.glb')))
      throw Error('Scene model has no GLB output: '+resource.id);
    resources.set(resource.id,{kind:resource.kind,files:resourceFiles});
  }
  for(const path of files){
    if(path.startsWith('assets/')&&!owned.has(path))
      throw Error('Unowned portable scene asset file: '+path);
    if(path.startsWith('geometry/')&&!Object.values(scene.geometry).includes(path))
      throw Error('Unreferenced portable scene geometry: '+path);
  }

  const placementIds=new Set<string>();
  for(const placement of scene.placements){
    if(!placement||typeof placement.id!=='string'||!placement.id||
      placementIds.has(placement.id)||typeof placement.definition!=='string'||
      !placement.definition||!Array.isArray(placement.position)||
      placement.position.length!==3||
      !placement.position.every(x=>typeof x==='number'&&Number.isFinite(x))||
      typeof placement.rotationDegrees!=='number'||
      !Number.isFinite(placement.rotationDegrees)||
      (placement.kind!=='building'&&placement.kind!=='object'))
      throw Error('Invalid scene placement');
    placementIds.add(placement.id);
    if(placement.source==='project-asset'){
      const id=placement.assetId;
      const resource=id?resources.get(id):undefined;
      if(!id||!idPattern.test(id)||placement.definition!=='asset:'+id||
        !resource||resource.kind!=='model'||!placement.modelFile||
        !placement.modelFile.endsWith('.glb')||
        !resource.files.has(placement.modelFile))
        throw Error('Unresolved scene model: '+placement.id);
    }else if(placement.source==='game-definition'){
      if(placement.assetId!==undefined||placement.modelFile!==undefined||
        placement.definition.startsWith('asset:'))
        throw Error('Invalid scene game-definition reference: '+placement.id);
    }else throw Error('Unknown scene placement source');
  }
}
