export interface TrunkRecipe {
  schema:'1400.trunk.study';name:string;seed:number;
  height:number;radius:number;taper:number;flare:number;character:number;bark:number;
}
export interface TrunkMesh {
  positions:Float32Array;normals:Float32Array;uv:Float32Array;indices:Uint32Array;
}
export interface TrunkTextures {size:number;albedo:Uint8Array;normal:Uint8Array;}
export interface TrunkResult {
  recipe:TrunkRecipe;mesh:TrunkMesh;textures:TrunkTextures;stats:{rings:number;sides:number};
}
export const DEFAULT_TRUNK:Readonly<TrunkRecipe>;
export function validateTrunk(value:unknown):TrunkRecipe;
export function createBarkTextures(recipe:TrunkRecipe,size?:number):TrunkTextures;
export function generateTrunk(recipe:TrunkRecipe):TrunkResult;
