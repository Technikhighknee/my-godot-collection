import {encodeRgbaPng} from './build-image.ts';
import {buildWorldGeometry,type WorldMesh}
  from './map-geometry.ts';
import type {MapDocument} from '../../tools/map-editor/src/core/map.ts';
import {paletteColor} from '../../tools/map-editor/web/mesh-data.mjs';

// Engine-neutral glTF binary writer: geometry is already computed offline.
// No Godot SDK, editor preview or runtime mesh algorithm participates.
interface MeshStyle {
  name:string;
  color:[number,number,number,number];
  collision?:boolean;
  image?:{width:number;height:number;rgba:Uint8Array};
}
export interface SurfaceMaterialTextures {
  assetId:string; profile:string; tileSize:number;
  albedo:Buffer; normal:Buffer; roughness:Buffer;
}
interface SurfaceLayer {
  definition:string;indices:Uint32Array;color:[number,number,number,number];
  material?:SurfaceMaterialTextures;
}
const four=(n:number)=>(n+3)&~3;
const text=(s:string)=>Buffer.from(s,'utf8');
export function writeWorldGlb(mesh:WorldMesh,style:MeshStyle,
  layers?:readonly SurfaceLayer[],styleScaleX=1,styleScaleZ=1):Buffer{
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
  const primitives:any[]=[];
  if(!layers){
    const indexAccessor=accessors.length;
    const indexBuf=Buffer.from(indices.buffer,indices.byteOffset,indices.byteLength);
    const indexView=bytes(indexBuf,34963);
    accessors.push({bufferView:indexView,componentType:5125,count:indices.length,type:'SCALAR'});
    const primitive:any={attributes:{POSITION:positionAccessor,NORMAL:normalAccessor},
      indices:indexAccessor,material:0,mode:4};
    if(uvAccessor!==undefined)primitive.attributes.TEXCOORD_0=uvAccessor;
    primitives.push(primitive);
  }
  const gltf:any={
    asset:{version:'2.0',generator:'1400 Offline Map Production'},
    scenes:[{nodes:[0]}],scene:0,
    nodes:[{name:style.name+(style.collision?'-col':''),mesh:0}],
    meshes:[{name:style.name,primitives}],
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
  if(layers){
    if(!uv)throw Error('Material-baked terrain must include UVs');
    gltf.materials=[];
    const textureCache=new Map<string,number>();
    gltf.images=[];
    gltf.textures=[];
    gltf.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
    let hasTextures=false;
    function channelTexture(material:SurfaceMaterialTextures,
      channel:'albedo'|'normal'|'roughness'):number{
      const key=material.assetId+'/'+material.profile+'/'+channel;
      const cached=textureCache.get(key);
      if(cached!==undefined)return cached;
      const png=material[channel];
      if(png.length<24||!png.subarray(0,8).equals(
        Buffer.from([137,80,78,71,13,10,26,10])))
        throw Error('Invalid scene material PNG: '+key);
      const bufferView=bytes(png);
      const image=gltf.images.length;
      gltf.images.push({bufferView,mimeType:'image/png',name:key});
      const index=gltf.textures.length;
      gltf.textures.push({sampler:0,source:image});
      textureCache.set(key,index);
      return index;
    }
    for(const layer of layers){
      if(!layer.indices.length||layer.indices.length%3)
        throw Error('Invalid surface material triangle group');
      for(const i of layer.indices)if(i>=vertexCount)
        throw Error('Invalid surface material vertex index');
      const buffer=Buffer.from(layer.indices.buffer,
        layer.indices.byteOffset,layer.indices.byteLength);
      const view=bytes(buffer,34963),accessor=accessors.length;
      accessors.push({bufferView:view,componentType:5125,
        count:layer.indices.length,type:'SCALAR'});
      const materialIndex=gltf.materials.length;
      const pbr:any={baseColorFactor:layer.material?[1,1,1,1]:layer.color,
        metallicFactor:0,roughnessFactor:1};
      const surface:any={name:layer.definition,doubleSided:true,
        pbrMetallicRoughness:pbr,
        extras:{surfaceDefinition:layer.definition}};
      if(layer.material){
        hasTextures=true;
        const source=layer.material;
        const transform={scale:[styleScaleX/source.tileSize,
          styleScaleZ/source.tileSize]};
        const info=(channel:'albedo'|'normal'|'roughness')=>({
          index:channelTexture(source,channel),
          extensions:{KHR_texture_transform:transform},
        });
        pbr.baseColorTexture=info('albedo');
        pbr.metallicRoughnessTexture=info('roughness');
        surface.normalTexture={...info('normal'),scale:1};
        Object.assign(surface.extras,{
          assetResourceId:source.assetId,profile:source.profile,
          tileSize:source.tileSize,
        });
      }
      gltf.materials.push(surface);
      gltf.meshes[0].primitives.push({
        attributes:{POSITION:positionAccessor,NORMAL:normalAccessor,
          TEXCOORD_0:uvAccessor},
        indices:accessor,material:materialIndex,mode:4,
      });
    }
    if(!primitives.length)throw Error('Empty surface material geometry');
    if(hasTextures)gltf.extensionsUsed=['KHR_texture_transform'];
    else{
      delete gltf.images;delete gltf.textures;delete gltf.samplers;
    }
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
export function bakeMapBinaries(doc:MapDocument,
  materials:ReadonlyMap<number,SurfaceMaterialTextures>=new Map()):MapBinaries{
  const world=buildWorldGeometry(doc);
  let layers:SurfaceLayer[]|undefined;
  if(materials.size){
    const indices=Array.from({length:doc.map.terrain.surface_palette.length},
      ()=>[] as number[]);
    for(let cell=0;cell<doc.surfaces.data.length;cell++){
      const bucket=indices[doc.surfaces.data[cell]];
      for(let n=cell*6;n<cell*6+6;n++)bucket.push(world.terrain.indices[n]);
    }
    layers=indices.flatMap((array,index)=>{
      if(!array.length)return [];
      const definition=doc.map.terrain.surface_palette[index];
      const [r,g,b]=paletteColor(definition);
      return [{
        definition,indices:Uint32Array.from(array),
        color:[r,g,b,1] as [number,number,number,number],
        ...(materials.has(index)?{material:materials.get(index)!}:{}),
      }];
    });
  }
  const binaries:MapBinaries={
    terrain:writeWorldGlb(world.terrain,{
      name:'Terrain',collision:true,color:[1,1,1,1],
      ...(layers?{}:{image:{width:world.surfaceWidth,height:world.surfaceHeight,
        rgba:world.surfacePixels}}),
    },layers,doc.map.terrain.size[0],doc.map.terrain.size[1]),
  };
  if(world.roads)binaries.roads=writeWorldGlb(world.roads,{
    name:'Roads',color:[0.37,0.31,0.24,1],
  });
  if(world.water)binaries.water=writeWorldGlb(world.water,{
    name:'Water',color:[0.12,0.34,0.64,0.72],
  });
  return binaries;
}
