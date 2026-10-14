export interface CanonicalMaterial {
  name:string;baseColor:number;roughness:number;normalScale?:number;
  occlusionStrength?:number;
  doubleSided:boolean;
  slot?:string;profile?:string;tint?:number;
}
export interface CanonicalMesh {
  name:string;positions:Float32Array;normals:Float32Array;
  indices:Uint32Array;uvs?:Float32Array;colors?:Float32Array;
  material:CanonicalMaterial;
  bounds:{min:number[];max:number[]};
  groups?:Array<{start:number;count:number;materialIndex:number;
    material:CanonicalMaterial}>;
}
export interface CanonicalModel {
  format:'devtool-canonical-model';version:1;meshes:CanonicalMesh[];
}
export function canonicalTreeModel(asset:import('./generators.mjs').GeneratedModel):CanonicalModel;
export function canonicalBuildingModel(
  asset:import('./building.mjs').GeneratedBuilding,view?:'exterior'|'interior'
):CanonicalModel|null;

export function canonicalOakWoodModel(asset:import('./generators.mjs').GeneratedModel):CanonicalModel;
