import type {GeneratorComponent} from './seed-model.mjs';
import type {TreeMesh} from './tree.mjs';
import type {OakFoliageMesh} from './oak-foliage.mjs';

export interface GeneratedModel {
  id:string;kind:'model';wood:TreeMesh;foliage:OakFoliageMesh|null;
  atlasSeed:number|null;
}
export interface GeneratedImage {
  id:string;kind:'image';width:number;height:number;channels:'RGBA';
  tiles:number;atlas?:{columns:number;rows:number};
  paint:(canvas:HTMLCanvasElement)=>unknown;
}
export type GeneratedAsset=GeneratedModel|GeneratedImage;
interface GeneratorMeta {
  id:string;symbol:string;label:string;subtitle:string;
  overline:string;title:string;description:string;previewLabel:string;
  initialMasterSeed:number;components:readonly GeneratorComponent[];
}
export interface ModelGeneratorDefinition extends GeneratorMeta {
  kind:'model';generate:(seeds:Record<string,number>)=>GeneratedModel;
}
export interface ImageGeneratorDefinition extends GeneratorMeta {
  kind:'image';generate:(seeds:Record<string,number>)=>GeneratedImage;
}
export type GeneratorDefinition=ModelGeneratorDefinition|ImageGeneratorDefinition;
export const GENERATORS:readonly GeneratorDefinition[];
export function findGenerator(id:'oak'|'fir'):ModelGeneratorDefinition|null;
export function findGenerator(id:'oak-atlas'):ImageGeneratorDefinition|null;
export function findGenerator(id:string):GeneratorDefinition|null;
export function generateAsset(definition:ModelGeneratorDefinition,
  componentSeeds:Record<string,number>):GeneratedModel;
export function generateAsset(definition:ImageGeneratorDefinition,
  componentSeeds:Record<string,number>):GeneratedImage;
export function generateAsset(definition:GeneratorDefinition,
  componentSeeds:Record<string,number>):GeneratedAsset;
