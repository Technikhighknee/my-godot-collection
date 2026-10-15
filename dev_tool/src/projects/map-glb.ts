import {encodeRgbaPng} from './build-image.ts';
import {buildWorldGeometry,type WorldMesh}
  from './map-geometry.ts';
import type {MapDocument} from '../../tools/map-editor/src/core/map.ts';

// Engine-neutral glTF binary writer: geometry is already computed offline.
// No Godot SDK, editor preview or runtime mesh algorithm participates.
interface MeshStyle {
  name:string;
  color:[number,number,number,number];
  collision?:boolean;
  image?:{width:number;height:number;rgba:Uint8Array};
}
const four=(n:number)=>(n+3)&~3;
const text=(s:string)=>Buffer.from(s,'utf8');
export function writeWorldGlb(mesh:WorldMesh,style:MeshStyle):Buffer{
  const {positions,indices,uv}=mesh;
  if(positions.length%3||indices.length%3||!indices.length||
    positions.length/3>10000000)throw Error('Invalid map mesh');
  if(uv&&uv.length!==positions.length/3*2)
    throw Error('Invalid map UV count');
  const vertexCount=positions.length/3;
  for(const v of positions)if(!Number.isFinite(v))throw Error('Non-finite map vertex');
  for(const i of indices)if(i>=vertexCount)throw Error('Invalid map mesh index');
  const parts:Buffer[]=[];
  const views:any[]=[];
  const accessors:any[]=[];
  let total=0;
  function bytes(data:Buffer,target?:number){
    const offset=total,view=views.length;
    parts.push(data);
    const pad=four(data.length)-data.length;
    if(pad)parts.push(Buffer.alloc(pad));
    total+=four(data.length);
    views.push({buffer:0,byteOffset:offset,byteLength:data.length,
      ...(target?{target}:{})});
    return view;
  }
  function floatAttribute(data:Float32Array,size:number){
    const b=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
    const view=bytes(b,34962),index=accessors.length;
    const min=Array(size).fill(Infinity),max=Array(size).fill(-Infinity);
    for(let i=0;i<data.length;i++) {const c=i%size;min[c]=Math.min(min[c],data[i]);max[c]=Math.max(max[c],data[i]);}
    accessors.push({bufferView:view,componentType:5126,count:data.length/size,
      type:size===3?'VEC3':'VEC2',min,max});
    return index;
  }
  const positionAccessor=floatAttribute(positions,3);
  const normal=new Float32Array(positions.length);
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ab=[positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]];
    const ac=[positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]];
    const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    for(const j of [a,b,c])for(let k=0;k<3;k++)normal[j+k]+=n[k];
  }
  for(let i=0;i<normal.length;i+=3){
    const len=Math.hypot(normal[i],normal[i+1],normal[i+2])||1;
    for(let c=0;c<3;c++)normal[i+c]/=len;
  }
  const normalAccessor=floatAttribute(normal,3);
  const uvAccessor=uv?floatAttribute(uv,2):undefined;
  const indexAccessor=accessors.length;
  const indexBuf=Buffer.from(indices.buffer,indices.byteOffset,indices.byteLength);
  const indexView=bytes(indexBuf,34963);
  accessors.push({bufferView:indexView,componentType:5125,count:indices.length,type:'SCALAR'});
  const primitive:any={attributes:{POSITION:positionAccessor,NORMAL:normalAccessor},
    indices:indexAccessor,material:0,mode:4};
  if(uvAccessor!==undefined)primitive.attributes.TEXCOORD_0=uvAccessor;
  const gltf:any={
    asset:{version:'2.0',generator:'1400 Offline Map Production'},
    scenes:[{nodes:[0]}],scene:0,
    nodes:[{name:style.name+(style.collision?'-col':''),mesh:0}],
    meshes:[{name:style.name,primitives:[primitive]}],
    buffers:[{byteLength:0}],bufferViews:views,accessors,
    materials:[{name:style.name,doubleSided:true,pbrMetallicRoughness:{
      baseColorFactor:style.color,metallicFactor:0,roughnessFactor:1},
      ...(style.color[3]<1?{alphaMode:'BLEND'}:{})}],
  };
  if(style.image){
    if(!uv)throw Error('Textured map geometry has no UVs');
    const png=encodeRgbaPng(style.image.width,style.image.height,style.image.rgba);
    const pngView=bytes(png);
    gltf.images=[{bufferView:pngView,mimeType:'image/png'}];
    gltf.samplers=[{magFilter:9728,minFilter:9728,wrapS:33071,wrapT:33071}];
    gltf.textures=[{sampler:0,source:0}];
    gltf.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};
  }
  gltf.buffers[0].byteLength=total;
  const json=text(JSON.stringify(gltf));
  const jsonLen=four(json.length);
  const out=Buffer.alloc(12+8+jsonLen+8+total);
  out.write('glTF',0,'ascii');
  out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(jsonLen,12);out.writeUInt32LE(0x4e4f534a,16);
  json.copy(out,20);
  out.fill(0x20,20+json.length,20+jsonLen);
  const off=20+jsonLen;
  out.writeUInt32LE(total,off);out.writeUInt32LE(0x004e4942,off+4);
  let cursor=off+8;
  for(const p of parts){p.copy(out,cursor);cursor+=p.length;}
  return out;
}
export interface MapBinaries {
  terrain:Buffer;roads?:Buffer;water?:Buffer;
}
export function bakeMapBinaries(doc:MapDocument):MapBinaries{
  const world=buildWorldGeometry(doc);
  const binaries:MapBinaries={
    terrain:writeWorldGlb(world.terrain,{
      name:'Terrain',collision:true,color:[1,1,1,1],
      image:{width:world.surfaceWidth,height:world.surfaceHeight,
        rgba:world.surfacePixels},
    }),
  };
  if(world.roads)binaries.roads=writeWorldGlb(world.roads,{
    name:'Roads',color:[0.37,0.31,0.24,1],
  });
  if(world.water)binaries.water=writeWorldGlb(world.water,{
    name:'Water',color:[0.12,0.34,0.64,0.72],
  });
  return binaries;
}
