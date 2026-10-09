import type { Road, Point } from '../src/core/map.ts';
export function validateRoads(roads: Road[], size: Point): Road[];
export function nearestSegment(points: Point[], point: Point): { index: number; distance: number };
export class RoadEdits {
  constructor(roads: Road[], size: Point);
  get roads(): Road[];
  get isDirty(): boolean;
  get canUndo(): boolean;
  get canRedo(): boolean;
  markSaved(snapshot: Road[]): void;
  commit(roads: Road[]): boolean;
  undo(): boolean;
  redo(): boolean;
}
