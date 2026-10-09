export const TOOLS = Object.freeze(['select', 'sculpt', 'paint', 'draw', 'place']);

const MODE_TO_TOOL = Object.freeze({
  navigate: 'select', select: 'select', entities: 'select',
  sculpt: 'sculpt', paint: 'paint',
  edit: 'draw', create: 'draw', append: 'draw', insert: 'draw',
  'polygon-edit': 'draw', 'polygon-insert': 'draw', 'draw-polygon': 'draw',
  'place-entity': 'place', 'place-lake': 'place',
});

export function toolForMode(mode) {
  const tool = MODE_TO_TOOL[mode];
  if (!tool) throw new Error(`Unknown editor mode: ${mode}`);
  return tool;
}

export function modeForTool(tool, subtools = {}) {
  switch (tool) {
    case 'select': return 'select';
    case 'sculpt': return 'sculpt';
    case 'paint': return 'paint';
    case 'draw': return subtools.draw === 'areas' ? 'polygon-edit' : 'edit';
    case 'place': return subtools.place === 'lake' ? 'place-lake' : 'place-entity';
    default: throw new Error(`Unknown tool: ${tool}`);
  }
}

export function toolShortcut(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  const index = '12345'.indexOf(event.key);
  return index < 0 ? null : TOOLS[index];
}
