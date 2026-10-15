// Creates a real Godot-importable fixture from our public project pipeline.
// No handwritten .tscn: only exported content from ProjectLibrary is tested.
import {mkdtemp,mkdir,readFile,writeFile,copyFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectLibrary} from '../../src/projects/library.ts';
import {findGenerator} from '../../tools/asset-procgen/web/generators.mjs';

function triangleGlb():Buffer{
  const vertices=new Float32Array([
     0,0,0,  1,0,0,  0,1,0,
  ]);
  const indices=new Uint16Array([0,1,2]);
  const bin=Buffer.alloc(44);
  for(let i=0;i<vertices.length;i++)bin.writeFloatLE(vertices[i]!,i*4);
  for(let i=0;i<indices.length;i++)bin.writeUInt16LE(indices[i]!,36+i*2);
  const gltf={
    asset:{version:'2.0'},
    scene:0,scenes:[{nodes:[0]}],
    nodes:[{name:'FixtureMesh',mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,mode:4}]}],
    buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36,target:34962},
      {buffer:0,byteOffset:36,byteLength:6,target:34963}],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:'VEC3',
        min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5123,count:3,type:'SCALAR',
        min:[0],max:[2]},
    ],
  };
  const json=Buffer.from(JSON.stringify(gltf),'utf8');
  const jsonLength=Math.ceil(json.length/4)*4;
  const dataLength=Math.ceil(bin.length/4)*4;
  const out=Buffer.alloc(12+8+jsonLength+8+dataLength,0);
  out.write('glTF',0,'ascii');
  out.writeUInt32LE(2,4);
  out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(jsonLength,12);
  out.writeUInt32LE(0x4e4f534a,16);
  json.copy(out,20);
  out.fill(0x20,20+json.length,20+jsonLength);
  const offset=20+jsonLength;
  out.writeUInt32LE(dataLength,offset);
  out.writeUInt32LE(0x004e4942,offset+4);
  bin.copy(out,offset+8);
  return out;
}

async function main(){
  const targetArg=process.argv[2];
  if(!targetArg||process.argv.length!==3)
    throw Error('Usage: node --experimental-strip-types make-fixture.ts <output-dir>');
  const output=resolve(targetArg);
  const temp=await mkdtemp(join(tmpdir(),'godot-headless-fixture-'));
  try{
    const library=await ProjectLibrary.open(temp,undefined,findGenerator);
    await library.create('world','Godot CI world');
    await library.importAsset('fixture-tree','Triangle model','glb',triangleGlb());
    await library.createAsset('fixture-material',{
      name:'Fixture PBR surface',generator:'roof-clay',masterSeed:19,
      components:{pattern:19,color:47},
    });
    const mapFile=join(temp,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(mapFile,'utf8'));
    map.objects=[
      {id:'tree_a',definition:'asset:fixture-tree',position:[12,24],rotation:90},
      {id:'tree_b',definition:'asset:fixture-tree',position:[20,30],rotation:-45},
      {id:'well',definition:'object.well',position:[40,60],rotation:0},
    ];
    // Real Map System coverage: collision-bearing terrain, a road overlay
    // and terrain-derived sea geometry, all from the exported map source.
    map.terrain.surface_materials={
      [map.terrain.surface_palette[0]]:{asset:'asset:fixture-material',tile_size:4},
    };
    map.roads=[{id:'ci_road',definition:'road.gravel',width:3,
      points:[[8,10],[90,10]]}];
    map.water=[{id:'ci_sea',definition:'water.sea',height:1}];
    await writeFile(mapFile,JSON.stringify(map,null,2)+'\n');
    const exported=await library.exportGodotScene('world');
    if(!exported.published||exported.manifest.files.length<4)
      throw Error('Godot fixture did not produce a complete scene package');
    await mkdir(output,{recursive:true});
    await cp(exported.directory,output,{recursive:true});
    await writeFile(join(output,'project.godot'),
      'config_version=5\n\n[application]\nconfig/name="1400 CI Godot Scene"\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
    await copyFile(fileURLToPath(new URL('./verify_scene.gd',import.meta.url)),
      join(output,'verify_scene.gd'));
    await copyFile(fileURLToPath(new URL('./verify_map.gd',import.meta.url)),
      join(output,'verify_map.gd'));
    // Offline geometry is already part of world.tscn. CI deliberately does
    // NOT install or invoke the former Godot Map System runtime scripts.
    console.log('Godot scene fixture generated at '+output);
    console.log('Bundle fingerprint: '+exported.manifest.sourceKey);
  }finally{await rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
