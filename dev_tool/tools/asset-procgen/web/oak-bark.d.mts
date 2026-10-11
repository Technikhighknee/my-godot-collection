export interface OakBarkOptions {
  structureSeed?:number;
  surfaceSeed?:number;
  colorSeed?:number;
  size?:number;
}
export interface OakBarkImage {
  width:number;
  height:number;
  pixels:Uint8ClampedArray;
  heightField:Float32Array;
}
export const OAK_BARK_SIZE:number;
export function generateOakBark(options?:OakBarkOptions):OakBarkImage;
export function paintOakBark(canvas:HTMLCanvasElement,options?:OakBarkOptions):{
  width:number;height:number;channels:'RGBA';seamless:true;
};
