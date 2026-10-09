export declare function dab(doc: any, kind: string, x: number, z: number, radius: number, strength: number, surfaceIndex: number, flattenHeight: number, changed: (layer: string, index: number, before: number, after: number) => void): number;
export declare class MapEdits {
  constructor(doc: any);
  get roads(): any[];
  get buildings(): any[];
  get objects(): any[];
  get water(): any[];
  get settlements(): any[];
  get polygonDirty(): boolean;
  get entityDirty(): boolean;
  get isDirty(): boolean;
  get roadDirty(): boolean;
  get heightDirty(): boolean;
  get surfaceDirty(): boolean;
  get canUndo(): boolean;
  get canRedo(): boolean;
  get painting(): boolean;
  commit(roads: any[]): boolean;
  commitPolygons(kind: 'water' | 'settlements', entries: any[]): boolean;
  commitEntities(kind: 'buildings' | 'objects', entries: any[]): boolean;
  beginStroke(kind: string, options: any, point: number[]): boolean;
  strokeTo(point: number[]): boolean;
  takeStrokeBounds(): { height?: { minX: number; maxX: number; minZ: number; maxZ: number }; surface?: { minX: number; maxX: number; minZ: number; maxZ: number } } | null;
  endStroke(): boolean;
  cancelStroke(): boolean;
  undo(): string | null;
  redo(): string | null;
  markSaved(): void;
}
