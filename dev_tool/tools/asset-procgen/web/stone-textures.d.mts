export interface StoneSeeds {layout:number;mineral:number;weather:number;}
export const STONE_TEXTURE_SIZE:number;
export const STONE_VIEWS:readonly ('albedo'|'normal'|'roughness')[];
export function makeStoneAsset(seeds:StoneSeeds):{
  id:'stone-rubble';kind:'image';width:number;height:number;
  channels:'RGBA';views:readonly ('albedo'|'normal'|'roughness')[];
  sourceSeeds:StoneSeeds;
  paint:(canvas:HTMLCanvasElement,view?:string)=>void;
};
