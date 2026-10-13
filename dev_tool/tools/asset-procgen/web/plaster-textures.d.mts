export interface PlasterSeeds {structure:number;pigment:number;wear:number;}
export const PLASTER_TEXTURE_SIZE:number;
export const PLASTER_VIEWS:readonly ('albedo'|'normal'|'roughness')[];
export function makePlasterAsset(seeds:PlasterSeeds):{
  id:'plaster-lime';kind:'image';width:number;height:number;
  channels:'RGBA';views:readonly ('albedo'|'normal'|'roughness')[];
  sourceSeeds:PlasterSeeds;
  paint:(canvas:HTMLCanvasElement,view?:string)=>void;
};
