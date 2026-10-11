import test from 'node:test';
import assert from 'node:assert/strict';
import {generateOakBark,generateOakBarkMaterial,
  generateOakBarkMaterialSet,OAK_BARK_MAPS,OAK_BARK_PROFILES,
  paintGeneratedOakBarkMap}
  from '../tools/asset-procgen/web/oak-bark.mjs';
import {generateTree}
  from '../tools/asset-procgen/web/tree.mjs';
import {mapOakBarkWood,OAK_BARK_UV_SCALE}
  from '../tools/asset-procgen/web/oak-bark-uv.mjs';

const base={structureSeed:19641,surfaceSeed:48507,colorSeed:21749,size:64};

test('three maturity profiles share seeds but have graduated relief',()=>{
  assert.deepEqual(OAK_BARK_PROFILES,['trunk','limb','young']);
  const set=generateOakBarkMaterialSet(base);
  const again=generateOakBarkMaterialSet(base);
  const variance=(field:Float32Array)=>{
    let sum=0,sum2=0;
    for(const v of field){sum+=v;sum2+=v*v;}
    const mean=sum/field.length;
    return sum2/field.length-mean*mean;
  };
  assert.ok(variance(set.trunk.heightField)>variance(set.limb.heightField)*1.5);
  assert.ok(variance(set.limb.heightField)>variance(set.young.heightField)*2);
  for(const profile of OAK_BARK_PROFILES){
    const mat=set[profile];
    assert.deepEqual(mat,again[profile]);
    assert.equal(mat.profile,profile);
    assert.deepEqual(mat,generateOakBarkMaterial({...base,profile}));
    assert.equal(mat.height,base.size);
    assert.equal(mat.heightMap.length,base.size*base.size*4);
  }
  assert.throws(()=>generateOakBark({size:64,profile:'unknown' as never}),
    /Unknown oak bark profile/);
});

test('a single reproducible relief drives all five properly packed PBR maps',()=>{
  const material=generateOakBarkMaterial(base);
  const repeat=generateOakBarkMaterial(base);
  const original=generateOakBark(base);
  assert.deepEqual(material.albedo,original.pixels);
  assert.deepEqual(material.heightField,original.heightField);
  assert.equal(material.normalConvention,'opengl');
  assert.deepEqual([material.width,material.height],
    [base.size,base.size],'Texture dimensions must remain numeric');
  assert.deepEqual(OAK_BARK_MAPS,
    ['albedo','normal','roughness','ao','height']);
  for(const name of OAK_BARK_MAPS){
    const pixels=name==='height'?material.heightMap:material[name];
    const expected=name==='height'?repeat.heightMap:repeat[name];
    assert.deepEqual(pixels,expected);
    assert.equal(pixels.length,base.size*base.size*4);
    for(let i=3;i<pixels.length;i+=4)
      assert.equal(pixels[i],255);
  }
  for(let i=0;i<material.heightField.length;i++){
    assert.ok(material.heightField[i]>=0&&material.heightField[i]<=1);
    assert.equal(material.heightMap[i*4],Math.round(material.heightField[i]*255));
    const x=material.normal[i*4]/255*2-1;
    const y=material.normal[i*4+1]/255*2-1;
    const z=material.normal[i*4+2]/255*2-1;
    assert.ok(Math.abs(Math.hypot(x,y,z)-1)<.016,
      'Packed tangent-space normals remain unit length');
    assert.ok(z>0,'Normals must face out of the tangent plane');
    const rough=material.roughness[i*4];
    assert.ok(rough>=170&&rough<=250);
    assert.equal(rough,material.roughness[i*4+1]);
    assert.equal(rough,material.roughness[i*4+2]);
    const occlusion=material.ao[i*4];
    assert.ok(occlusion>=130&&occlusion<=255);
  }
  assert.ok(new Set(material.roughness.filter((_,i)=>i%4===0)).size>5);
  assert.ok(new Set(material.ao.filter((_,i)=>i%4===0)).size>5);
});

test('pigmentation has no influence on geometry, normals, roughness or AO',()=>{
  const first=generateOakBarkMaterial(base);
  const changed=generateOakBarkMaterial({...base,colorSeed:98333});
  assert.notDeepEqual(changed.albedo,first.albedo);
  for(const profile of OAK_BARK_PROFILES){
    const a=generateOakBarkMaterial({...base,profile});
    const b=generateOakBarkMaterial({...base,profile,colorSeed:98333});
    assert.notDeepEqual(a.albedo,b.albedo);
    for(const key of ['heightField','heightMap','normal','roughness','ao'] as const)
      assert.deepEqual(a[key],b[key],key);
  }
  const cracks=generateOakBarkMaterial({...base,structureSeed:98333});
  assert.notDeepEqual(cracks.heightField,first.heightField);
  const surface=generateOakBarkMaterial({...base,surfaceSeed:98333});
  assert.notDeepEqual(surface.heightField,first.heightField);
});

test('the inspector paints any material map without regenerating its seeds',()=>{
  const material=generateOakBarkMaterial(base);
  const captured:{bytes?:Uint8ClampedArray}={};
  const canvas={
    width:0,height:0,
    getContext:(_type:string)=>({
      createImageData:(width:number,height:number)=>({
        data:new Uint8ClampedArray(width*height*4),
      }),
      putImageData:(image:{data:Uint8ClampedArray})=>{
        captured.bytes=image.data.slice();
      },
    }),
  } as unknown as HTMLCanvasElement;
  for(const name of OAK_BARK_MAPS){
    assert.deepEqual(paintGeneratedOakBarkMap(canvas,material,name),
      {width:64,height:64,map:name,seamless:true});
    assert.deepEqual(captured.bytes,name==='height'?material.heightMap:material[name]);
  }
  assert.deepEqual([canvas.width,canvas.height],[64,64]);
  assert.throws(()=>paintGeneratedOakBarkMap(canvas,material,'invalid' as never),
    /Unknown bark/);
  assert.throws(()=>paintGeneratedOakBarkMap(canvas,{
    ...material,heightMap:new Uint8ClampedArray(0),
  },'height'),/Invalid bark material/);
});

test('oak mapping preserves the accepted growth mesh and duplicates render seams',()=>{
  for(const seed of [0,19641,882239]){
    const wood=generateTree({seed});
    const snapshot={
      positions:wood.positions.slice(),normals:wood.normals.slice(),
      indices:wood.indices.slice(),
    };
    const mapped=mapOakBarkWood(wood);
    assert.equal(mapped.indices.length,wood.indices.length);
    assert.ok(mapped.positions.length>wood.positions.length);
    assert.equal(mapped.positions.length,mapped.normals.length);
    assert.equal(mapped.positions.length/3*2,mapped.uvs.length);
    assert.ok(mapped.uvs.every(Number.isFinite));
    assert.ok(mapped.indices.every(i=>i<mapped.positions.length/3));
    assert.deepEqual(wood.positions,snapshot.positions);
    assert.deepEqual(wood.normals,snapshot.normals);
    assert.deepEqual(wood.indices,snapshot.indices);
    assert.deepEqual(mapOakBarkWood(wood),mapped);
    assert.equal(mapped.groups.length,wood.branches.filter(b=>!b.continuation).length);
    const counts=new Set(mapped.groups.map(g=>g.profile));
    assert.ok(counts.has('trunk')&&counts.has('young'));
    let groupOffset=0;
    for(const group of mapped.groups){
      assert.equal(group.start,groupOffset);
      assert.ok(group.count>0&&group.count%3===0);
      assert.equal(group.materialIndex,OAK_BARK_PROFILES.indexOf(group.profile));
      groupOffset+=group.count;
    }
    assert.equal(groupOffset,mapped.indices.length);
    for(let i=0;i<mapped.indices.length;i+=3){
      const uv=Array.from(mapped.indices.slice(i,i+3),index=>[
        mapped.uvs[index*2],mapped.uvs[index*2+1]]);
      const us=uv.map(u=>u[0]);
      // Each face stays local in UV space rather than stretching
      // horizontally across the cylindrical seam.
      assert.ok(Math.max(...us)-Math.min(...us)<.65,'UV seam stretched');
      for(const pair of uv)
        assert.ok(pair.every(Number.isFinite));
    }
    assert.equal(mapped.uvScale,OAK_BARK_UV_SCALE);
  }
});

test('oak bark preview uses PBR textures, leaves the fir material unchanged',async()=>{
  const source=await import('node:fs/promises');
  const pathname=new URL('../tools/asset-procgen/web/viewport-3d.mjs',
    import.meta.url);
  const code=await source.readFile(pathname,'utf8');
  for(const token of ['generateOakBarkMaterialSet','map:maps.albedo',
    'normalMap:maps.normal','roughnessMap:maps.roughness','aoMap:maps.ao',
    'THREE.RepeatWrapping','uv1','disposeBark','geometry.addGroup'])
    assert.ok(code.includes(token),token);
  assert.ok(code.includes('asset.barkWood??asset.wood'));
});
