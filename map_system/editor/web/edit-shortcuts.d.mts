export declare const SCULPT_MODES: readonly string[];
export declare function effectiveSculptMode(selected: string, modifiers?: {shiftKey?: boolean; ctrlKey?: boolean}): string;
export declare function cycleChoice<T>(values: readonly T[], selected: T, direction: 1 | -1): T;
export declare function resizeBrush(radius: number, direction: 1 | -1): number;
export declare function rotateDegrees(angle: number, direction?: 1 | -1): number;
export declare function movedEntries(entries: Array<{id: string; position: number[]; [key: string]: unknown}>, ids: string[], anchor: number[], point: number[], size: number[]): Array<{id: string; position: number[]; [key: string]: unknown}>;
