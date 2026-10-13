export interface BuildingOptions {
  width:number;depth:number;stories:number;roofPitch:number;interior:'none'|'shell';
}
export interface BuildingOpening {
  side:'front'|'back'|'left'|'right';type:'window'|'door';level:number;
  center:number;width:number;bottom:number;top:number;
}
export interface BuildingPart {
  material:string;positions:Float32Array;normals:Float32Array;indices:Uint32Array;
}
export interface BuildingMesh {
  parts:BuildingPart[];bounds:{min:number[];max:number[]};triangles:number;
}
export interface GeneratedBuilding {
  id:'timber-building';kind:'model';
  building:{
    level:number;
    plan:{width:number;depth:number;stories:number;wallHeight:number;
      openings:BuildingOpening[]};
    exterior:BuildingMesh;interior:BuildingMesh|null;
    exteriorOpenings:BuildingOpening[];interiorOpenings:BuildingOpening[];
  };
}
export const DEFAULT_BUILDING_OPTIONS:Readonly<BuildingOptions>;
export function validateBuildingOptions(value:unknown):BuildingOptions;
export function generateBuildingFamily(seeds:Record<string,number>,
  options?:BuildingOptions,level?:number):GeneratedBuilding;
