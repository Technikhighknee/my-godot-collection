import type { TreeMesh } from './tree.mjs';
export interface OakFoliageMesh {
  seed: number;
  leafCount: number;
  branchesUsed: number;
  shootCount: number;
  veinCount: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  bounds: { min:number[]; max:number[] };
}
export function generateOakFoliage(wood:TreeMesh): OakFoliageMesh;
