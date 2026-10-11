import type {TreeMesh} from './tree.mjs';
export interface OakCushion {
  center:number[];
  radii:number[];
  supportAxisId:number;
  cardCount:number;
  firstCard:number;
}
export interface OakCrownMass {
  supportAxisId:number;
  axisCount:number;
  cardCount:number;
  cushions:OakCushion[];
}
export interface OakFoliageMesh {
  seed:number;
  cardCount:number;
  atlasGrid:number;
  crownMasses:OakCrownMass[];
  positions:Float32Array;
  normals:Float32Array;
  uvs:Float32Array;
  colors:Float32Array;
  indices:Uint32Array;
  bounds:{min:number[];max:number[]};
}
export const OAK_ATLAS_GRID:number;
export const OAK_CARD_TRIANGLES:number;
export function generateOakFoliage(wood:TreeMesh,variation?:{seed?:number}):OakFoliageMesh;
