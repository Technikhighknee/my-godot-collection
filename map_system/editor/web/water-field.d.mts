export type WaterSource = { id: string; definition: 'water.sea'; height: number } | { id: string; definition: 'water.lake'; height: number; source: [number,number] };
export type Terrain = { size: [number,number]; min_height: number; max_height: number };
export type Height = { width: number; height: number; data: Float32Array };
export type WaterRegion = { id: string; definition: string; level: number; mask: Uint8Array; positions: Float32Array; triangleCount: number };
export function validateWaterSources(entries: unknown, size: [number, number], occupiedIds?: string[]): WaterSource[];
export function buildWaterRegions(terrain: Terrain, height: Height, sources: WaterSource[]): WaterRegion[];
export function waterAt(terrain: Terrain, height: Height, regions: WaterRegion[], x: number, z: number): string | null;
export function waterOverlapsFootprint(terrain: Terrain, height: Height, regions: WaterRegion[], footprint: number[][]): string | null;
