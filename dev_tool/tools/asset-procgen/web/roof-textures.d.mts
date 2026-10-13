export type RoofTextureKind='clay'|'thatch';
export interface RoofTextureSeeds {pattern:number;color:number;}
export const ROOF_TEXTURE_SIZE:number;
export const ROOF_VIEWS:readonly string[];
export function paintRoofTexture(canvas:HTMLCanvasElement,kind:RoofTextureKind,
  seeds:RoofTextureSeeds,view?:string):void;
export function makeRoofAsset(kind:RoofTextureKind,seeds:RoofTextureSeeds):{
  id:'roof-clay'|'roof-thatch';kind:'image';
  width:number;height:number;channels:'RGBA';views:readonly string[];
  sourceSeeds:RoofTextureSeeds;
  paint:(canvas:HTMLCanvasElement,view?:string)=>void;
};
