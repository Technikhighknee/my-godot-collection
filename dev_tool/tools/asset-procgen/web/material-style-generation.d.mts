export type NativeMaterialId='roof-thatch'|'timber-oak'|'plaster-lime'|'stone-rubble';
export type NativeStyleId='hand-painted-study'|'retro-3d-study'|
  'naturalistic-study'|'watercolor-study';
export const MATERIAL_STUDY_STYLES:readonly NativeStyleId[];
export interface NativeStyledImage {
  id:NativeMaterialId;kind:'image';width:number;height:number;
  channels:'RGBA';views:readonly string[];
  profiles?:readonly string[];
  profileSizes?:Record<string,{width:number;height:number}>;
  sourceSeeds:Record<string,number>;sourceStyle:NativeStyleId;
  paint:(canvas:HTMLCanvasElement,view?:string,profile?:string)=>void;
}
export function makeStyledMaterialAsset(
  material:NativeMaterialId,
  seeds:Record<string,number>,
  style:NativeStyleId,
):NativeStyledImage;
