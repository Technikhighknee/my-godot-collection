import type { GeneratedTree,TreeRecipe } from './tree.mjs';
export interface GlbInspection {
  asset:{version:string;generator:string};
  buffers:{byteLength:number}[];
  bufferViews:{buffer:number;byteOffset:number;byteLength:number;target:number}[];
  accessors:{bufferView:number;componentType:number;count:number;type:string;min?:number[];max?:number[]}[];
  meshes:{name:string;primitives:{attributes:Record<string,number>;indices:number;material:number;mode:number}[]}[];
  nodes:{name:string;mesh:number}[];
  materials:{name:string;doubleSided?:boolean}[];
  extras:{recipe:TreeRecipe};
}
export function exportGlb(generated:GeneratedTree):Uint8Array;
export function inspectGlb(data:Uint8Array):GlbInspection;
