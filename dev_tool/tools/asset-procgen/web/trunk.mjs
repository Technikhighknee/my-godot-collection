// One living-stem segment. No branches, foliage, textures or exporters.
// All variation belongs to the stem: its centerline, cambial outline and buttresses.
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = t => t * t * (3 - 2 * t);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_STEM = Object.freeze({
  seed: 55,
  height: 7.9,
  radius: 0.73,
  taper: 0.78,
  character: 1.18,
  buttress: 0.9,
});

export function validateStem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid stem settings');
  const limits = { height: [5, 16], radius: [.28, 1], taper: [.35, .88], character: [0, 1.5], buttress: [0, 1.5] };
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) throw Error('Invalid seed');
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < min || input[key] > max) {
      throw Error('Invalid ' + key);
    }
  }
  if (input.radius / input.height > .14) throw Error('Stem is too wide for its height');
  return { seed: input.seed, height: input.height, radius: input.radius,
    taper: input.taper, character: input.character, buttress: input.buttress };
}

function makeSpine(params, rng) {
  const count = 12;
  const knots = [{ x: 0, y: 0, z: 0 }];
  const azimuth = rng() * TAU;
  // Direction has inertia. New yearly growth changes heading rather than
  // translating independent rings (which would create a wobbling cylinder).
  let vx = Math.cos(azimuth) * .020 * params.character;
  let vz = Math.sin(azimuth) * .020 * params.character;
  for (let j = 1; j <= count; j++) {
    const age = j / count;
    const bias = .071 * params.character;
    vx = clamp(vx * .87 + bias * (.28 * Math.cos(azimuth) + (rng() - .5) * 1.15), -.25, .25);
    vz = clamp(vz * .87 + bias * (.28 * Math.sin(azimuth) + (rng() - .5) * 1.15), -.25, .25);
    const prev = knots[j - 1];
    const stride = params.height / count;
    // Older lower wood remains calmer; crownward growth can change direction more.
    const gain = .45 + .55 * smooth(age);
    knots.push({ x: prev.x + vx * stride * gain, y: j * stride,
      z: prev.z + vz * stride * gain });
  }
  // Interpolate the centerline with C1 continuity, retaining the natural
  // accumulated displacement and avoiding sinusoidal or random ring jitter.
  function sample(t) {
    const scaled = clamp(t, 0, 1) * count;
    const i = Math.min(count - 1, Math.floor(scaled));
    const f = scaled - i, f2 = f * f, f3 = f2 * f;
    const before = knots[Math.max(0, i - 1)], a = knots[i], b = knots[i + 1],
      after = knots[Math.min(count, i + 2)];
    const h00 = 2*f3 - 3*f2 + 1, h10 = f3 - 2*f2 + f,
      h01 = -2*f3 + 3*f2, h11 = f3 - f2;
    const coordinate = k => h00*a[k] + h10*(b[k] - before[k])*.5 +
      h01*b[k] + h11*(after[k] - a[k])*.5;
    return [coordinate('x'), t * params.height, coordinate('z')];
  }
  return sample;
}

function rootBases(rng) {
  const n = 5 + (rng() > .65 ? 1 : 0);
  const start = rng() * TAU;
  return Array.from({ length: n }, (_, j) => ({
    angle: start + TAU * (j + (rng() - .5) * .20) / n,
    reach: .66 + rng() * .58,
    height: .9 + rng() * 1.1,
    width: .19 + rng() * .11,
    turn: (rng() - .5) * .18,
  }));
}

function healedScars(rng, height) {
  // The stem can carry old healed branch traces without generating any branches.
  // Most years leave no large scar; keep these sparse and shallow.
  const scars = [];
  for (let i = 0; i < 3; i++) scars.push({
    angle: rng() * TAU,
    y: height * (.18 + .57 * (i + .24 * rng()) / 3),
    width: .22 + rng() * .12,
    length: .24 + rng() * .19,
    depth: .017 + rng() * .018,
  });
  return scars;
}

function frameAt(spine, t) {
  const a = spine(clamp(t - .001, 0, 1));
  const b = spine(clamp(t + .001, 0, 1));
  const tx = (b[0] - a[0]) / Math.max(.00001, b[1] - a[1]);
  const tz = (b[2] - a[2]) / Math.max(.00001, b[1] - a[1]);
  // One consistently oriented frame; no Frenet flips at nearly straight sections.
  const ux = 1 / Math.sqrt(1 + tx * tx), uy = -tx * ux;
  const vx = uy * tz, vy = -ux * tz, vz = ux - uy * tx;
  const len = Math.hypot(vx, vy, vz);
  return { center: spine(t), u: [ux, uy, 0], v: [vx / len, vy / len, vz / len] };
}

function createStemPoint(t, angle, params, spine, roots, scars, phases) {
  const y = t * params.height, f = frameAt(spine, t);
  // Growth continues through a progressively thinner leader. The entire
  // stem participates in tapering; there is NO terminal pinching function.
  // Derivative grows gradually with height, not abruptly at the last rings.
  // A small nonzero end section remains for the next growth stage.
  const taper = 1 - params.taper * (.62 * t + .38 * t * t);
  const broadFoot = params.buttress * .11 * Math.exp(-Math.pow(y / 1.5, 1.7));
  let buttress = 0;
  for (const root of roots) {
    const fade = Math.exp(-Math.pow(y / root.height, 1.4));
    const width = root.width * (.54 + .46 * Math.exp(-y / .8));
    const deviation = wrap(angle - root.angle - root.turn * (1 - Math.exp(-y / 1.4)));
    const rib = Math.exp(-.5 * Math.pow(deviation / width, 2));
    buttress += params.buttress * root.reach * .29 * fade * rib;
  }
  // Coherent longitudinal cambium contours. Frequencies are almost entirely
  // circumferential; their phase meanders gently over height, never ring by ring.
  const char = params.character;
  const drift = .08 * Math.sin(y * .41 + phases[0]) + .033 * Math.sin(y * .93 + phases[1]);
  const outer = .05 * char * Math.cos(3 * angle + phases[2] + drift) +
    .027 * char * Math.cos(6 * angle - phases[3] + drift * 1.25);
  const grainAngle = angle + drift * .36;
  const relief = .014 * char * Math.cos(13 * grainAngle + phases[4]) +
    .006 * char * Math.cos(27 * grainAngle - phases[5] + .05 * Math.sin(y * 1.6));
  let healed = 0;
  for (const scar of scars) {
    const dx = wrap(angle - scar.angle) / scar.width;
    const dy = (y - scar.y) / scar.length;
    const dist = Math.hypot(dx, dy);
    // Narrow raised callus around a depressed oval with a soft growth tail.
    // It stays part of the cambial surface: no stuck-on knot cylinders.
    const rim = Math.exp(-Math.pow((dist - 1.05) / .30, 2));
    const eye = Math.exp(-dist * dist * 3);
    const wake = Math.exp(-dx * dx * 2 - Math.pow((dy + 1.65) / 1.7, 2));
    healed += scar.depth * (.64 * rim - .42 * eye + .19 * wake);
  }
  const r = params.radius * (taper * (1 + broadFoot + outer + relief) + buttress) + healed;
  return [f.center[0] + r * (Math.cos(angle) * f.u[0] + Math.sin(angle) * f.v[0]),
    f.center[1] + r * (Math.cos(angle) * f.u[1] + Math.sin(angle) * f.v[1]),
    f.center[2] + r * (Math.cos(angle) * f.u[2] + Math.sin(angle) * f.v[2])];
}

export function generateStem(raw = DEFAULT_STEM) {
  const settings = validateStem(raw);
  const rng = random(settings.seed);
  const spine = makeSpine(settings, rng);
  const roots = rootBases(rng);
  const scars = healedScars(rng, settings.height);
  const phases = Array.from({ length: 6 }, () => rng() * TAU);
  const vertical = 180, around = 104, stride = around + 1;
  const positions = new Float32Array(((vertical + 1) * stride + 2) * 3);
  const normals = new Float32Array(positions.length);
  const indices = [];
  for (let j = 0; j <= vertical; j++) {
    const t = j / vertical;
    for (let i = 0; i <= around; i++) {
      const angle = i === around ? 0 : TAU * i / around;
      positions.set(createStemPoint(t, angle, settings, spine, roots, scars, phases), (j * stride + i) * 3);
    }
  }
  // Derivative normals follow both the axial wood sweep and real radial relief.
  for (let j = 0; j <= vertical; j++) {
    const previous = Math.max(0, j - 1), next = Math.min(vertical, j + 1);
    for (let i = 0; i <= around; i++) {
      const left = i === 0 ? around - 1 : i - 1;
      const right = i === around ? 1 : i + 1;
      const a = (j * stride + left) * 3, b = (j * stride + right) * 3;
      const c = (previous * stride + i) * 3, d = (next * stride + i) * 3;
      const theta = [positions[b] - positions[a], positions[b+1] - positions[a+1], positions[b+2] - positions[a+2]];
      const axial = [positions[d] - positions[c], positions[d+1] - positions[c+1], positions[d+2] - positions[c+2]];
      const nx = axial[1]*theta[2] - axial[2]*theta[1];
      const ny = axial[2]*theta[0] - axial[0]*theta[2];
      const nz = axial[0]*theta[1] - axial[1]*theta[0];
      const length = Math.hypot(nx, ny, nz) || 1;
      normals.set([nx/length, ny/length, nz/length], (j * stride + i) * 3);
    }
  }
  for (let j = 0; j < vertical; j++) for (let i = 0; i < around; i++) {
    const a = j * stride + i, b = a + stride;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // The end rings already lie in the planes normal to the growth axis.
  // Their caps must use the same axis, rather than world-up shading.
  const baseTangent = (t) => {
    const a = spine(clamp(t - .001, 0, 1));
    const b = spine(clamp(t + .001, 0, 1));
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return [dx / len, dy / len, dz / len];
  };
  // Modeling boundaries: the geometry can later be extended with branching.
  const base = (vertical + 1) * stride, end = base + 1;
  positions.set(spine(0), base * 3);
  positions.set(spine(1), end * 3);
  const bottomDirection = baseTangent(0), topDirection = baseTangent(1);
  normals.set(bottomDirection.map(v => -v), base * 3);
  normals.set(topDirection, end * 3);
  for (let i = 0; i < around; i++) {
    indices.push(base, i, i + 1);
    const top = vertical * stride;
    indices.push(end, top + i + 1, top + i);
  }
  return { positions, normals, indices: new Uint32Array(indices),
    rings: vertical + 1, sides: around, settings };
}
