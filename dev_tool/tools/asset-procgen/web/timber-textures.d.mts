export interface TimberTextureSeeds {grain:number;color:number;}
export const TIMBER_TEXTURE_SIZE:number;
export const TIMBER_VIEWS:readonly string[];
export function paintTimberTexture(canvas:HTMLCanvasElement,
  seeds:TimberTextureSeeds,view?:string):void;
export function makeTimberAsset(seeds:TimberTextureSeeds):{
  id:'timber-oak';kind:'image';width:number;height:number;
  channels:'RGBA';views:readonly string[];
  sourceSeeds:TimberTextureSeeds;
  paint:(canvas:HTMLCanvasElement,view?:string)=>void;
};
