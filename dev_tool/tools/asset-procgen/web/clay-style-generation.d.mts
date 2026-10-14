export const CLAY_GENERATIVE_STYLES:readonly ('hand-painted-study'|'retro-3d-study')[];
export interface ClayStyleSeeds {pattern:number;color:number;}
export interface GeneratedClayMaps {
  albedo:Float32Array;height:Float32Array;roughness:Float32Array;
}
export function generateStyledClay(
  seeds:ClayStyleSeeds,
  style:'hand-painted-study'|'retro-3d-study',
):GeneratedClayMaps;
