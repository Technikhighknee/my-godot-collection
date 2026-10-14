// The immutable geometry contract between procedural models and exporters.
// This module never changes source meshes and does not depend on Three.js.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function geometry(name,input,material,groups){
  const positions=input.positions,normals=input.normals,indices=input.indices;
  const count=positions?.length/3;
  if(typeof name!=='string'||!name||
    !(positions instanceof Float32Array)||
    !(normals instanceof Float32Array)||
    !(indices instanceof Uint32Array)||
    !Number.isInteger(count)||count===0||normals.length!==positions.length||
    !indices.length||indices.length%3!==0)
    throw Error('Invalid canonical mesh geometry: '+name);
  if(input.uvs&&(!(input.uvs instanceof Float32Array)||
    input.uvs.length!==count*2))
    throw Error('Invalid canonical UVs: '+name);
  if(input.colors&&(!(input.colors instanceof Float32Array)||
    input.colors.length!==positions.length))
    throw Error('Invalid canonical vertex colors: '+name);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3)for(let j=0;j<3;j++){
    const v=positions[i+j],normal=normals[i+j];
    if(!finite(v)||!finite(normal))
      throw Error('Nonfinite canonical vertex: '+name);
    min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);
  }
  for(const attr of [input.uvs,input.colors])
    if(attr)for(const v of attr)if(!finite(v))
      throw Error('Nonfinite canonical vertex attribute: '+name);
  for(const index of indices)if(index>=count)
    throw Error('Out-of-range canonical index: '+name);
  if(!material||typeof material.name!=='string'||!material.name||
    !Number.isInteger(material.baseColor)||material.baseColor<0||
    material.baseColor>0xffffff||!finite(material.roughness)||
    material.roughness<0||material.roughness>1)
    throw Error('Invalid canonical material: '+name);
  if(groups){
    let end=0;
    for(const group of groups){
      if(!Number.isInteger(group.start)||!Number.isInteger(group.count)||
        group.start!==end||group.count<=0||group.count%3!==0||
        !Number.isInteger(group.materialIndex)||group.materialIndex<0||
        group.materialIndex>=3||
        !group.material||!Number.isInteger(group.material.baseColor))
        throw Error('Invalid canonical geometry groups: '+name);
      end+=group.count;
    }
    if(end!==indices.length)
      throw Error('Incomplete canonical geometry groups: '+name);
  }
  return {name,positions,normals,indices,
    ...(input.uvs?{uvs:input.uvs}:{}),
    ...(input.colors?{colors:input.colors}:{}),
    material, bounds:{min,max},...(groups?{groups}: {})};
}
// Bark rendering duplicates UV seam vertices, never the original growth
// topology. Preserve the render mesh and its author-assigned maturity groups.
export function canonicalOakWoodModel(asset){
  if(asset?.id!=='oak'||!asset.barkWood||!asset.barkSeeds||
    !asset.foliage||!asset.barkWood.groups?.length)
    throw Error('Expected complete UV-mapped oak wood and foliage source');
  const groups=asset.barkWood.groups.map(part=>({
    start:part.start,count:part.count,
    materialIndex:part.materialIndex,
    material:{
      name:'oak-bark-'+part.profile,
      baseColor:0xffffff,roughness:1,doubleSided:false,
      slot:'oakBark',profile:part.profile,
    },
  }));
  return {format:'devtool-canonical-model',version:1,
    meshes:[geometry('oak-wood',asset.barkWood,{
      name:'oak-bark',baseColor:0xffffff,roughness:1,
      doubleSided:false,
    },groups)]};
}
export function canonicalTreeModel(asset){
  if(asset.kind!=='model'||!asset.wood||asset.foliage)
    throw Error('Tree mesh adapter currently supports wood-only assets');
  if(asset.barkWood)throw Error('Bark-mapped trees require the PBR adapter');
  return {format:'devtool-canonical-model',version:1,
    meshes:[geometry('wood',asset.wood,{
      name:'wood',baseColor:0xa49c8e,roughness:.96,
      doubleSided:false,
    })]};
}
export function canonicalBuildingModel(asset,view='exterior'){
  if(!asset.building)throw Error('Expected generated building');
  if(view!=='exterior'&&view!=='interior')
    throw Error('Unknown building mesh view');
  const source=asset.building[view];
  if(!source)return null;
  const meshes=source.parts.map(part=>{
    if(!part.surface)throw Error('Missing explicit material declaration');
    // Preview fallback is authored by the generator, not inferred by exporters.
    const surface=part.surface;
    return geometry(part.material,part,{
      name:part.material,
      baseColor:surface.baseColor??0xffffff,
      roughness:surface.roughness??(surface.kind==='roof'?.98:.92),
      doubleSided:true,
      ...(surface.slot?{slot:surface.slot}:{}),
      ...(surface.profile?{profile:surface.profile}:{}),
      ...(surface.tint!==undefined?{tint:surface.tint}:{}),
    });
  });
  return {format:'devtool-canonical-model',version:1,meshes};
}
