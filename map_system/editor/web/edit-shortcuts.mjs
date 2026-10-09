export const SCULPT_MODES = Object.freeze(['raise', 'lower', 'smooth', 'flatten']);

// Modifiers affect only the active stroke; the chosen tool is never rewritten.
export function effectiveSculptMode(selected, { shiftKey = false, ctrlKey = false } = {}) {
  if (!SCULPT_MODES.includes(selected)) throw new Error(`Invalid sculpt mode: ${selected}`);
  if (ctrlKey) return 'smooth';
  if (shiftKey && selected === 'raise') return 'lower';
  if (shiftKey && selected === 'lower') return 'raise';
  return selected;
}

export function cycleChoice(values, selected, direction) {
  if (!Array.isArray(values) || !values.length || ![1, -1].includes(direction)) throw new Error('Invalid tool choices');
  const index = values.indexOf(selected);
  return values[((index < 0 ? 0 : index) + direction + values.length) % values.length];
}

export function resizeBrush(radius, direction) {
  if (!Number.isFinite(radius) || ![1, -1].includes(direction)) throw new Error('Invalid brush radius adjustment');
  const step = radius < 5 ? 0.5 : radius < 20 ? 1 : 2.5;
  return Math.max(0.5, Math.min(100, Number((radius + step * direction).toFixed(2))));
}

export function resizeBrushStrength(strength, direction) {
  if (!Number.isFinite(strength) || ![1, -1].includes(direction)) throw new Error('Invalid brush strength adjustment');
  const step = strength < 2 ? 0.1 : strength < 10 ? 0.5 : 1;
  return Math.max(0.1, Math.min(50, Number((strength + step * direction).toFixed(2))));
}

export function brushWheelSetting({ shiftKey = false, ctrlKey = false, altKey = false, metaKey = false } = {}) {
  if (altKey || metaKey || shiftKey === ctrlKey) return null;
  return shiftKey ? 'radius' : 'strength';
}

export function rotateDegrees(angle, direction = 1) {
  if (!Number.isFinite(angle) || ![1, -1].includes(direction)) throw new Error('Invalid rotation');
  return ((angle + direction * 15) % 360 + 360) % 360;
}

export function movedEntries(entries, ids, anchor, point, size) {
  if (!anchor || !point || point.length !== 2 || point.some(n => !Number.isFinite(n))) throw new Error('Invalid duplication destination');
  const dx = point[0] - anchor[0], dz = point[1] - anchor[1];
  const chosen = new Set(ids);
  const shifted = entries.map(e => chosen.has(e.id) ? {
    ...e, position: [Number((e.position[0] + dx).toFixed(6)), Number((e.position[1] + dz).toFixed(6))],
  } : e);
  if (shifted.some(e => chosen.has(e.id) && (e.position[0] < 0 || e.position[1] < 0 || e.position[0] > size[0] || e.position[1] > size[1]))) {
    throw new Error('Duplicate would leave the map');
  }
  return shifted;
}
