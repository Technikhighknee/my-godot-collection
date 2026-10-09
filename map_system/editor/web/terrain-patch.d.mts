export type PatchRect = { minX: number; maxX: number; minZ: number; maxZ: number };
export function updateTerrainPatch(
  terrain: { size: [number, number]; min_height: number; max_height: number },
  height: { width: number; height: number; data: Float32Array },
  surface: { width: number; height: number; data: Uint8Array },
  definitions: string[],
  positions: Float32Array, normals: Float32Array, colors: Float32Array,
  changes: { height?: PatchRect; surface?: PatchRect }
): { positions: [number, number][]; normals: [number, number][]; colors: [number, number][] };
