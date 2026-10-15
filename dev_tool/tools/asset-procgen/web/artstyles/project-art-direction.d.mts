import type {ProductionArtstyleReference,ProductionStyleProvider}
  from './production-artstyles.mjs';

export interface ProjectArtDirection {
  format:'devtool-art-direction';version:1;name:string;
  defaultArtstyle:ProductionArtstyleReference|null;
  generatorArtstyles:Record<string,ProductionArtstyleReference>;
}
export interface ArtDirectionAssetEntry {
  source:{
    generator?:{id:string};artstyle?:ProductionArtstyleReference;
    origin?:string;
  };
}
export function emptyProjectArtDirection():ProjectArtDirection;
export function validateProjectArtDirection(raw:unknown,
  lookup:(id:string)=>ProductionStyleProvider|null):ProjectArtDirection;
export function resolveProjectArtstyle(generatorId:string,
  definition:ProductionStyleProvider,explicitArtstyle:ProductionArtstyleReference|undefined,
  artDirection:ProjectArtDirection):ProductionArtstyleReference|undefined;
export function applyProjectArtDirection<T extends ArtDirectionAssetEntry>(
  entries:readonly T[],artDirection:ProjectArtDirection,
  lookup:(id:string)=>ProductionStyleProvider|null):T[];
