export interface ProductionArtstyleReference {
  readonly id:string;readonly version:number;
}
export interface ProductionArtstyle extends ProductionArtstyleReference {
  readonly status:'production';readonly label:string;
}
export interface ProductionStyleProvider {
  readonly productionStyleGeneration?:{
    readonly styles:readonly ProductionArtstyleReference[];
  };
}
export const PRODUCTION_ARTSTYLES:readonly ProductionArtstyle[];
export function validateProductionArtstyle(value:unknown):ProductionArtstyleReference;
export function assertGeneratorArtstyleSupport(
  definition:ProductionStyleProvider|null|undefined,value:unknown,
):ProductionArtstyleReference;
export function availableProductionArtstyles(
  definition:ProductionStyleProvider|null|undefined,
):readonly ProductionArtstyle[];
