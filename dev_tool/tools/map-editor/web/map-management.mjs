/** Client-side validation mirrors workspace limits; server remains authoritative. */
export function parsePalette(text) {
  if (typeof text !== 'string') throw new Error('Invalid surface palette');
  const result = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (result.length < 1 || result.length > 256 || result.some(s => s.length > 120) || new Set(result).size !== result.length)
    throw new Error('Surface palette must contain 1–256 unique definitions');
  return result;
}
export function validateCreate(form) {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(form.slug)) throw new Error('Filename must use lowercase letters, numbers, underscores or hyphens');
  if (typeof form.name !== 'string' || !form.name.trim() || form.name.length > 100) throw new Error('Enter a map name (up to 100 characters)');
  if (!Array.isArray(form.worldSize) || form.worldSize.length !== 2 || form.worldSize.some(n => !Number.isFinite(n) || n <= 0 || n > 8192)) throw new Error('Map dimensions must be within 1–8192 meters');
  if (!Array.isArray(form.heightSamples) || form.heightSamples.length !== 2 || form.heightSamples.some(n => !Number.isInteger(n) || n < 2 || n > 1025) || form.heightSamples[0] * form.heightSamples[1] > 1500000) throw new Error('Invalid terrain resolution');
  if (!Number.isFinite(form.minHeight) || !Number.isFinite(form.maxHeight) || form.minHeight >= form.maxHeight) throw new Error('Maximum elevation must exceed minimum');
  if (!Array.isArray(form.surfacePalette) || form.surfacePalette.length < 1 || form.surfacePalette.length > 16 || form.surfacePalette.some(s => !s || s.length > 120) || new Set(form.surfacePalette).size !== form.surfacePalette.length) throw new Error('Invalid surface palette');
  return form;
}
