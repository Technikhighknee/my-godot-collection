import { randomStream } from './math.mjs';
import { growOak } from './growth.mjs';
import { meshWood,meshFoliage } from './meshing.mjs';

export const RECIPE_SCHEMA='1400.asset.recipe';
export const GENERATOR='oak';
// The number is recipe metadata, never part of class or generator names.
export const GENERATOR_REVISION=2;
export const DEFAULT_RECIPE=Object.freeze({
  schema:RECIPE_SCHEMA,generator:GENERATOR,revision:GENERATOR_REVISION,
  name:'Oak 01',seed:147241,
  parameters:{height:12,crownRadius:4.4,trunkRadius:.43,branchDensity:.70,leafDensity:.84,asymmetry:.62}
});
const limits={
  height:[3,24],crownRadius:[1,11],trunkRadius:[.12,1.1],
  branchDensity:[.2,1],leafDensity:[.15,1],asymmetry:[0,1]
};
export function validateRecipe(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join()!=='generator,name,parameters,revision,schema,seed'||
    value.schema!==RECIPE_SCHEMA||value.generator!==GENERATOR||
    value.revision!==GENERATOR_REVISION||typeof value.name!=='string'||
    !value.name.trim()||value.name.length>60||
    !Number.isInteger(value.seed)||value.seed<0||value.seed>0xffffffff)
    throw new Error('Unsupported or invalid asset recipe');
  const p=value.parameters;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join()!==Object.keys(limits).sort().join())
    throw new Error('Invalid generator parameters');
  for(const [name,[min,max]] of Object.entries(limits))
    if(typeof p[name]!=='number'||!Number.isFinite(p[name])||p[name]<min||p[name]>max)
      throw new Error('Invalid parameter: '+name);
  if(p.trunkRadius>p.crownRadius*.62)throw new Error('Trunk radius exceeds crown proportions');
  return {
    schema:RECIPE_SCHEMA,generator:GENERATOR,revision:GENERATOR_REVISION,
    name:value.name.trim(),seed:value.seed,
    parameters:Object.fromEntries(Object.keys(limits).map(k=>[k,p[k]]))
  };
}
export function variantSeeds(seed){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid seed');
  const rnd=randomStream(seed,0,71),list=new Set();
  while(list.size<4){const value=Math.floor(rnd()*0x100000000)>>>0;if(value!==seed)list.add(value);}
  return [...list];
}
export function generateSkeleton(recipe){
  return growOak(validateRecipe(recipe));
}
export function generateTree(recipe,{detail='full'}={}){
  const r=validateRecipe(recipe);
  const skeleton=growOak(r);
  const wood=meshWood(skeleton,r,detail);
  const foliage=meshFoliage(skeleton,r);
  const triangles=(wood.indices.length+foliage.mesh.indices.length)/3;
  if(triangles>200000)throw new Error('Geometry complexity limit exceeded');
  return {recipe:r,skeleton,model:{wood,foliage:foliage.mesh},
    stats:{
      branches:skeleton.branches.length,
      leaves:foliage.leaves,
      clusters:skeleton.leafAnchors.length,
      triangles,
      vertices:(wood.positions.length+foliage.mesh.positions.length)/3
    }
  };
}
