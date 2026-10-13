export interface TimberTextureSeeds {grain:number;color:number;}
export const TIMBER_TEXTURE_SIZE:number;
export const TIMBER_BEAM_STRIPS:number;
export const TIMBER_BEAM_HEIGHT:number;
export const TIMBER_VIEWS:readonly string[];
export const TIMBER_PROFILES:readonly ('beam'|'end'|'panel')[];
export function paintTimberTexture(canvas:HTMLCanvasElement,
  seeds:TimberTextureSeeds,view?:string,profile?:string):void;
export function makeTimberAsset(seeds:TimberTextureSeeds):{
  id:'timber-oak';kind:'image';width:number;height:number;
  profileSizes:Record<'beam'|'end'|'panel',{width:number;height:number}>;
  channels:'RGBA';views:readonly string[];profiles:readonly ('beam'|'end'|'panel')[];
  sourceSeeds:TimberTextureSeeds;
  paint:(canvas:HTMLCanvasElement,view?:string,profile?:string)=>void;
};
