import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BUILDING_OPTIONS,validateBuildingOptions,generateBuildingFamily}
  from '../tools/asset-procgen/web/building.mjs';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import type {BuildingOpening,BuildingMesh}
  from '../tools/asset-procgen/web/building.mjs';
import {buildingSurfaceKind}
  from '../tools/asset-procgen/web/building-materials.mjs';

const seeds={structure:19043,material:62191};
const signature=(o:BuildingOpening[])=>o.map(v=>[
  v.side,v.type,v.level,v.center,v.width,v.bottom,v.top,
].join(':'));
const allParts=(mesh:BuildingMesh)=>mesh.parts;

test('three levels share one procedural family and are deterministic',()=>{
  const definition=findGenerator('timber-building');
  assert.ok(definition);
  assert.equal(definition.kind,'model');
  assert.deepEqual(definition.defaultOptions,DEFAULT_BUILDING_OPTIONS);
  const sizes=[];
  for(let level=1;level<=3;level++){
    const a:ReturnType<typeof generateBuildingFamily>=
      generateAsset(definition,seeds,DEFAULT_BUILDING_OPTIONS,level);
    const b=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    assert.deepEqual(a,b);
    assert.equal(a.building.level,level);
    assert.equal(a.kind,'model');
    assert.ok(a.building.exterior.triangles>2000);
    assert.ok(a.building.exterior.triangles<16000,'Building stays game-sized');
    assert.equal(a.building.interior!==null,true);
    sizes.push(a.building.plan.width);
  }
  assert.deepEqual(sizes,[9,10,11]);
});

test('interior windows and doors are a strict subset of exterior openings',()=>{
  for(const level of [1,2,3]){
    const model=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    const {plan,exteriorOpenings,interiorOpenings}=model.building;
    const known=new Set(signature(exteriorOpenings));
    for(const opening of interiorOpenings){
      assert.ok(known.has(signature([opening])[0]),
        'Interior cannot invent an opening: '+JSON.stringify(opening));
      assert.equal(opening.level,0,'Detached interior shell is ground floor only');
    }
    assert.deepEqual(signature(interiorOpenings),
      signature(exteriorOpenings.filter(o=>o.level===0)));
    const expectedSides=level===1?['front']:['front','right'];
    assert.deepEqual(plan.doors.map(door=>door.side),expectedSides,
      'The side door must be present precisely when the service wing exists');
    assert.ok(plan.doors.every(door=>door.level===0),
      'All doors lead to a generated ground-floor room');
    assert.ok(plan.doors.every(door=>interiorOpenings.includes(door)),
      'Both the street entrance and the annex connection must remain accessible');
    assert.ok(!interiorOpenings.some(o=>o.type==='window'&&o.side==='front'&&Math.abs(o.center)<.76));
    assert.ok(model.building.interior!.triangles>200);
  }
});

test('model meshes stay finite, indexed and within a compact envelope',()=>{
  for(const level of [1,2,3]){
    const output=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    for(const mesh of [output.building.exterior,output.building.interior!]){
      assert.ok(mesh.parts.length>3);
      assert.ok(mesh.bounds.max.every((hi,i)=>hi>mesh.bounds.min[i]));
      let triangles=0;
      for(const part of allParts(mesh)){
        assert.equal(part.positions.length,part.normals.length);
        assert.equal(part.uvs.length,part.positions.length/3*2);
        assert.ok(part.uvs.every(Number.isFinite));
        assert.equal(part.positions.length%3,0);
        assert.equal(part.indices.length%3,0);
        assert.ok(part.positions.every(Number.isFinite));
        assert.ok(part.normals.every(Number.isFinite));
        assert.ok(part.indices.every(i=>i<part.positions.length/3));
        triangles+=part.indices.length/3;
      }
      assert.equal(triangles,mesh.triangles);
    }
    assert.ok(output.building.exterior.bounds.max[1]<25);
  }
});

test('interior can be disabled without affecting exterior geometry',()=>{
  const withShell=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,2);
  const none=generateBuildingFamily(seeds,{...DEFAULT_BUILDING_OPTIONS,
    interior:'none'},2);
  assert.equal(none.building.interior,null);
  assert.deepEqual(none.building.interiorOpenings,[]);
  assert.deepEqual(none.building.exterior,withShell.building.exterior);
  assert.deepEqual(none.building.exteriorOpenings,withShell.building.exteriorOpenings);
});

test('invalid family options and levels fail explicitly',()=>{
  assert.throws(()=>generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,4),
    /level/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,width:35}),
    /width/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,
    interior:'furnished'}),/Interior/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,
    furniture:true}),/options/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,
    roofPitch:NaN}),/roofPitch/);
});

test('seeded facade variation changes the exterior while preserving openings',()=>{
  const a=generateBuildingFamily({structure:1,material:7});
  const b=generateBuildingFamily({structure:2,material:7});
  assert.notDeepEqual(a.building.plan.windows.map(x=>x.center),
    b.building.plan.windows.map(x=>x.center));
  for(const model of [a,b]){
    const exterior=new Set(signature(model.building.exteriorOpenings));
    assert.ok(signature(model.building.interiorOpenings).every(x=>exterior.has(x)));
  }
  const recolored=generateBuildingFamily({structure:1,material:9});
  assert.deepEqual(a.building.exterior,recolored.building.exterior,
    'Changing a model material seed must not silently create a different roof texture');
  assert.deepEqual(a.building.exteriorOpenings,recolored.building.exteriorOpenings);
});

test('evolving building levels have architectural character, not just scaled boxes',()=>{
  const levels=[1,2,3].map(level=>
    generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level).building);
  const materials=(mesh:BuildingMesh)=>new Set(mesh.parts.map(part=>part.material));
  for(const level of levels){
    const used=materials(level.exterior);
    for(const name of ['timber','plasterWarm','stone','glass',level.level===1?'roofThatch':'roofClay'])
      assert.ok(used.has(name),'Expected architectural material '+name);
    assert.ok(level.exterior.parts.every(part=>part.uvs.length===
      part.positions.length/3*2));
  }
  assert.equal(levels[0].plan.wing,null,'First level is a simple core volume');
  assert.ok(levels[1].plan.wing,'Upgrades can add architectural volumes');
  assert.ok(levels[2].plan.wing);
  assert.ok(levels[2].plan.jetty>levels[1].plan.jetty);
  assert.ok(levels[2].exterior.triangles>levels[0].exterior.triangles);
  assert.ok(!materials(levels[0].interior!).has('gallery'));
  assert.ok(materials(levels[2].interior!).has('gallery'),
    'An established building should have structural interior circulation');
  assert.ok(levels[2].interior!.bounds.max[1]>levels[0].interior!.bounds.max[1]);
});

test('attached wing never blocks a facade window or invents an interior one',()=>{
  for(const level of [2,3]){
    const model=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    const plan=model.building.plan,wing=plan.wing!;
    assert.ok(!plan.windows.some(o=>o.side==='right'&&o.level<=1&&
      Math.abs(-o.center-wing.z)<wing.depth/2+.56));
    assert.equal(plan.doors.filter(o=>o.side==='right').length,1);
    assert.equal(model.building.interiorOpenings.length,
      plan.openings.filter(o=>o.level===0).length);
    assert.ok(model.building.interior!.parts.some(part=>
      part.material==='innerTimber'));
  }
});

test('authoring materials provide consistent wood, plaster and roof surfaces',()=>{
  assert.equal(buildingSurfaceKind('plasterIvory'),'plaster');
  assert.equal(buildingSurfaceKind('interior'),'plaster');
  assert.equal(buildingSurfaceKind('innerTimber'),'wood');
  assert.equal(buildingSurfaceKind('innerTrim'),'wood');
  assert.equal(buildingSurfaceKind('gallery'),'wood');
  assert.equal(buildingSurfaceKind('roofUnderlay'),'roof');
  assert.equal(buildingSurfaceKind('tileMoss'),'roof');
  assert.equal(buildingSurfaceKind('interiorPlinth'),'stone');
  assert.equal(buildingSurfaceKind('metal'),null);
});


test('roof tiles run ridge-to-eave on both slopes and the offset wing',()=>{
  // CanvasTexture.flipY=true maps its top image row to larger texture V.
  // Textures are authored with the rounded tile tips pointing down the
  // image, so each roof quad must decrease V toward the physical eave.
  for(const level of [1,2,3]){
    const exterior=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level)
      .building.exterior;
    const roof=exterior.parts.find(part=>part.material===
      (level===1?'roofThatch':'roofClay'));
    assert.ok(roof);
    const expectedQuads=level===1?2:4; // Two main slopes + two wing slopes
    assert.equal(roof.uvs.length,expectedQuads*8);
    for(let q=0;q<expectedQuads;q++){
      const at=q*8,p=q*12;
      const ridgeV=roof.uvs[at+1],eaveV=roof.uvs[at+3];
      assert.ok(eaveV<ridgeV,'UV must move down the texture at the eave');
      assert.ok(Math.abs(roof.uvs[at+5]-eaveV)<1e-5,
        'Same texture V along the eave');
      assert.ok(Math.abs(roof.uvs[at+7]-ridgeV)<1e-5,
        'Same texture V along the ridge');
      const run=roof.positions[p+3]-roof.positions[p];
      const fall=roof.positions[p+4]-roof.positions[p+1];
      const expected=Math.hypot(run,fall)*.55;
      assert.ok(Math.abs((ridgeV-eaveV)-expected)<1e-4,
        'Use the current roof slope length, not absolute world X');
      assert.ok(roof.uvs[at+4]>roof.uvs[at],
        'Texture U must follow the roof ridge front to back');
    }
  }
});


test('individual beams vary crop and tint while their grain follows the axis',()=>{
  for(const level of [1,2,3]){
    const building=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level).building;
    const exterior=building.exterior;
    const timber=exterior.parts.find(p=>p.material==='timber')!;
    const ends=exterior.parts.find(p=>p.material==='timberEnd')!;
    const panels=exterior.parts.find(p=>p.material==='timberPanel')!;
    assert.ok(timber&&ends&&panels,'Dedicated wood surface groups must exist');
    assert.ok(timber.colors&&ends.colors&&panels.colors);
    const offsets=new Set<string>(),tints=new Set<string>();
    assert.equal(timber.uvs.length%32,0,'Four side faces per lengthwise section');
    assert.ok(ends.uvs.length<=timber.uvs.length/2,
      'Long beams add side strips, but only two end faces each');
    assert.equal(ends.uvs.length%16,0,'Each beam has two end faces');
    assert.ok(ends.uvs.every(uv=>uv>=0&&uv<=1),'End grain uses local cap UVs');
    for(let beam=0;beam<timber.uvs.length/32;beam++){
      const i=beam*32;
      const first=timber.uvs.slice(i,i+8);
      const [u0,v0,u1,v1,u2,v2,u3,v3]=first;
      assert.ok(Math.abs(u0-u1)<.35,
        'UV drift must stay gentle enough to preserve lengthwise wood fibers');
      assert.ok(Math.abs(v1-v2)<1e-5,'V constant across far edge');
      assert.ok(Math.abs(u2-u3)<.35,'Same controlled drift at opposite edge');
      assert.ok(Math.abs(v0-v3)<1e-5,'V constant at near end');
      assert.ok(v1>v0,'V follows the length of every beam');
      // Compare vertices at the same longitudinal position: U may drift
      // between the beginning and end of a long beam section.
      assert.ok(Math.abs(u2-u1)>.01,'Beam side must have usable width');
      assert.ok(Math.abs(u3-u0)>.01,'Beam near end must have usable width');
      assert.ok(Math.abs((u2-u1)-(u3-u0))<1e-5,
        'Both beam ends must preserve the same width during UV dephasing');
      offsets.add([u0,v0].map(x=>x.toFixed(3)).join(':'));
      const c=timber.colors!.slice(beam*48,beam*48+3);
      tints.add([...c].map(x=>x.toFixed(3)).join(':'));
    }
    assert.ok(offsets.size>35,'Per-beam texture sampling must be distinct');
    assert.ok(tints.size>35,'Per-beam tint must vary subtly');
    assert.ok(exterior.parts.filter(p=>p.material.startsWith('timber')).length<=3,
      'Variation must not create per-beam material instances');
    for(const part of [timber,ends,panels])
      assert.equal(part.colors!.length,part.positions.length);
    // All profiles still use the same project material; no extra
    // dependencies or texture assets are needed for individual beams.
  }
});

test('interior beams and broad wood have matching dedicated material groups',()=>{
  const mesh=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,3).building.interior!;
  for(const kind of ['innerTimber','innerTimberEnd','innerTimberPanel']){
    const part=mesh.parts.find(p=>p.material===kind);
    assert.ok(part,kind+' must be generated');
    assert.equal(part.colors?.length,part.positions.length);
  }
  const other=generateBuildingFamily({...seeds,structure:19234},
    DEFAULT_BUILDING_OPTIONS,3).building.exterior;
  const a=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,3).building.exterior;
  const timber=(m:BuildingMesh)=>m.parts.find(p=>p.material==='timber')!;
  assert.notDeepEqual(timber(a).uvs,timber(other).uvs);
  assert.notDeepEqual(timber(a).colors,timber(other).colors);
});


test('long beams preserve crisp grain, continuous tint and no full tile repetition',()=>{
  const mesh=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,3)
    .building.exterior;
  const side=mesh.parts.find(p=>p.material==='timber')!;
  const caps=mesh.parts.find(p=>p.material==='timberEnd')!;
  assert.ok(side.colors&&caps.colors);
  const strips=side.uvs.length/32;
  let adjacent=0,gradient=0,maxSpan=0;
  const runs:{v0:number;v1:number;u:number;start:number[];end:number[]}[][]=[];
  let run:typeof runs[number]=[];
  for(let j=0;j<strips;j++){
    const uv=j*32,p=j*48;
    const [u0,v0,u1,v1,u2,v2,u3,v3]=side.uvs.slice(uv,uv+8);
    // Unwarped wood grain: no sideways drifting, squeezing or distortion.
    assert.ok(Math.abs(u0-u1)<1e-6,'U must stay fixed along the grain');
    assert.ok(Math.abs(u2-u3)<1e-6,'Opposite edge must stay parallel');
    assert.ok(Math.abs(v0-v3)<1e-5&&Math.abs(v1-v2)<1e-5);
    assert.ok(v1>v0&&Math.abs(u2-u1)>.01);
    const start=[...side.positions.slice(p,p+3)];
    const end=[...side.positions.slice(p+3,p+6)];
    const previous=run[run.length-1];
    if(previous&&Math.hypot(...start.map((n,i)=>n-previous.end[i]))>1e-5){
      runs.push(run);
      run=[];
    }
    if(previous&&run.length){
      adjacent++;
      assert.ok(Math.abs(previous.v1-v0)<1e-5,
        'Adjacent sections must share the same texture coordinates');
      assert.ok(Math.abs(previous.u-u0)<1e-6);
      for(let c=0;c<3;c++)
        assert.ok(Math.abs(side.colors[p-48+3+c]-side.colors[p+c])<1e-5,
          'Color variation must be smooth between sections');
    }
    gradient+=Math.abs(side.colors[p]-side.colors[p+3]);
    run.push({start,end,u:u0,v0,v1});
  }
  if(run.length)runs.push(run);
  assert.equal(runs.length,caps.uvs.length/16,
    'Every beam has one UV run and two actual end faces');
  const longRuns=runs.filter(run=>run.length>=3);
  assert.ok(longRuns.length>10&&adjacent>30);
  for(const run of runs){
    const span=run[run.length-1]!.v1-run[0]!.v0;
    maxSpan=Math.max(maxSpan,span);
    assert.ok(span>0&&span<=.92001,
      'A single beam should never repeat the full timber tile');
  }
  assert.ok(maxSpan>.85,'Long joists should still use most of the wood texture');
  assert.ok(gradient>.1,'Macro tint variation remains visible');
  assert.equal(mesh.parts.filter(p=>p.material==='timber').length,1,
    'All beams must still share the same material');
  assert.ok(mesh.triangles<13000);
});


test('rubble stone uses readable foundation-scale UVs, without changing plaster',()=>{
  for(let level=1;level<=3;level++){
    const mesh=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level)
      .building.exterior;
    for(const [name,expected] of [
      ['foundation',.35],['stone',.35],['plaster',.85],
    ] as const){
      const part=mesh.parts.find(p=>p.material===name);
      assert.ok(part,'Building requires '+name);
      const pos=part.positions,uv=part.uvs;
      assert.equal(uv.length,pos.length/3*2);
      let checked=0;
      for(let i=0;i+11<pos.length;i+=12){
        const length=Math.hypot(
          pos[i+3]!-pos[i]!,pos[i+4]!-pos[i+1]!,
          pos[i+5]!-pos[i+2]!);
        if(length<.0001)continue;
        const mapped=Math.hypot(
          uv[i/3*2+2]!-uv[i/3*2]!,
          uv[i/3*2+3]!-uv[i/3*2+1]!);
        assert.ok(Math.abs(mapped/length-expected)<.0001,
          name+' texture mapping must stay physically consistent');
        checked++;
      }
      assert.ok(checked>3,'Test all faces of '+name);
    }
  }
});
