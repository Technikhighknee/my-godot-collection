import type { TreeSkeleton, TreeRecipe, Vec3 } from './tree.mjs';

export interface WoodPrimitive {
  a:Vec3;
  b:Vec3;
  dx:number;dy:number;dz:number;len2:number;
  ra:number;rb:number;
  id:number;parent:number|null;root:Vec3;
  generation:number;isRoot:boolean;
  min:Vec3;max:Vec3;
}
export function buildWoodPrimitives(skeleton:TreeSkeleton,recipe:TreeRecipe,step:number):WoodPrimitive[];
export function woodDistance(segment:WoodPrimitive,x:number,y:number,z:number):number;
