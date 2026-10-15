import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {buildSurfaceTransitions,buildWorldGeometry} from '../src/projects/map-geometry.ts';
import {paletteColor,surfaceAt} from '../tools/map-editor/web/mesh-data.mjs';
import {inflateSync} from 'node:zlib';

function glbMetadata(bytes:Buffer){
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLen=bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16),0x4e4f534a);
  return JSON.parse(bytes.toString('utf8',20,20+jsonLen));
}
test('offline map production outputs complete importable terrain, road and water meshes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'offline-map-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const file=join(dir,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(file,'utf8'));
    map.roads=[{id:'gravel',definition:'road.gravel',width:4,
      points:[[8,12],[70,12],[90,40]]}];
    map.water=[{id:'sea',definition:'water.sea',height:1}];
    await writeFile(file,JSON.stringify(map,null,2)+'\n');

    const portable=await lib.buildScene('world');
    assert.deepEqual(portable.manifest.geometry,{
      terrain:'geometry/terrain.glb',
      roads:'geometry/roads.glb',water:'geometry/water.glb',
    });
    for(const [name,meshName] of [['terrain','Terrain-col'],['roads','Roads'],['water','Water']] as const){
      const filePath=join(portable.directory,'geometry',name+'.glb');
      const glb=glbMetadata(await readFile(filePath));
      assert.equal(glb.nodes[0].name,meshName);
      assert.ok(glb.accessors[0].count>=3);
      const index=glb.meshes[0].primitives[0].indices;
      assert.ok(glb.accessors[index].count>=3,'A baked mesh must include triangle indices');
    }
    const terrain=glbMetadata(await readFile(join(portable.directory,'geometry','terrain.glb')));
    assert.equal(terrain.accessors[0].count,65*65);
    assert.equal(terrain.images[0].mimeType,'image/png');
    assert.equal(terrain.materials[0].pbrMetallicRoughness.baseColorTexture.index,0);
    assert.equal(terrain.samplers[0].minFilter,9728);
    const second=await lib.buildScene('world');
    assert.equal(second.published,false);
    assert.equal(second.manifest.key,portable.manifest.key);

    const exported=await lib.exportGodotScene('world');
    assert.equal(exported.published,true);
    const tscn=await readFile(join(exported.directory,'world.tscn'),'utf8');
    for(const name of ['terrain','roads','water']){
      assert.ok(tscn.includes('geometry/'+name+'.glb'));
      assert.deepEqual(await readFile(join(exported.directory,'geometry',name+'.glb')),
        await readFile(join(portable.directory,'geometry',name+'.glb')));
    }
    assert.match(tscn,/name="Geometry"/);
    assert.doesNotMatch(tscn,/GameMapBuilder|GameMapLoader|TerrainHeightField/);
    assert.equal((await lib.exportGodotScene('world')).published,false);

    map.roads[0].width=6;
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    const changed=await lib.exportGodotScene('world');
    assert.equal(changed.published,true);
    assert.notEqual(changed.manifest.sourceKey,exported.manifest.sourceKey);
  }finally{await rm(dir,{recursive:true,force:true});}
});


// Surface bindings are project references, not a second map-only generator.
// Their baked PBR maps are embedded in the same portable geometry that Godot imports.
test('offline terrain uses shared project material PBR outputs and invalidates scene keys',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'material-map-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const recipe={name:'Clay',generator:'roof-clay',masterSeed:17,
      components:{pattern:17,color:23}};
    const saved=await lib.createAsset('clay',recipe);
    const file=join(dir,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(file,'utf8'));
    const surface=map.terrain.surface_palette[0];
    map.terrain.surface_materials={
      [surface]:{asset:'asset:clay',tile_size:4},
    };
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    const first=await lib.buildScene('world');
    assert.deepEqual(first.manifest.resources.map(r=>r.id),['clay']);
    const glb=glbMetadata(await readFile(join(first.directory,'geometry','terrain.glb')));
    assert.ok(glb.extensionsUsed.includes('KHR_texture_transform'));
    const textured=glb.materials.find((m:any)=>m.extras?.assetResourceId==='clay');
    assert.ok(textured,'Terrain must use actual saved project material');
    assert.equal(textured.extras.surfaceDefinition,surface);
    assert.equal(textured.extras.tileSize,4);
    assert.ok(textured.pbrMetallicRoughness.baseColorTexture);
    assert.ok(textured.pbrMetallicRoughness.metallicRoughnessTexture);
    assert.ok(textured.normalTexture);
    assert.equal(textured.pbrMetallicRoughness.baseColorTexture.extensions
      .KHR_texture_transform.scale[0],map.terrain.size[0]/4);
    assert.equal(glb.images.length,3,'Baked albedo, normal and roughness are all embedded');
    assert.equal(glb.meshes[0].primitives.length,
      new Set((await lib.mapWorkspace()!.getDocument().surfaces.data)).size);
    const cached=await lib.buildScene('world');
    assert.equal(cached.published,false);
    const exported=await lib.exportGodotScene('world');
    assert.deepEqual(await readFile(join(exported.directory,'geometry','terrain.glb')),
      await readFile(join(first.directory,'geometry','terrain.glb')));
    const updated=await lib.updateAsset('clay',{...recipe,components:{
      pattern:17,color:24,
    }},saved.revision);
    assert.ok(updated.revision!==saved.revision);
    const changed=await lib.buildScene('world');
    assert.notEqual(changed.manifest.key,first.manifest.key,
      'Only the changed shared material invalidates this scene');
    const unrelated=await lib.createAsset('other',{...recipe,name:'Other'});
    assert.ok(unrelated.revision);
    assert.equal((await lib.buildScene('world')).published,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('map surface material references and profiles fail explicitly',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'invalid-material-map-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const file=join(dir,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(file,'utf8'));
    const key=map.terrain.surface_palette[0];
    map.terrain.surface_materials={[key]:{asset:'asset:missing',tile_size:2}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/Missing map material dependency/);
    map.terrain.surface_materials={[key]:{asset:'asset:missing',tile_size:0}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/tile_size/);
    map.terrain.surface_materials={[key]:{asset:'asset:missing',tile_size:2,
      profile:'nonexistent'}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/Missing map material dependency/);
    await lib.createAsset('oak',{name:'Oak',generator:'timber-oak',masterSeed:10,
      components:{grain:10,color:12}});
    map.terrain.surface_materials={[key]:{asset:'asset:oak',tile_size:2}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/valid explicit profile/);
    map.terrain.surface_materials={[key]:{asset:'asset:oak',tile_size:2,profile:'beam'}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    const built=await lib.buildScene('world');
    assert.equal(built.manifest.resources[0]?.id,'oak');
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('feathered map material boundaries bake reproducible GLB visual geometry, not collision',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'terrain-feather-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const ws=lib.mapWorkspace()!,doc=ws.getDocument();
    assert.deepEqual(buildSurfaceTransitions(doc),[],
      'A uniform surface needs no transition mesh');
    const painted=Uint8Array.from(doc.surfaces.data);
    // A 4x4 patch creates straight boundaries and four corners.
    for(let z=23;z<27;z++)for(let x=24;x<28;x++)
      painted[z*doc.surfaces.width+x]=1;
    await ws.saveDocument({roads:doc.map.roads,surfaces:painted},
      ws.getRevision(),ws.getFile());
    const transitions=buildSurfaceTransitions(ws.getDocument());
    assert.deepEqual(transitions.map(t=>t.definition),
      ['terrain.grass','terrain.dirt']);
    assert.deepEqual(buildSurfaceTransitions(ws.getDocument()),transitions,
      'Transition geometry must be independent of build order');
    for(const t of transitions){
      assert.equal(t.mesh.positions.length/3,t.opacity.length);
      assert.equal(t.mesh.uv!.length,t.opacity.length*2);
      assert.ok(t.opacity.includes(0.5),'Seams must meet at 50% coverage');
      assert.ok(t.opacity.includes(0),'Feathers must end at zero coverage');
      assert.ok(t.opacity.every(x=>x>=0&&x<=0.5));
      assert.ok(t.mesh.indices.length>0);
    }
    await lib.createAsset('clay',{name:'Clay',generator:'roof-clay',
      masterSeed:27,components:{pattern:27,color:39}});
    const saved=ws.getDocument().map;
    await ws.saveSettings({name:saved.name,
      min_height:saved.terrain.min_height,max_height:saved.terrain.max_height,
      surface_palette:saved.terrain.surface_palette,
      surface_materials:{'terrain.grass':{asset:'asset:clay',tile_size:4}}},
      ws.getRevision(),ws.getFile());
    const first=await lib.buildScene('world');
    const file=await readFile(join(first.directory,'geometry','terrain.glb'));
    const gltf=glbMetadata(file);
    assert.deepEqual(gltf.scenes[0].nodes,[0,1]);
    assert.equal(gltf.nodes[0].name,'Terrain-col');
    assert.equal(gltf.nodes[1].name,'TerrainTransitions',
      'The overlay must not be marked for static collision');
    assert.equal(gltf.meshes.length,2);
    assert.equal(gltf.meshes[1].primitives.length,2);
    const baseCount=gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION].count;
    assert.equal(baseCount,doc.heights.width*doc.heights.height,
      'Only the original terrain mesh retains the collidable heightfield');
    for(const primitive of gltf.meshes[1].primitives){
      const attr=primitive.attributes;
      assert.equal(gltf.accessors[attr.COLOR_0].type,'VEC4');
      assert.equal(gltf.accessors[attr.POSITION].count,
        gltf.accessors[attr.COLOR_0].count);
      const overlay=gltf.materials[primitive.material];
      assert.equal(overlay.alphaMode,'BLEND');
      assert.equal(overlay.extras.surfaceTransition,true);
      assert.equal(overlay.doubleSided,true);
      assert.ok(overlay.pbrMetallicRoughness.baseColorFactor);
    }
    assert.ok(gltf.meshes[1].primitives.some((p:any)=>
      gltf.materials[p.material].pbrMetallicRoughness.baseColorTexture),
      'Project PBR maps must be reused in the transition overlays');
    assert.equal((await lib.buildScene('world')).published,false);
    const exported=await lib.exportGodotScene('world');
    assert.deepEqual(await readFile(join(exported.directory,
      'geometry','terrain.glb')),file,
      'Godot must receive the identical blended scene geometry');
  }finally{await rm(dir,{recursive:true,force:true});}
});


// GLB binary payload checks instead of only checking that the PNG and UVs
// exist. This covers the complete PNG->GLB seam that once mirrored paint in
// Godot while leaving the heightfield unchanged.
function glbBinary(bytes:Buffer,manifest:any):Buffer{
  const jsonLength=bytes.readUInt32LE(12);
  const offset=20+jsonLength;
  assert.equal(bytes.readUInt32LE(offset+4),0x004e4942);
  const length=bytes.readUInt32LE(offset);
  assert.equal(manifest.buffers[0].byteLength,length);
  return bytes.subarray(offset+8,offset+8+length);
}
function floatAttribute(bytes:Buffer,manifest:any,accessorId:number):number[]{
  const accessor=manifest.accessors[accessorId];
  const view=manifest.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType,5126,'Expected float32 glTF accessor');
  const dimensions=accessor.type==='VEC2'?2:accessor.type==='VEC3'?3:0;
  assert.ok(dimensions>0);
  const binary=glbBinary(bytes,manifest);
  const offset=view.byteOffset+(accessor.byteOffset??0);
  return Array.from({length:accessor.count*dimensions},(_,i)=>
    binary.readFloatLE(offset+i*4));
}
function embeddedRgbaPng(bytes:Buffer,manifest:any):Uint8Array{
  const image=manifest.images[0];
  assert.equal(image.mimeType,'image/png');
  const view=manifest.bufferViews[image.bufferView];
  const binary=glbBinary(bytes,manifest);
  const png=binary.subarray(view.byteOffset,view.byteOffset+view.byteLength);
  assert.equal(png.toString('ascii',12,16),'IHDR');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  assert.equal(png[25],6,'The palette is stored as RGBA8');
  const blocks:Buffer[]=[];
  for(let p=8;p<png.length;){
    const len=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8);
    if(type==='IDAT')blocks.push(png.subarray(p+8,p+8+len));
    p+=len+12;
    if(type==='IEND')break;
  }
  const raw=inflateSync(Buffer.concat(blocks));
  const imageBytes=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++){
    assert.equal(raw[y*(width*4+1)],0,'Palette PNG must use filter 0');
    imageBytes.set(raw.subarray(y*(width*4+1)+1,(y+1)*(width*4+1)),y*width*4);
  }
  return imageBytes;
}

test('asymmetric painted surfaces retain exact editor world orientation in Godot GLB',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-uv-orientation-'));
  try{
    const library=await ProjectLibrary.open(dir,undefined,findGenerator);
    await library.create('world','World');
    const workspace=library.mapWorkspace()!,doc=workspace.getDocument();
    const surface=new Uint8Array(doc.surfaces.data.length);
    const w=doc.surfaces.width,h=doc.surfaces.height;
    // Different colors in unambiguous corners: a flipped vertical UV changes
    // the sampled paint even though the terrain positions remain identical.
    surface[1*w+3]=1;                // Near (x=3,z=1)
    surface[(h-4)*w+(w-6)]=2;        // Far opposite corner
    await workspace.saveDocument({roads:doc.map.roads,surfaces:surface},
      workspace.getRevision(),workspace.getFile());
    const saved=workspace.getDocument();
    const baked=buildWorldGeometry(saved);
    const firstVertex=(z:number,x:number)=>z*saved.heights.width+x;
    assert.deepEqual(Array.from(baked.terrain.uv!.slice(
      firstVertex(0,0)*2,firstVertex(0,0)*2+2)),[0,0]);
    assert.deepEqual(Array.from(baked.terrain.uv!.slice(
      firstVertex(h,w)*2,firstVertex(h,w)*2+2)),[1,1]);
    const scene=await library.exportGodotScene('world');
    const bytes=await readFile(join(scene.directory,'geometry','terrain.glb'));
    const gltf=glbMetadata(bytes);
    const primitive=gltf.meshes[0].primitives[0];
    const uv=floatAttribute(bytes,gltf,primitive.attributes.TEXCOORD_0);
    assert.deepEqual(uv.slice(0,2),[0,0]);
    assert.deepEqual(uv.slice(-2),[1,1]);
    assert.equal(uv[firstVertex(0,Math.floor(w/2))*2+1],0);
    assert.equal(uv[firstVertex(h,Math.floor(w/2))*2+1],1);
    const pixels=embeddedRgbaPng(bytes,gltf);
    for(const [x,z] of [[3,1],[w-6,h-4],[3,h-4],[w-6,1]]){
      const index=surfaceAt(saved.map.terrain,saved.surfaces,
        (x+0.5)*saved.map.terrain.size[0]/w,
        (z+0.5)*saved.map.terrain.size[1]/h);
      const [r,g,b]=paletteColor(saved.map.terrain.surface_palette[index]);
      const actual=Array.from(pixels.slice((z*w+x)*4,(z*w+x)*4+4));
      assert.deepEqual(actual,[r,g,b].map(v=>Math.round(v*255)).concat(255));
    }
    // Material feather UVs must use the identical top-left convention.
    const transitions=buildSurfaceTransitions(saved);
    assert.ok(transitions.length>0);
    for(const {mesh} of transitions){
      for(let i=0;i<mesh.uv!.length;i+=2){
        const x=mesh.positions[i/2*3],z=mesh.positions[i/2*3+2];
        assert.ok(Math.abs(mesh.uv![i]-x/saved.map.terrain.size[0])<1e-5);
        assert.ok(Math.abs(mesh.uv![i+1]-z/saved.map.terrain.size[1])<1e-5);
      }
    }
    assert.equal((await library.exportGodotScene('world')).published,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
