export type RoofTextureKind='clay'|'thatch';
export interface RoofTextureSeeds {pattern:number;color:number;}
export const ROOF_TEXTURE_SIZE:number;
export const ROOF_VIEWS:readonly string[];
export const CLAY_GENERATIVE_STYLES:readonly ('hand-painted-study'|'retro-3d-study'|'naturalistic-study'|'watercolor-study')[];
export function paintRoofTexture(canvas:HTMLCanvasElement,kind:RoofTextureKind,
  seeds:RoofTextureSeeds,view?:string,style?:string):void;
export function makeRoofAsset(kind:RoofTextureKind,seeds:RoofTextureSeeds,
  options?:{style?:'current'|'hand-painted'|'retro-3d'|'naturalistic'|'watercolor'|'hand-painted-study'|'retro-3d-study'|'naturalistic-study'|'watercolor-study'}):{
  id:'roof-clay'|'roof-thatch';kind:'image';
  width:number;height:number;channels:'RGBA';views:readonly string[];
  sourceSeeds:RoofTextureSeeds;sourceStyle?:string;
  paint:(canvas:HTMLCanvasElement,view?:string)=>void;
};
