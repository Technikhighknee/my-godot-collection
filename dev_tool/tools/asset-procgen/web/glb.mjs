// Self-contained glTF 2.0 / GLB writer for our two-primitive PBR assets.
// No exporter runtime dependencies: identical input produces identical bytes.
import { validateRecipe } from './tree.mjs';

const FLOAT = 5126, UNSIGNED_INT = 5125;
const align4 = value => (value+3)&~3;
const encoder = new TextEncoder();
function finiteBounds(array) {
  if(!(array instanceof Float32Array) || array.length===0 || array.length%3)throw new Error('Invalid vertex positions');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<array.length;i++){
    const v=array[i];
    if(!Number.isFinite(v))throw new Error('Nonfinite geometry value');
    const k=i%3;min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);
  }
  return { min,max };
}
export function exportGlb(generated) {
  if(!generated || !generated.model)throw new Error('Missing generated model');
  const recipe=validateRecipe(generated.recipe);
  const chunks=[],bufferViews=[],accessors=[];
  let size=0;
  function accessor(data,componentType,type,target,bounds) {
    const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    const offset=align4(size);
    chunks.push({offset,bytes:new Uint8Array(bytes)});
    const bufferView=bufferViews.length;
    bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});
    const item={bufferView,componentType,count:data.length/(type==='VEC3'?3:1),type};
    if(bounds){item.min=bounds.min;item.max=bounds.max;}
    accessors.push(item);
    size=offset+bytes.length;
    return accessors.length-1;
  }
  const primitives=[];
  for(const [idx,key] of ['wood','foliage'].entries()){
    const mesh=generated.model[key];
    if(!mesh || !(mesh.positions instanceof Float32Array) || !(mesh.normals instanceof Float32Array) ||
       !(mesh.colors instanceof Float32Array) || !(mesh.indices instanceof Uint32Array))
      throw new Error('Invalid generated mesh: '+key);
    const bounds=finiteBounds(mesh.positions),count=mesh.positions.length;
    if(mesh.normals.length!==count||mesh.colors.length!==count||mesh.indices.length%3)
      throw new Error('Invalid generated mesh attribute lengths');
    for(const attr of [mesh.normals,mesh.colors])
      for(const value of attr)if(!Number.isFinite(value))throw new Error('Nonfinite geometry attribute');
    for(const index of mesh.indices)
      if(index>=count/3)throw new Error('Mesh index out of bounds');
    const position=accessor(mesh.positions,FLOAT,'VEC3',34962,bounds);
    const normal=accessor(mesh.normals,FLOAT,'VEC3',34962);
    const color=accessor(mesh.colors,FLOAT,'VEC3',34962);
    const indices=accessor(mesh.indices,UNSIGNED_INT,'SCALAR',34963);
    primitives.push({attributes:{POSITION:position,NORMAL:normal,COLOR_0:color},indices,material:idx,mode:4});
  }
  const binary=new Uint8Array(align4(size));
  for(const {offset,bytes} of chunks)binary.set(bytes,offset);
  const gltf={
    asset:{version:'2.0',generator:'1400 Asset ProcGen / '+recipe.generator},
    scene:0, scenes:[{nodes:[0]}],
    nodes:[{name:recipe.name,mesh:0}],
    meshes:[{name:recipe.name,primitives}],
    materials:[
      {name:'Bark',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}},
      {name:'Leaves',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.95}}
    ],
    accessors,bufferViews,buffers:[{byteLength:binary.length}],
    extras:{recipe}
  };
  const json=encoder.encode(JSON.stringify(gltf));
  const jsonSize=align4(json.length),binSize=binary.length;
  const total=12+8+jsonSize+8+binSize;
  const output=new Uint8Array(total),view=new DataView(output.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  view.setUint32(12,jsonSize,true);view.setUint32(16,0x4e4f534a,true);
  output.fill(0x20,20,20+jsonSize);output.set(json,20);
  const binHeader=20+jsonSize;
  view.setUint32(binHeader,binSize,true);view.setUint32(binHeader+4,0x004e4942,true);
  output.set(binary,binHeader+8);
  return output;
}
export function inspectGlb(bytes) {
  // Small strict structural validator, useful for tests and exported-file verification.
  if(!(bytes instanceof Uint8Array) || bytes.byteLength<28)throw new Error('Truncated GLB');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length)
    throw new Error('Invalid GLB header');
  const jsonLength=view.getUint32(12,true);
  if(view.getUint32(16,true)!==0x4e4f534a||jsonLength%4||jsonLength===0)throw new Error('Invalid GLB JSON chunk');
  const offset=20+jsonLength;
  if(offset+8>bytes.length)throw new Error('Truncated GLB chunks');
  const binaryLength=view.getUint32(offset,true);
  if(view.getUint32(offset+4,true)!==0x004e4942||offset+8+binaryLength!==bytes.length||binaryLength%4)
    throw new Error('Invalid GLB BIN chunk');
  const gltf=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,offset)));
  if(gltf.asset?.version!=='2.0'||gltf.buffers?.[0]?.byteLength!==binaryLength)
    throw new Error('Invalid glTF asset');
  for(const a of gltf.accessors??[]){
    const b=gltf.bufferViews?.[a.bufferView];
    if(!b || b.byteOffset<0 || b.byteLength<0 || b.byteOffset+b.byteLength>binaryLength)
      throw new Error('Invalid glTF buffer view');
    const components=a.type==='VEC3'?3:a.type==='SCALAR'?1:0;
    const bytesPer=a.componentType===FLOAT||a.componentType===UNSIGNED_INT?4:0;
    if(!components||!bytesPer||a.count*components*bytesPer!==b.byteLength)
      throw new Error('Invalid glTF accessor');
  }
  return gltf;
}
