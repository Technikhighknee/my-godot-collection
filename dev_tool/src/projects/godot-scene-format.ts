// Deterministic Godot 4 scene-text serialization of a *verified* portable
// scene manifest. No model generation, map geometry, or filesystem access.
import type {SceneBundleManifest} from './scene-bundle.ts';

const safeId=/^[a-z0-9][a-z0-9_-]{0,47}$/;
const safeModel=/^assets\/[a-z0-9][a-z0-9_-]{0,47}\/[a-z0-9][a-z0-9_-]*(?:--[a-z][a-z0-9_-]*)?\.glb$/;
function number(value:number):string{
  if(typeof value!=='number'||!Number.isFinite(value))
    throw Error('Non-finite Godot scene transform');
  return Object.is(value,-0)?'0':String(value);
}
const quoted=(value:string)=>JSON.stringify(value);

export function serializeGodotScene(manifest:SceneBundleManifest):Buffer{
  if(manifest.format!=='devtool-scene-bundle'||manifest.version!==1||
    !safeId.test(manifest.mapId))
    throw Error('Invalid portable scene for Godot export');
  const resourceFiles=new Set(manifest.resources.flatMap(x=>x.files));
  const selections=new Set<string>();
  for(const placement of manifest.placements){
    if(!placement||!placement.id||typeof placement.id!=='string'||
      !Array.isArray(placement.position)||placement.position.length!==3||
      !placement.position.every(x=>Number.isFinite(x))||
      !Number.isFinite(placement.rotationDegrees))
      throw Error('Invalid Godot scene placement');
    if(placement.source==='project-asset'){
      if(!placement.assetId||!safeId.test(placement.assetId)||
        !placement.modelFile||!safeModel.test(placement.modelFile)||
        !placement.modelFile.startsWith('assets/'+placement.assetId+'/')||
        !resourceFiles.has(placement.modelFile))
        throw Error('Unresolved Godot scene model: '+placement.id);
      selections.add(placement.modelFile);
    }else if(placement.source==='game-definition'){
      if(placement.modelFile!==undefined||placement.assetId!==undefined)
        throw Error('Game definitions cannot imply a built Godot model');
    }else throw Error('Unknown Godot scene placement source');
    if(placement.kind!=='building'&&placement.kind!=='object')
      throw Error('Unknown Godot scene placement kind');
  }
  const paths=[...selections].sort();
  const ids=new Map(paths.map((path,index)=>[path,'model_'+(index+1)]));
  const geometryEntries=[
    ['Terrain',manifest.geometry?.terrain],
    ['Roads',manifest.geometry?.roads],
    ['Water',manifest.geometry?.water],
  ].filter((x):x is [string,string]=>typeof x[1]==='string');
  if(!geometryEntries.length||geometryEntries[0][1]!=='geometry/terrain.glb')
    throw Error('Portable scene lacks baked terrain geometry');
  for(const [kind,path] of geometryEntries){
    if(path!=='geometry/'+kind.toLowerCase()+'.glb'||!manifest.files.some(x=>x.path===path))
      throw Error('Portable scene contains invalid baked '+kind+' geometry');
  }
  const lines=[
    '[gd_scene load_steps='+String(paths.length+geometryEntries.length+1)+' format=3]',
    '',
  ];
  for(const path of paths)
    lines.push('[ext_resource type="PackedScene" path='+quoted(path)+
      ' id='+quoted(ids.get(path)!)+']');
  for(const [kind,path] of geometryEntries)
    lines.push('[ext_resource type="PackedScene" path='+quoted(path)+
      ' id='+quoted('geom_'+kind.toLowerCase())+']');
  lines.push('','[node name='+quoted(manifest.mapId)+' type="Node3D"]',
    'metadata/map_source = '+quoted(manifest.mapFile),
    'metadata/map_heightmap = '+quoted(manifest.terrain.heightmap),
    'metadata/map_surface_map = '+quoted(manifest.terrain.surfaceMap),
    'metadata/map_bundle_key = '+quoted(manifest.key),'',
    '[node name="Geometry" type="Node3D" parent="."]');
  for(const [kind] of geometryEntries)
    lines.push('','[node name='+quoted(kind)+' parent="Geometry" instance=ExtResource('+
      quoted('geom_'+kind.toLowerCase())+')]');
  lines.push('','[node name="Buildings" type="Node3D" parent="."]','',
    '[node name="Objects" type="Node3D" parent="."]');
  for(const [index,placement] of manifest.placements.entries()){
    const kind=placement.kind==='building'?'Buildings':'Objects';
    const name=kind.slice(0,-1)+'_'+String(index+1).padStart(5,'0');
    const header=placement.modelFile?
      '[node name='+quoted(name)+' parent='+quoted(kind)+
        ' instance=ExtResource('+quoted(ids.get(placement.modelFile)!)+')]':
      '[node name='+quoted(name)+' type="Marker3D" parent='+quoted(kind)+']';
    const radians=placement.rotationDegrees*Math.PI/180;
    lines.push('',header,
      'position = Vector3('+placement.position.map(number).join(', ')+')',
      'rotation = Vector3(0, '+number(radians)+', 0)',
      'metadata/placement_id = '+quoted(placement.id),
      'metadata/definition_id = '+quoted(placement.definition),
      'metadata/placement_kind = '+quoted(placement.kind));
    if(placement.source==='game-definition')
      lines.push('metadata/unresolved_game_definition = true');
  }
  return Buffer.from(lines.join('\n')+'\n','utf8');
}
