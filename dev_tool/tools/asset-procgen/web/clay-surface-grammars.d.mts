export type ClaySurfaceStyle =
  'hand-painted' | 'retro-3d' | 'naturalistic' | 'watercolor';
export interface ClaySurfaceSeeds {
  pattern: number;
  color: number;
}
export interface ClaySurfaceMaps {
  albedo: Float32Array;
  height: Float32Array;
  roughness: Float32Array;
}
export const CLAY_STYLE_IDS: readonly ClaySurfaceStyle[];
export function generateClaySurface(
  seeds: ClaySurfaceSeeds,
  style: ClaySurfaceStyle
): ClaySurfaceMaps;
