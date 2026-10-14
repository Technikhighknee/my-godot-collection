// Pure, deterministic glTF 2.0 binary geometry writer. Consumes only the
// canonical model contract; no DOM, Three.js, renderer or generator IDs.
import type {CanonicalModel,CanonicalMaterial} from
  '../../tools/asset-procgen/web/canonical-model.mjs';

const bytesOf=(value:Float32Array|Uint32Array)=>
  new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
const align4=n=>(n+3)&~3;
const linear=v=>{
  v/=255;
  return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
};
function materialOf(m:CanonicalMaterial){
  const rgb=m.baseColor;
  const srgb=[(rgb>>>16)&255,(rgb>>>8)&255,rgb&255];
  return {
    name:m.name,
    pbrMetallicRoughness:{
      baseColorFactor:[...srgb.map(linear),1],
      metallicFactor:0,roughnessFactor:m.roughness,
    },
    doubleSided:m.doubleSided,
    ...(m.slot||m.profile||m.tint!==undefined?{extras:{
      ...(m.slot?{resourceSlot:m.slot}:{}),
      ...(m.profile?{profile:m.profile}:{}),
      ...(m.tint!==undefined?{authoringTint:m.tint}:{}),
    }}:{}),
  };
}
export function encodeModelGlb(model:CanonicalModel):Uint8Array{
  if(model.format!=='devtool-canonical-model'||model.version!==1||
    !model.meshes.length)throw Error('Invalid canonical model');
  const binParts:Uint8Array[]=[];
  let binSize=0;
  const bufferViews:{buffer:number;byteOffset:number;byteLength:number;target:number}[]=[];
  const accessors:object[]=[];
  const meshes:object[]=[];
  const nodes:object[]=[];
  const materials:object[]=[];
  function accessor(data:Float32Array|Uint32Array,componentType:number,
    itemType:'SCALAR'|'VEC2'|'VEC3',target:number,bounds?:{
      min:number[];max:number[];
    }){
    while(binSize%4!==0){binParts.push(Uint8Array.of(0));binSize++;}
    const bytes=bytesOf(data);
    const index=bufferViews.length;
    bufferViews.push({buffer:0,byteOffset:binSize,byteLength:bytes.length,target});
    binParts.push(bytes);binSize+=bytes.length;
    const idx=accessors.length;
    accessors.push({bufferView:index,componentType,count:data.length/
      ({SCALAR:1,VEC2:2,VEC3:3}[itemType]),type:itemType,
      ...(bounds?{min:bounds.min,max:bounds.max}:{})});
    return idx;
  }
  for(const part of model.meshes){
    if(!(part.positions instanceof Float32Array)||
      !(part.normals instanceof Float32Array)||
      !(part.indices instanceof Uint32Array)||
      part.positions.length!==part.normals.length||
      part.positions.length%3!==0||!part.indices.length||
      part.indices.length%3!==0||
      !part.bounds||part.bounds.min.length!==3||part.bounds.max.length!==3)
      throw Error('Invalid geometry supplied to GLB writer');
    const attributes:{POSITION:number;NORMAL:number;TEXCOORD_0?:number;COLOR_0?:number}={
      POSITION:accessor(part.positions,5126,'VEC3',34962,part.bounds),
      NORMAL:accessor(part.normals,5126,'VEC3',34962),
    };
    if(part.uvs){
      // Authoring previews use Three.js flipY Canvas textures. glTF images
      // are top-left origin, so bake the equivalent UV convention once.
      const uv=new Float32Array(part.uvs);
      for(let i=1;i<uv.length;i+=2)uv[i]=1-uv[i];
      attributes.TEXCOORD_0=accessor(uv,5126,'VEC2',34962);
    }
    if(part.colors)
      attributes.COLOR_0=accessor(part.colors,5126,'VEC3',34962);
    const indices=accessor(part.indices,5125,'SCALAR',34963);
    const materialIndex=materials.length;
    materials.push(materialOf(part.material));
    const meshIndex=meshes.length;
    meshes.push({name:part.name,primitives:[{
      attributes,indices,material:materialIndex,mode:4,
    }]});
    nodes.push({name:part.name,mesh:meshIndex});
  }
  const buffer=new Uint8Array(align4(binSize));
  let cursor=0;
  for(const part of binParts){buffer.set(part,cursor);cursor+=part.length;}
  const gltf={
    asset:{version:'2.0',generator:'1400 Dev Tool'},
    scene:0,scenes:[{nodes:nodes.map((_,index)=>index)}],
    nodes,meshes,materials,bufferViews,accessors,
    buffers:[{byteLength:buffer.length}],
  };
  const text=new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength=align4(text.length),binLength=buffer.length;
  const total=12+8+jsonLength+8+binLength;
  const out=new Uint8Array(total),dv=new DataView(out.buffer);
  dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);
  dv.setUint32(8,total,true);
  dv.setUint32(12,jsonLength,true);dv.setUint32(16,0x4e4f534a,true);
  out.fill(0x20,20,20+jsonLength);out.set(text,20);
  const binHead=20+jsonLength;
  dv.setUint32(binHead,binLength,true);
  dv.setUint32(binHead+4,0x004e4942,true);
  out.set(buffer,binHead+8);
  return out;
}
