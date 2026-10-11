import type {GeneratorDefinition} from './generators.mjs';
export interface LibraryTree {
  name:string;path:string[];
  groups:LibraryTree[];assets:GeneratorDefinition[];
}
export function filterAssetLibrary(definitions:readonly GeneratorDefinition[],
  options?:{query?:string;kind?:'all'|'model'|'image'}):GeneratorDefinition[];
export function buildAssetLibraryTree(definitions:readonly GeneratorDefinition[]):LibraryTree;
export function createAssetLibrary(options:{
  definitions:readonly GeneratorDefinition[];
  list:HTMLElement;search:HTMLInputElement;
  filters:HTMLElement;count:HTMLElement;
  onSelect:(id:string)=>void;
}):{select:(id:string)=>boolean;render:()=>void};
