export const MAX_SEED:number;
export interface GeneratorComponent {
  id:string;label:string;initialSeed:number;
}
export interface SeedDefinition {
  initialMasterSeed:number;
  components:readonly GeneratorComponent[];
}
export interface SeedState {
  masterSeed:number;
  components:Record<string,number>;
}
export function validateSeed(seed:number):number;
export function parseSeed(text:string):number;
export function deriveSeed(masterSeed:number,componentId:string):number;
export function createSeedState(definition:SeedDefinition):SeedState;
export function updateComponentSeed(definition:SeedDefinition,state:SeedState,
  componentId:string,seed:number):SeedState;
export function updateMasterSeed(definition:SeedDefinition,state:SeedState,
  masterSeed:number):SeedState;
