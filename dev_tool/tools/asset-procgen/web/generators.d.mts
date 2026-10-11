import type {GeneratorComponent} from './seed-model.mjs';
import type {TreeMesh} from './tree.mjs';
import type {OakFoliageMesh} from './oak-foliage.mjs';
export interface GeneratedModel {
  id:string;kind:'model';wood:TreeMesh;foliage:OakFoliageMesh|null;
  atlasSeed:number|null;
}
export interface GeneratorDefinition {
  id:string;kind:'model';symbol:string;label:string;subtitle:string;
  overline:string;title:string;description:string;previewLabel:string;
  initialMasterSeed:number;components:readonly GeneratorComponent[];
  generate:(seeds:Record<string,number>)=>GeneratedModel;
}
export const GENERATORS:readonly GeneratorDefinition[];
export function findGenerator(id:string):GeneratorDefinition|null;
export function generateAsset(definition:GeneratorDefinition,
  componentSeeds:Record<string,number>):GeneratedModel;
