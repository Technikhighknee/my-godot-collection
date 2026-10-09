export interface TreeParameters {
  height:number;crownRadius:number;trunkRadius:number;
  branchDensity:number;leafDensity:number;asymmetry:number;
}
export interface TreeRecipe {
  schema:'1400.asset.recipe';
  generator:'oak';
  revision:1;
  name:string;seed:number;parameters:TreeParameters;
}
export type Vec3=[number,number,number];
export interface StructuralBranch {
  id:number;parentId:number|null;generation:number;
  points:Vec3[];radii:number[];vigor:number;
}
export interface LeafAnchor {
  id:number;branchId:number;position:Vec3;direction:Vec3;
  normal:Vec3;size:number;light:number;vigor:number;
}
export interface TreeSkeleton { branches:StructuralBranch[];leafAnchors:LeafAnchor[]; }
export interface ProceduralMesh {
  positions:Float32Array;normals:Float32Array;colors:Float32Array;indices:Uint32Array;
}
export interface GeneratedTree {
  recipe:TreeRecipe;
  skeleton:TreeSkeleton;
  model:{wood:ProceduralMesh;foliage:ProceduralMesh};
  stats:{branches:number;leaves:number;clusters:number;triangles:number;vertices:number};
}
export const RECIPE_SCHEMA:'1400.asset.recipe';
export const GENERATOR:'oak';
export const GENERATOR_REVISION:1;
export const DEFAULT_RECIPE:Readonly<TreeRecipe>;
export function validateRecipe(value:unknown):TreeRecipe;
export function variantSeeds(seed:number):number[];
export function generateSkeleton(recipe:TreeRecipe):TreeSkeleton;
export function generateTree(recipe:TreeRecipe):GeneratedTree;
