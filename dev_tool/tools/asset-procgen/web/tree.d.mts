export interface TreeParameters {
  height:number;
  crownRadius:number;
  trunkRadius:number;
  branchDensity:number;
  leafDensity:number;
  asymmetry:number;
}
export interface TreeRecipe {
  schema:'1400.asset.recipe.v1';
  generator:'tree.oak.v2';
  revision:2;
  name:string;
  seed:number;
  parameters:TreeParameters;
}
export interface ProceduralMesh {
  positions:Float32Array;
  normals:Float32Array;
  colors:Float32Array;
  indices:Uint32Array;
}
export interface GeneratedTree {
  recipe:TreeRecipe;
  model:{wood:ProceduralMesh;foliage:ProceduralMesh};
  stats:{branches:number;leaves:number;clusters:number;triangles:number;vertices:number};
}
export const RECIPE_SCHEMA:'1400.asset.recipe.v1';
export const GENERATOR:'tree.oak.v2';
export const GENERATOR_REVISION:2;
export const DEFAULT_RECIPE:Readonly<TreeRecipe>;
export function validateRecipe(value:unknown):TreeRecipe;
export function variantSeeds(seed:number):number[];
export function generateTree(recipe:TreeRecipe):GeneratedTree;
