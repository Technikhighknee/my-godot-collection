export const OAK_ATLAS_TILE:number;
export const OAK_ATLAS_SIZE:number;
export interface OakAtlasCanvas {
  width:number;
  height:number;
  getContext(type:string):unknown;
}
export interface OakAtlasMetadata {
  size:number;
  tiles:number;
  padding:number;
}
export function paintOakAtlas(canvas:OakAtlasCanvas,seed?:number):OakAtlasMetadata;
