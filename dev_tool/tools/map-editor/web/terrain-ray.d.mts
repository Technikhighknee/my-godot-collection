export function intersectTerrainRay(
  terrain: { size: [number, number]; min_height: number; max_height: number },
  height: { width: number; height: number; data: Float32Array },
  origin: [number, number, number],
  direction: [number, number, number]
): { point: { x: number; y: number; z: number }; distance: number } | null;
