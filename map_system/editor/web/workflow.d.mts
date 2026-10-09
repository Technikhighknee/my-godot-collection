export declare function snapPoint(point: number[], size: number[], enabled: boolean, step: number): number[];
export declare function toggleSelection(selected: Set<string>, id: string, additive?: boolean): Set<string>;
export declare function moveEntities(entries: any[], ids: Iterable<string>, anchorId: string, position: number[], size: number[]): any[];
export declare function duplicateEntities(kind: 'buildings' | 'objects', entries: any[], ids: Iterable<string>, size: number[], offset?: number[], occupiedIds?: string[]): { entries: any[], addedIds: string[] };
export declare function duplicateRoad(roads: any[], id: string, size: number[], offset?: number[], occupiedIds?: string[]): { entries: any[], addedId: string };
