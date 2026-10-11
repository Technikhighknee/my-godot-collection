// Deterministic, seamless mature Quercus robur bark albedo.
// Fissures, surface granularity and pigmentation are independent components.
// Periodic noise keeps both image edges continuous without baked directionality.
export const OAK_BARK_SIZE = 1024;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fract = v => v - Math.floor(v);
function validSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error('Oak bark seed must be an unsigned 32-bit integer');
  return seed;
}
function hash(x, y, seed) {
  let a = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ seed) >>> 0;
  a ^= a >>> 16;
  a = Math.imul(a, 0x7feb352d) >>> 0;
  a ^= a >>> 15;
  a = Math.imul(a, 0x846ca68b) >>> 0;
  return ((a ^ a >>> 16) >>> 0) / 4294967295;
}
const mod = (x, n) => ((x % n) + n) % n;
// Integer lattice periods make the noise repeat across both tile borders.
function noise(u, v, nx, ny, seed) {
  const x = u * nx, y = v * ny;
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = mod(ix, nx), y0 = mod(iy, ny), x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  const lower = a + (b - a) * fx, upper = c + (d - c) * fx;
  return (lower + (upper - lower) * fy) * 2 - 1;
}
function makePlateCuts(seed, n) {
  return Array.from({length: n}, (_, col) => {
    const count = 5 + Math.floor(hash(col, 11, seed) * 7);
    const offset = hash(col, 73, seed) * .8;
    return Array.from({length: count}, (_, i) => ({
      y: fract((i + .12 + hash(col, i + 101, seed) * .9 + offset) / count),
      slope: (hash(col, i + 619, seed) - .5) * .095,
      arc: (hash(col, i + 703, seed) - .5) * .042,
      width: .0022 + hash(col, i + 521, seed) * .0026,
      strength: .29 + hash(col, i + 389, seed) * .71,
    }));
  });
}
function cutDistance(y, xFraction, cuts) {
  let closest = 999, strength = 0, width = 1;
  for (const c of cuts) {
    const location = c.y + c.slope * (xFraction - .5) + c.arc * Math.sin(xFraction * TAU);
    const d = Math.abs(fract(y - location + .5) - .5);
    if (d < closest) { closest = d; strength = c.strength; width = c.width; }
  }
  return {distance: closest, width, strength};
}
/**
 * Pure generator. Height values are retained for a later normal-map stage;
 * the exported image for now is RGBA albedo only.
 * size is optional for fast deterministic tests; production is 1024 square.
 */
export function generateOakBark({structureSeed = 19641, surfaceSeed = 48507,
  colorSeed = 21749, size = OAK_BARK_SIZE} = {}) {
  validSeed(structureSeed); validSeed(surfaceSeed); validSeed(colorSeed);
  if (!Number.isInteger(size) || size < 32 || size > OAK_BARK_SIZE)
    throw Error('Invalid oak bark resolution');
  const pixels = new Uint8ClampedArray(size * size * 4);
  const heightField = new Float32Array(size * size);
  const bands = 25;
  const cracks = makePlateCuts(structureSeed, bands);
  const palette = [
    98 + Math.round(hash(3, 7, colorSeed) * 11),
    97 + Math.round(hash(7, 3, colorSeed) * 9),
    92 + Math.round(hash(5, 5, colorSeed) * 8),
  ];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, p = y * size + x, p4 = p * 4;
      const warp = .021 * noise(u, v, 3, 5, structureSeed ^ 0xa7391bf1)
        + .009 * noise(u, v, 7, 11, structureSeed ^ 0x4d941b43)
        + .006 * noise(u, v, 29, 37, structureSeed ^ 0x7c2ead91);
      const bandU = (u + warp) * bands;
      const col = mod(Math.floor(bandU), bands);
      const cell = fract(bandU);
      const d = Math.min(cell, 1 - cell);
      const crossWarp = .009 * noise(u, v, 5, 7, structureSeed ^ 0xc930a81d)
        + .003 * noise(u, v, 23, 17, structureSeed ^ 0x107d9c53);
      const cut = cutDistance(fract(v + crossWarp), cell, cracks[col]);
      const seamWidth = .083 + .027 * noise(u, v, 18, 13, structureSeed ^ 0x1cf2700d);
      const verticalCrack = 1 - smooth((d - seamWidth * .72) / (seamWidth * 1.35));
      const fractureWarp = .004 * noise(u, v, 45, 36, structureSeed ^ 0xc35c0d31);
      const horizontalCrack = (1 - smooth((cut.distance + fractureWarp - cut.width * .45) /
        (cut.width * 2.8))) * cut.strength;
      const fissure = clamp(Math.max(verticalCrack, horizontalCrack *
        (.75 + verticalCrack * .25)), 0, 1);
      const rim = smooth(.08, .20, d) - smooth(.21, .40, d);
      const island = .42 * noise(u, v, 22, 34, structureSeed ^ 0x949c1783)
        + .35 * noise(u, v, 44, 65, structureSeed ^ 0x1a39efc5);
      const grain = .37 * noise(u, v, 90, 16, surfaceSeed ^ 0x5a3f15d9)
        + .20 * noise(u, v, 195, 45, surfaceSeed ^ 0x47e2af35)
        + .12 * noise(u, v, 320, 133, surfaceSeed ^ 0x2d9b7a1b);
      const grit = noise(u, v, 390, 411, surfaceSeed ^ 0x43fa9117);
      const fine = noise(u, v, 512, 512, surfaceSeed ^ 0xa983149f);
      const fracture = Math.pow(Math.max(0, 1 - Math.abs(grain + .30 * grit) * 3.0),
        14) * .24;
      const relief = clamp(.47 + island * .42 + grain * .56 + grit * .1
        + fine * .075 + rim * .19 - fissure * .72 -
        fracture * (1 - fissure), 0, 1);
      heightField[p] = relief;
      const patina = noise(u, v, 13, 22, colorSeed ^ 0x15a28b97);
      const tone = (relief - .48) * 110 + island * 27 + grain * 22 +
        grit * 15 + fine * 11 + patina * 14 - fissure * 17;
      const lichen = Math.max(0, noise(u, v, 18, 20, colorSeed ^ 0x91b2c3e7)
        - .48) * 22;
      pixels[p4] = clamp(palette[0] + tone + patina * 3 - lichen * .15, 22, 212);
      pixels[p4 + 1] = clamp(palette[1] + tone * .94 + patina * 2 +
        lichen * .36, 22, 207);
      pixels[p4 + 2] = clamp(palette[2] + tone * .87 - patina +
        lichen * .22, 22, 200);
      pixels[p4 + 3] = 255;
    }
  }
  return {width: size, height: size, pixels, heightField};
}
export function paintOakBark(canvas, seeds = {}) {
  if (!canvas || typeof canvas.getContext !== 'function')
    throw Error('Invalid oak bark canvas');
  const image = generateOakBark(seeds);
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas 2D unavailable for oak bark');
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.pixels);
  ctx.putImageData(data, 0, 0);
  return {width: image.width, height: image.height, channels: 'RGBA', seamless: true};
}
