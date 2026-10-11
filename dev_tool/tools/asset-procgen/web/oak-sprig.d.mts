export type Vec3=[number,number,number];

export interface OakSprigPath {
  radius:number;
  points:Vec3[];
}
export interface OakSprigLeaf {
  attach:Vec3;
  base:Vec3;
  forward:Vec3;
  side:Vec3;
  normal:Vec3;
  size:number;
  curl:number;
  fold:number;
  profileSeed:number;
  shade:number;
  age:number;
  branchIndex:number;
}
export interface OakSprig {
  structureSeed:number;
  leafSeed:number;
  paths:OakSprigPath[];
  leaves:OakSprigLeaf[];
}
export const OAK_SPRIG_SIZE:number;
export function generateOakSprig(options?:{
  structureSeed?:number;
  leafSeed?:number;
}):OakSprig;
export function paintOakSprig(canvas:HTMLCanvasElement,sprig:OakSprig):{
  size:number;
  leaves:number;
  branches:number;
};
