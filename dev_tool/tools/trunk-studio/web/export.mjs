import { validateTrunk } from './trunk.mjs';

// Dependency-free PNG encoder (zlib stored blocks): deterministic in browser
// and Node. GLB contains the same bark pixels used in the viewport.
const encoder=new TextEncoder();
function be32(view,i,n){view.setUint32(i,n>>>0,false);}
function le32(view,i,n){view.setUint32(i,n>>>0,true);}
const concat=parts=>{
  const total=parts.reduce((n,a)=>n+a.byteLength,0),out=new Uint8Array(total);
  let p=0;for(const a of parts){out.set(a,p);p+=a.byteLength;}return out;
};
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let c=i;for(let n=0;n<8;n++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc(bytes){
  let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function pngChunk(kind,data){
  const type=encoder.encode(kind),bytes=new Uint8Array(data.length+12),v=new DataView(bytes.buffer);
  be32(v,0,data.length);bytes.set(type,4);bytes.set(data,8);
  be32(v,8+data.length,crc(bytes.subarray(4,8+data.length)));
  return bytes;
}
function imagePNG(pixels,size){
  if(pixels.length!==size*size*4)throw Error('Bad RGBA texture');
  const width=size*4+1,raw=new Uint8Array(width*size);
  for(let y=0;y<size;y++)raw.set(pixels.subarray(y*size*4,(y+1)*size*4),y*width+1);
  const chunks=[new Uint8Array([0x78,0x01])];
  let a=1,b=0;
  for(const x of raw){a=(a+x)%65521;b=(b+a)%65521;}
  for(let start=0;start<raw.length;start+=65535){
    const n=Math.min(65535,raw.length-start),packet=new Uint8Array(n+5);
    packet[0]=start+n===raw.length?1:0;
    packet[1]=n&255;packet[2]=n>>8;packet[3]=~n&255;packet[4]=(~n>>8)&255;
    packet.set(raw.subarray(start,start+n),5);chunks.push(packet);
  }
  const checksum=new Uint8Array(4);be32(new DataView(checksum.buffer),0,((b<<16)|a)>>>0);
  chunks.push(checksum);
  const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);
  be32(v,0,size);be32(v,4,size);ihdr[8]=8;ihdr[9]=6;
  return concat([
    new Uint8Array([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR',ihdr),pngChunk('IDAT',concat(chunks)),pngChunk('IEND',new Uint8Array())
  ]);
}
const align=n=>(n+3)&~3;
export function exportTrunkGlb(result){
  const recipe=validateTrunk(result?.recipe);
  const {positions,normals,uv,indices}=result.mesh;
  for(const a of [positions,normals,uv])if(!(a instanceof Float32Array)||!a.every(Number.isFinite))throw Error('Invalid geometry attributes');
  if(!(indices instanceof Uint32Array)||!indices.every(i=>i<positions.length/3))throw Error('Invalid indices');
  const images=[
    imagePNG(result.textures.albedo,result.textures.size),
    imagePNG(result.textures.normal,result.textures.size)
  ];
  const segments=[],views=[],accessors=[];let byteLength=0;
  function push(data,target){
    const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    const offset=align(byteLength),view=views.length;
    segments.push({offset,bytes});
    views.push({...{buffer:0,byteOffset:offset,byteLength:bytes.length},...(target?{target}:{})});
    byteLength=offset+bytes.length;return view;
  }
  function attr(data,size,type,target,bounds){
    const view=push(data,target),a={bufferView:view,componentType:type,
      count:data.length/size,type:size===3?'VEC3':size===2?'VEC2':'SCALAR'};
    if(bounds){a.min=bounds[0];a.max=bounds[1];}
    accessors.push(a);return accessors.length-1;
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++){const k=i%3;min[k]=Math.min(min[k],positions[i]);max[k]=Math.max(max[k],positions[i]);}
  const p=attr(positions,3,5126,34962,[min,max]),n=attr(normals,3,5126,34962);
  const t=attr(uv,2,5126,34962),ind=attr(indices,1,5125,34963);
  const imageViews=images.map(bytes=>push(bytes));
  const binary=new Uint8Array(align(byteLength));
  for(const {offset,bytes} of segments)binary.set(bytes,offset);
  const data={
    asset:{version:'2.0',generator:'1400 Trunk Studio'},
    scene:0,scenes:[{nodes:[0]}],
    nodes:[{mesh:0,name:recipe.name}],
    meshes:[{name:recipe.name,primitives:[{attributes:{POSITION:p,NORMAL:n,TEXCOORD_0:t},indices:ind,material:0,mode:4}]}],
    materials:[{name:'Oak bark',pbrMetallicRoughness:{
      baseColorFactor:[1,1,1,1],baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1
    },normalTexture:{index:1,scale:.80},doubleSided:false}],
    images:imageViews.map(view=>({bufferView:view,mimeType:'image/png'})),
    samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],
    textures:[{sampler:0,source:0},{sampler:0,source:1}],
    bufferViews:views,accessors,buffers:[{byteLength:binary.length}],
    extras:{recipe}
  };
  const json=encoder.encode(JSON.stringify(data)),padded=align(json.length);
  const bytes=new Uint8Array(12+8+padded+8+binary.length),dv=new DataView(bytes.buffer);
  le32(dv,0,0x46546c67);le32(dv,4,2);le32(dv,8,bytes.length);
  le32(dv,12,padded);le32(dv,16,0x4e4f534a);
  bytes.fill(32,20,20+padded);bytes.set(json,20);
  le32(dv,20+padded,binary.length);le32(dv,24+padded,0x004e4942);
  bytes.set(binary,28+padded);
  return bytes;
}
