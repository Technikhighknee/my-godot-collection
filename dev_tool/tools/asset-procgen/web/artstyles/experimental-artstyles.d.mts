export type ExperimentalArtstyleId='classic-strategy-study'|
  'naturalistic-study'|'hand-painted-study'|'retro-3d-study'|'watercolor-study';
export interface ExperimentalArtstyle {
  readonly id:ExperimentalArtstyleId;
  readonly version:1;
  readonly status:'experimental';
  readonly label:string;
  readonly description:string;
}
export const EXPERIMENTAL_ARTSTYLES:readonly ExperimentalArtstyle[];
export function findExperimentalArtstyle(id:string):ExperimentalArtstyle|null;
export function defineExperimentalStyleSupport(ids:readonly ExperimentalArtstyleId[]):
  readonly ExperimentalArtstyleId[];
