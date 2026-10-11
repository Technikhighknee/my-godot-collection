export interface OakBarkOptions {
  structureSeed?:number;surfaceSeed?:number;colorSeed?:number;size?:number;
  profile?:OakBarkProfile;
}
export type OakBarkProfile='trunk'|'limb'|'young';
export interface OakBarkImage {
  width:number;height:number;
  pixels:Uint8ClampedArray;heightField:Float32Array;
  profile:OakBarkProfile;
}
export type OakBarkMapName='albedo'|'normal'|'roughness'|'ao'|'height';
export interface OakBarkMaterial {
  width:number;height:number;
  albedo:Uint8ClampedArray;normal:Uint8ClampedArray;
  roughness:Uint8ClampedArray;ao:Uint8ClampedArray;
  heightMap:Uint8ClampedArray;
  heightField:Float32Array;
  normalConvention:'opengl';profile:OakBarkProfile;
}
export interface OakBarkMaterialSet {
  trunk:OakBarkMaterial;limb:OakBarkMaterial;young:OakBarkMaterial;
}
export const OAK_BARK_SIZE:number;
export const OAK_BARK_PROFILES:readonly OakBarkProfile[];
export const OAK_BARK_MAPS:readonly OakBarkMapName[];
export function generateOakBark(options?:OakBarkOptions):OakBarkImage;
export function generateOakBarkMaterial(options?:OakBarkOptions):OakBarkMaterial;
export function generateOakBarkMaterialSet(options?:OakBarkOptions):OakBarkMaterialSet;
export function paintOakBark(canvas:HTMLCanvasElement,options?:OakBarkOptions):{
  width:number;height:number;channels:'RGBA';seamless:true;
};
export function paintOakBarkMap(canvas:HTMLCanvasElement,
  options?:OakBarkOptions,map?:OakBarkMapName):{
  width:number;height:number;map:OakBarkMapName;seamless:true;
};
export function paintGeneratedOakBarkMap(canvas:HTMLCanvasElement,
  material:OakBarkMaterial,map?:OakBarkMapName):{
  width:number;height:number;map:OakBarkMapName;seamless:true;
};
