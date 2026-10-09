export interface FloatHeightGrid { width: number; height: number; data: Float32Array; }
export interface SurfaceGrid { width: number; height: number; data: Uint8Array; }
export interface TerrainDefinition {
  size: [number, number]; min_height: number; max_height: number;
}
export function sampleHeight(terrain: TerrainDefinition, image: FloatHeightGrid, x: number, z: number): number;
export function buildTerrainGeometry(terrain: TerrainDefinition, image: FloatHeightGrid): { positions: Float32Array; indices: Uint32Array };
export function surfaceAt(terrain: TerrainDefinition, surface: SurfaceGrid, x: number, z: number): number;
export function paletteColor(definition: string): [number, number, number];
export function makeVertexColors(terrain: TerrainDefinition, image: FloatHeightGrid, surface: SurfaceGrid, definitions: string[]): Float32Array;
