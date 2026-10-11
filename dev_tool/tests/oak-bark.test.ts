import test from 'node:test';
import assert from 'node:assert/strict';
import {OAK_BARK_SIZE,generateOakBark,paintOakBark}
  from '../tools/asset-procgen/web/oak-bark.mjs';

test('mature oak bark is reproducible opaque RGBA with finite relief',()=>{
  assert.equal(OAK_BARK_SIZE,1024);
  for(const seed of [0,1,19641,0xffffffff]){
    const options={structureSeed:seed,surfaceSeed:48507,
      colorSeed:21749,size:96};
    const a=generateOakBark(options),b=generateOakBark(options);
    assert.deepEqual(a.pixels,b.pixels);
    assert.deepEqual(a.heightField,b.heightField);
    assert.deepEqual([a.width,a.height],[96,96]);
    assert.equal(a.pixels.length,96*96*4);
    assert.equal(a.heightField.length,96*96);
    for(let i=0;i<a.heightField.length;i++){
      assert.ok(Number.isFinite(a.heightField[i]));
      assert.ok(a.heightField[i]!>=0&&a.heightField[i]!<=1);
      assert.equal(a.pixels[i*4+3],255);
    }
    const colors=Array.from(a.pixels.filter((_,i)=>i%4===0));
    const range=Math.max(...colors)-Math.min(...colors);
    assert.ok(range>=25&&range<=100,
      'Bark pigmentation needs variation without painted black fissures');
  }
});

test('oak bark is made of directional cracks, not a repeated band grid',()=>{
  const size=256;
  for(const profile of ['trunk','limb','young'] as const){
    const {heightField}=generateOakBark({size,profile});
    let across=0,along=0;
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){
      const p=y*size+x;
      across+=Math.abs(heightField[p+1]!-heightField[p]!);
      along+=Math.abs(heightField[p+size]!-heightField[p]!);
    }
    assert.ok(across>along*1.15,
      'Fissures should run preferentially along the growing wood axis: '+profile);
  }
  // A crack network must vary with the structure seed without changing
  // its pigmentation or the entire surface into equally spaced strips.
  const first=generateOakBark({size,structureSeed:19641});
  const next=generateOakBark({size,structureSeed:19642});
  assert.notDeepEqual(first.heightField,next.heightField);
  const crossings=new Set<number>();
  for(let y=0;y<size;y+=11){
    let crossingsInRow=0;
    for(let x=1;x<size-1;x++){
      const p=y*size+x;
      if(first.heightField[p]!<first.heightField[p-1]!&&
        first.heightField[p]!<first.heightField[p+1]!&&
        first.heightField[p]!<.39)crossingsInRow++;
    }
    crossings.add(crossingsInRow);
  }
  assert.ok(crossings.size>=4,
    'Cracks must appear, end, fork and interrupt instead of forming static stripes');
});

test('oak bark components vary independently by seed',()=>{
  const options={structureSeed:19641,surfaceSeed:48507,colorSeed:21749,size:128};
  const base=generateOakBark(options);
  const color=generateOakBark({...options,colorSeed:12});
  const surface=generateOakBark({...options,surfaceSeed:12});
  const structure=generateOakBark({...options,structureSeed:12});
  assert.deepEqual(color.heightField,base.heightField,
    'Pigmentation may not affect geometry-like relief');
  assert.notDeepEqual(color.pixels,base.pixels);
  assert.notDeepEqual(surface.heightField,base.heightField);
  assert.notDeepEqual(structure.heightField,base.heightField);
  assert.deepEqual(generateOakBark(options).pixels,base.pixels);
});

test('oak bark is edge-continuous and has no repeated hard seam',()=>{
  const n=256,pixels=generateOakBark({size:n}).pixels;
  let edgeHorizontal=0,edgeVertical=0,adjacentHorizontal=0,adjacentVertical=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)for(let c=0;c<3;c++){
    const at=(y*n+x)*4+c;
    if(x===0)edgeHorizontal+=Math.abs(pixels[at]!-
      pixels[(y*n+n-1)*4+c]!);
    if(y===0)edgeVertical+=Math.abs(pixels[at]!-
      pixels[((n-1)*n+x)*4+c]!);
    if(x<n-1)adjacentHorizontal+=Math.abs(pixels[at]!-
      pixels[at+4]!);
    if(y<n-1)adjacentVertical+=Math.abs(pixels[at]!-
      pixels[at+n*4]!);
  }
  const seamX=edgeHorizontal/(n*3),seamY=edgeVertical/(n*3);
  const normalX=adjacentHorizontal/(n*(n-1)*3);
  const normalY=adjacentVertical/(n*(n-1)*3);
  assert.ok(seamX<normalX*1.8,
    'Horizontal repeat edge too visible: '+seamX+'/'+normalX);
  assert.ok(seamY<normalY*1.8,
    'Vertical repeat edge too visible: '+seamY+'/'+normalY);
});

test('bark generator rejects invalid dimensions or seed values',()=>{
  for(const value of [-1,4294967296,NaN,Infinity,2.3]){
    assert.throws(()=>generateOakBark({structureSeed:value}));
    assert.throws(()=>generateOakBark({surfaceSeed:value}));
    assert.throws(()=>generateOakBark({colorSeed:value}));
  }
  for(const size of [0,15,1025,Infinity,NaN,64.5])
    assert.throws(()=>generateOakBark({size}));
});

test('bark albedo paints into Canvas without image imports',()=>{
  const capture:{data?:Uint8ClampedArray}={};
  const canvas={
    width:0,height:0,
    getContext(kind:string){
      assert.equal(kind,'2d');
      return {
        createImageData(w:number,h:number){
          assert.deepEqual([w,h],[OAK_BARK_SIZE,OAK_BARK_SIZE]);
          return {data:new Uint8ClampedArray(w*h*4)};
        },
        putImageData(value:{data:Uint8ClampedArray},x:number,y:number){
          assert.deepEqual([x,y],[0,0]);
          capture.data=value.data;
        },
      };
    },
  } as unknown as HTMLCanvasElement;
  const metadata=paintOakBark(canvas);
  assert.deepEqual(metadata,{width:1024,height:1024,
    channels:'RGBA',seamless:true});
  assert.deepEqual([canvas.width,canvas.height],[1024,1024]);
  assert.equal(capture.data?.length,1024*1024*4);
  assert.throws(()=>paintOakBark(null as never),/Invalid oak bark canvas/);
});
