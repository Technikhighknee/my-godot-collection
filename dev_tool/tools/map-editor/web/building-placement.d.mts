export interface PlacementDefinition { id:string; footprint:[number,number]; requires_build_area?:boolean; max_slope?:number; entrance?:[number,number]; max_road_distance?:number; }
export interface PlacementDefinitions { buildings: PlacementDefinition[]; }
export function validatePlacementDefinitions(value:unknown):PlacementDefinitions;
export function footprint(definition:PlacementDefinition,position:[number,number],rotation:number):[number,number][];
export interface PlacementResult { valid:boolean;reason:string;footprint?:[number,number][];slope?:number;blocking_id?:string;settlement_id?:string;road_id?:string;road_distance?:number; }
export function checkBuildingPlacement(doc:any,definition:PlacementDefinition|undefined,candidate:any,allBuildings?:any[]):PlacementResult;
export function validateBuildingChanges(doc:any,original:any,definitions:PlacementDefinitions):void;
