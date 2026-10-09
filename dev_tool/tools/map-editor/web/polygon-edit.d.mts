export type Point = [number, number];
export type Water = { id: string; definition: 'water.sea'; height: number } | { id: string; definition: 'water.lake'; height: number; source: Point };
export type Settlement = { id: string; name: string; build_areas: Point[][] };
export function validatePolygon(points: Point[], size: Point): Point[];
export function validatePolygons(kind: 'water', entries: Water[], size: Point, occupiedIds?: string[]): Water[];
export function validatePolygons(kind: 'settlements', entries: Settlement[], size: Point, occupiedIds?: string[]): Settlement[];
export function newPolygonId(kind: 'water' | 'settlements', occupiedIds?: string[]): string;
export function nearestPolygonEdge(points: Point[], point: Point): { index: number; distance: number };
