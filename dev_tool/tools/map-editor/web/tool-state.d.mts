export declare const TOOLS: readonly ['select', 'sculpt', 'paint', 'draw', 'place'];
export declare function toolForMode(mode: string): typeof TOOLS[number];
export declare function modeForTool(tool: typeof TOOLS[number], subtools?: { draw?: string; place?: string }): string;
export declare function toolShortcut(event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; repeat?: boolean }): typeof TOOLS[number] | null;
