import type {GeneratorComponent} from './seed-model.mjs';
import type {TreeMesh} from './tree.mjs';
import type {OakFoliageMesh} from './oak-foliage.mjs';
import type {BuildingOptions,GeneratedBuilding} from './building.mjs';

export interface GeneratedModel {
  id:string;kind:'model';wood:TreeMesh;foliage:OakFoliageMesh|null;
  atlasSeed:number|null;
  barkWood?:import('./oak-bark-uv.mjs').MappedWood;
  barkSeeds?:{structureSeed:number;surfaceSeed:number;colorSeed:number};
}
export interface GeneratedImage {
  id:string;kind:'image';width:number;height:number;channels:'RGBA';
  tiles?:number;atlas?:{columns:number;rows:number};
  views?:readonly string[];profiles?:readonly string[];
  paint:(canvas:HTMLCanvasElement,view?:string,profile?:string)=>unknown;
}
export type GeneratedAsset=GeneratedModel|GeneratedImage|GeneratedBuilding;
interface GeneratorMeta {
  id:string;symbol:string;label:string;subtitle:string;
  libraryPath:readonly string[];navLabel:string;navType:string;
  overline:string;title:string;description:string;previewLabel:string;
  initialMasterSeed:number;components:readonly GeneratorComponent[];
  defaultOptions?:BuildingOptions;
  validateOptions?:(value:unknown)=>BuildingOptions;
  materialSlots?:readonly {id:string;label:string;generators:readonly string[]}[];
}
export interface TreeGeneratorDefinition extends GeneratorMeta {
  kind:'model';generate:(seeds:Record<string,number>)=>GeneratedModel;
}
export interface BuildingGeneratorDefinition extends GeneratorMeta {
  kind:'model';defaultOptions:BuildingOptions;
  materialSlots:readonly {id:string;label:string;generators:readonly string[]}[];
  validateOptions:(value:unknown)=>BuildingOptions;
  generate:(seeds:Record<string,number>,
    options?:BuildingOptions,level?:number)=>GeneratedBuilding;
}
export type ModelGeneratorDefinition=TreeGeneratorDefinition|BuildingGeneratorDefinition;
export interface ImageGeneratorDefinition extends GeneratorMeta {
  kind:'image';generate:(seeds:Record<string,number>)=>GeneratedImage;
}
export type GeneratorDefinition=ModelGeneratorDefinition|ImageGeneratorDefinition;
export const GENERATORS:readonly GeneratorDefinition[];
export function findGenerator(id:'oak'|'fir'):TreeGeneratorDefinition|null;
export function findGenerator(id:'timber-building'):BuildingGeneratorDefinition|null;
export function findGenerator(id:'oak-atlas'|'oak-sprig'|'oak-bark'|'roof-thatch'|'roof-clay'):ImageGeneratorDefinition|null;
export function findGenerator(id:string):GeneratorDefinition|null;
export function generateAsset(definition:TreeGeneratorDefinition,
  componentSeeds:Record<string,number>,options?:BuildingOptions,level?:number):GeneratedModel;
export function generateAsset(definition:BuildingGeneratorDefinition,
  componentSeeds:Record<string,number>,options?:BuildingOptions,level?:number):GeneratedBuilding;
export function generateAsset(definition:ModelGeneratorDefinition,
  componentSeeds:Record<string,number>,options?:BuildingOptions,level?:number):GeneratedModel|GeneratedBuilding;
export function generateAsset(definition:ImageGeneratorDefinition,
  componentSeeds:Record<string,number>,options?:BuildingOptions,level?:number):GeneratedImage;
export function generateAsset(definition:GeneratorDefinition,
  componentSeeds:Record<string,number>,options?:BuildingOptions,level?:number):GeneratedAsset;
