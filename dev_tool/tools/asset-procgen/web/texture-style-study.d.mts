import type {ImageGeneratorDefinition} from './generators.mjs';
export interface StudyStyle {
  readonly id:'current'|'classic-strategy-study'|'naturalistic-study'|
    'hand-painted-study'|'retro-3d-study'|'watercolor-study';
  readonly label:string;readonly description:string;
  readonly version?:number;readonly status?:'experimental';
}
export interface StudyMaterial {
  readonly id:'roof-thatch'|'roof-clay'|'timber-oak'|'plaster-lime'|'stone-rubble';
  readonly label:string;readonly group:string;readonly profile:string|null;
}
export const STUDY_STYLES:readonly StudyStyle[];
export const STUDY_MATERIALS:readonly StudyMaterial[];
export function applyTextureStudyStyle(
  id:StudyMaterial['id'],style:StudyStyle['id'],
  view:'albedo'|'normal'|'roughness',data:Uint8ClampedArray,
  options?:{width?:number;height?:number;seed?:number},
):Uint8ClampedArray;
export function studySeeds(
  definition:ImageGeneratorDefinition,
):Record<string,number>;
export function reseedStudySeeds(
  definition:ImageGeneratorDefinition,masterSeed:number,
):Record<string,number>;
