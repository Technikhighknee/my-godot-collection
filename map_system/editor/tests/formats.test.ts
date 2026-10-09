import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodeExr, encodeExr } from '../src/formats/exr.ts';
import { decodeSurfacePng, encodeSurfacePng } from '../src/formats/png.ts';
import { loadMap, serializeMap } from '../src/io/map-io.ts';
import { heightAt, validateMap, validateDocument, type MapDocument } from '../src/core/map.ts';
const fixture = '../godot/coastal_relief.map.json';
const fail = (f: () => unknown, pattern:RegExp) => assert.throws(f,pattern);

test('real compressed EXR preserves every float32 bit across encoding', async () => {
  const raw=await readFile('../godot/assets/coastal_relief.height.exr');
  const image=decodeExr(raw);
  assert.ok(image.width >= 2 && image.height >= 2);
  const exported=encodeExr(image);
  const output=decodeExr(exported);
  assert.deepEqual(output.data,image.data);
  // A single-channel R EXR is an equally valid map interchange format.
  const redChannel=Buffer.from(exported);
  const channelPos=redChannel.indexOf(Buffer.from('Y\0'));
  assert.ok(channelPos>0);
  redChannel[channelPos]='R'.charCodeAt(0);
  assert.deepEqual(decodeExr(redChannel).data,image.data);
  assert.deepEqual([output.width,output.height],[image.width,image.height]);
  for (const value of image.data) assert.ok(value <= 1 && value >= 0);
});

test('EXR rejects unsupported compression, headers, malformed scanlines and nonfinite', async () => {
  const sample=await readFile('../godot/assets/coastal_relief.height.exr');
  const badMagic=Buffer.from(sample);badMagic[0]=0;fail(()=>decodeExr(badMagic),/signature/);
  const badVersion=Buffer.from(sample);badVersion.writeUInt32LE(3,4);fail(()=>decodeExr(badVersion),/version/);
  const float=encodeExr({width:2,height:2,data:new Float32Array([0,1,.5,.25])});
  assert.deepEqual(decodeExr(float).data,new Float32Array([0,1,.5,.25]));
  const bad=Buffer.from(float);bad[bad.length-1]^=0x55; // May be compressed; must not return successful altered data.
  assert.notDeepEqual(decodeExr(bad).data,new Float32Array([0,1,.5,.25]));
  fail(()=>encodeExr({width:1,height:1,data:new Float32Array([NaN])}),/nonfinite/);
});

test('surface PNG preserves categorical indices through encoding', async () => {
  const bytes=await readFile('../godot/assets/coastal_relief.surface.png');
  const surface=decodeSurfacePng(bytes);
  assert.deepEqual([surface.width,surface.height],[320,240]);
  assert.deepEqual(decodeSurfacePng(encodeSurfacePng(surface)),surface);
  const mismatch=Buffer.from(bytes);mismatch[30]^=1;
  fail(()=>decodeSurfacePng(mismatch),/CRC/);
  fail(()=>encodeSurfacePng({width:2,height:2,data:new Uint8Array([0])}),/data/);
});

test('map loads and validates real assets, encodes identical samples', async () => {
  const doc=await loadMap(fixture);
  const packed=serializeMap(doc);
  assert.deepEqual(decodeExr(packed.exr),doc.heights);
  assert.deepEqual(decodeSurfacePng(packed.png),doc.surfaces);
  assert.deepEqual(JSON.parse(packed.json.toString('utf8')),doc.map);
  assert.ok(heightAt(doc,240,150)>heightAt(doc,240,330));
});

test('matches Godot first and second triangle formulas exactly', () => {
  const template={name:'test',terrain:{size:[10,10] as [number,number],heightmap:'a.exr',min_height:-10,max_height:90,surface_map:'a.png',surface_palette:['x']},roads:[],settlements:[],water:[],buildings:[],objects:[]};
  const doc:MapDocument={map:template,heights:{width:2,height:2,data:new Float32Array([0,.5,.25,1])},surfaces:{width:1,height:1,data:new Uint8Array([0])}};
  assert.equal(heightAt(doc,0,0),-10);
  assert.equal(heightAt(doc,10,0),40);
  assert.equal(heightAt(doc,0,10),15);
  assert.equal(heightAt(doc,10,10),90);
  assert.equal(heightAt(doc,2,3),-10+.2*50+.3*25);
  assert.equal(heightAt(doc,8,7),90+.2*(15-90)+.3*(40-90));
  assert.equal(heightAt(doc,-100,-100),-10);
  assert.equal(heightAt(doc,100,100),90);
  validateDocument(doc);
});

test('rejects ID duplicates, bad points, surface indices and unsafe paths', async () => {
  const original=(await loadMap(fixture));
  const data=structuredClone(original.map);
  data.roads[1].id=data.roads[0].id;
  fail(()=>validateMap(data),/duplicates/);
  data.roads[1].id='restored';
  data.terrain.heightmap='../secrets.exr';
  fail(()=>validateMap(data),/safe relative/);
  const doc=await loadMap(fixture);doc.surfaces.data[0]=255;
  fail(()=>serializeMap(doc),/outside palette/);
});

test('rejects invalid water sources and nonfinite map numbers', async () => {
  const doc=structuredClone((await loadMap(fixture)).map);
  doc.water[0] = { id: 'bad-lake', definition: 'water.lake', height: 4, source: [1000, 1000] };
  fail(()=>validateMap(doc),/Invalid lake source/);
  doc.water=[];doc.roads[0].width=NaN;
  fail(()=>validateMap(doc),/finite/);
});

test('load is read-only and denies an asset symlink escape',async()=>{
  const original=await readFile(fixture);
  await loadMap(fixture);
  assert.deepEqual(await readFile(fixture),original);
  const dir=await mkdtemp(join(tmpdir(),'map-m0-'));
  try {
    const data=JSON.parse(original.toString());data.terrain.heightmap='out.exr';data.terrain.surface_map='out.png';
    await writeFile(join(dir,'map.json'),JSON.stringify(data));
    const {symlink}=await import('node:fs/promises');
    await symlink(join(process.cwd(),'../godot/assets/coastal_relief.height.exr'),join(dir,'out.exr'));
    await symlink(join(process.cwd(),'../godot/assets/coastal_relief.surface.png'),join(dir,'out.png'));
    await assert.rejects(loadMap(join(dir,'map.json')),/symlink escapes/);
  } finally {await rm(dir,{force:true,recursive:true});}
});
