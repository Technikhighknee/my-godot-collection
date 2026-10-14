export type MaterialLanguageId='roof-clay'|'roof-thatch'|'timber-oak'|
  'plaster-lime'|'stone-rubble';
export interface MaterialSeedStreams {
  readonly form:number;readonly pigment:number;readonly aging:number;
}
export interface MaterialElementTraits {
  readonly form:number;readonly variation:number;readonly age:number;
  readonly deposits:number;readonly fracture:number;
  readonly fracturePosition:number;readonly fractureSkew:number;
  readonly chipped:number;
}
export interface MaterialElementWear {
  moisture:number;erosion:number;crack:number;
}
export const MATERIAL_SEED_ROLES:Readonly<Record<MaterialLanguageId,
  Readonly<{form:string;pigment:string;aging?:string}>>>;
export function materialSeedStreams(material:MaterialLanguageId,
  seeds:Record<string,number>):MaterialSeedStreams;
export function materialElementTraits(column:number,row:number,
  columns:number,rows:number,
  streams:MaterialSeedStreams):MaterialElementTraits;
export function materialElementWear(traits:MaterialElementTraits,
  u:number,v:number):MaterialElementWear;
