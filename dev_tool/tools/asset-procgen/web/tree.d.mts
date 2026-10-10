export interface TreeSettings {
  seed: number;
}
export interface WoodAxis {
  id: number;
  parentId: number | null;
  level: number;
  length: number;
  baseRadius: number;
  tipRadius: number;
  from: number[];
  to: number[];
  rings: number;
  sides: number;
}
export interface TreeMesh {
  seed: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  branches: WoodAxis[];
  bounds: { min: number[]; max: number[] };
}
export const DEFAULT_TREE: Readonly<TreeSettings>;
export function validateTree(input: unknown): TreeSettings;
export function generateTree(input?: TreeSettings): TreeMesh;
