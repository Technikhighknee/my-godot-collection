// Procedural, browser-side materials for building authoring previews.
export type BuildingSurfaceKind='plaster'|'wood'|'roof'|'stone'|'floor';
export function buildingSurfaceKind(material:string):BuildingSurfaceKind|null;
export interface BuildingTextureCache {
  get(material:string):unknown;
  dispose():void;
}
export function createBuildingTextures(renderer:{
  capabilities:{getMaxAnisotropy():number};
}):BuildingTextureCache;
