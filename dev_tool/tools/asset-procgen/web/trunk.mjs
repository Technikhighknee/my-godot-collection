// Dominant trunk-to-leader flow. No lateral branches, foliage, textures or exports.
const TAU = Math.PI * 2;
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
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
  radius: .73,
  character: .9,
  buttress: .75,
  leaderStart: .45,
  leaderReach: 1.12,
  lean: .08,
});

export function validateStem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('Invalid stem settings');
  }
  const limits = {
    height: [5, 16], radius: [.28, 1],
    character: [0, 1.5], buttress: [0, 1.5],
    leaderStart: [.25, .7], leaderReach: [0, 1.5],
    lean: [-.3, .3],
  };
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw Error('Invalid seed');
  }
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (typeof input[key] !== 'number' ||
      !Number.isFinite(input[key]) || input[key] < min || input[key] > max) {
      throw Error('Invalid ' + key);
    }
  }
  if (input.radius / input.height > .16) throw Error('Stem is too wide for its height');
  return {
    seed: input.seed, height: input.height, radius: input.radius,
    character: input.character, buttress: input.buttress,
    leaderStart: input.leaderStart, leaderReach: input.leaderReach,
    lean: input.lean,
  };
}

// Integrate a changing GROWTH DIRECTION. Do not drag the center of each
// independent cross-section sideways: the tangent must follow the wood.
// As the leader develops, growth changes from predominantly upward to
// oblique; it continues in that direction instead of returning to vertical.
function growthPath(settings, rng) {
  const phase = rng() * TAU;
  // A seed can turn in ANY horizontal direction, rather than always +X.
  const azimuth = rng() * TAU;
  const bendOnset = .53 + rng() * .15;
  const bendAngle = (.36 + rng() * .38) * settings.leaderReach;
  const count = 96;
  const knots = [[0, 0, 0]];

  for (let i = 1; i <= count; i++) {
    const t = (i - .5) / count;
    const progress = smooth(clamp((t - bendOnset) / (.96 - bendOnset), 0, 1));
    const smallDrift = settings.character * .025 *
      Math.sin(t * 4.1 + phase) * t * (1 - t);
    const angle = settings.lean * .08 + bendAngle * progress + smallDrift;
    const heading = azimuth + settings.character * .05 *
      Math.sin(t * 2.7 + phase * .7) * progress;
    const prev = knots[i - 1], step = 1 / count;
    knots.push([
      prev[0] + Math.sin(angle) * Math.cos(heading) * step,
      prev[1] + Math.cos(angle) * step,
      prev[2] + Math.sin(angle) * Math.sin(heading) * step,
    ]);
  }

  const scale = settings.height / knots[count][1];
  for (const p of knots) for (let k = 0; k < 3; k++) p[k] *= scale;

  function sample(t) {
    const x = clamp(t, 0, 1) * count;
    const i = Math.min(count - 1, Math.floor(x));
    const f = x - i, f2 = f * f, f3 = f2 * f;
    const p0 = knots[Math.max(0, i - 1)], p1 = knots[i];
    const p2 = knots[i + 1], p3 = knots[Math.min(count, i + 2)];
    const a = 2*f3 - 3*f2 + 1, b = f3 - 2*f2 + f;
    const cc = -2*f3 + 3*f2, d = f3 - f2;
    return [0, 1, 2].map(k =>
      a*p1[k] + .5*b*(p2[k] - p0[k]) +
      cc*p2[k] + .5*d*(p3[k] - p1[k]));
  }
  return { sample, azimuth, phase };
}

function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

function unit(a) {
  const len = Math.hypot(...a) || 1;
  return a.map(x => x / len);
}

function frameAt(path, t) {
  const dt = .0008;
  const a = path.sample(clamp(t - dt, 0, 1));
  const b = path.sample(clamp(t + dt, 0, 1));
  const T = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  // The reference direction is sideways relative to the leader's turn,
  // rather than world-up. This frame cannot flip as the path bends.
  const reference = [-Math.sin(path.azimuth), 0, Math.cos(path.azimuth)];
  const projected = reference.map((x, i) =>
    x - T[i] * (reference[0]*T[0] + reference[2]*T[2]));
  const U = unit(projected);
  const V = unit(cross(U, T));
  return { center: path.sample(t), tangent: T, u: U, v: V };
}

function rootBases(rng) {
  const count = rng() > .55 ? 5 : 4;
  const offset = rng() * TAU;
  return Array.from({ length: count }, (_, i) => ({
    angle: offset + i * TAU / count + (rng() - .5) * .2,
    reach: .65 + rng() * .5,
    width: .21 + rng() * .07,
    height: .75 + rng() * .65,
  }));
}

// Virtual branch departures describe where the main leader relinquishes
// cross-sectional area. They affect geometry only: no branches are rendered.
function latentBranchPlan(rng) {
  const count = 11 + Math.floor(rng() * 4);
  const first = .29 + rng() * .055;
  const last = .965 + rng() * .015;
  const events = [];
  for (let i = 0; i < count; i++) {
    const fraction = (i + .4*(rng() - .5)) / (count - 1);
    const t = first + (last - first) * clamp(fraction, 0, 1);
    const lostArea = .13 + .16*rng();
    events.push({
      t,
      remainingArea: 1 - lostArea,
      halfWidth: .012 + .008*rng(),
    });
  }
  return events;
}

// A parent carries the sum of surviving leader and departed branch area.
// Quasi-Leonardo scaling acts on AREA, hence radius scales with sqrt(area).
function survivingArea(t, events) {
  let ratio = 1;
  for (const event of events) {
    const progress = smooth(clamp((t - event.t + event.halfWidth) /
      (2*event.halfWidth), 0, 1));
    ratio *= 1 - (1 - event.remainingArea) * progress;
  }
  return ratio;
}

function trunkRadius(t, settings, events) {
  // The low trunk retains its mass. Virtual branch loading becomes
  // progressively relevant only once the crownward structure develops.
  const gradualGrowth = 1 - .13*smooth(clamp((t - .12)/.75,0,1));
  const area = survivingArea(t, events);
  // No late needle factor: distal scale follows the remaining load.
  return settings.radius * gradualGrowth * Math.sqrt(area);
}

function sectionRadius(t, angle, settings, path, roots, events) {
  const axialDistance = t * settings.height;
  const flow = .07*Math.sin(1.05*axialDistance + path.phase) +
    .03*Math.sin(.46*axialDistance + 1.7*path.phase);
  const ridges = settings.character * (
    .028*Math.cos(3*angle + flow) +
    .012*Math.cos(5*angle - .55*flow) +
    .004*Math.cos(11*angle + .3*flow));

  let rootLoad = 0;
  for (const root of roots) {
    const delta = wrap(angle - root.angle - .05*flow);
    const width = root.width * (.72 + .28*Math.exp(-axialDistance/.75));
    const footprint = Math.exp(-.5*Math.pow(delta/width, 2));
    rootLoad += settings.buttress*root.reach*.22 *
      Math.exp(-Math.pow(axialDistance/root.height, 1.55))*footprint;
  }
  const collar = settings.buttress*.085 *
    Math.exp(-Math.pow(axialDistance/.95, 1.55));
  const loadRadius = trunkRadius(t, settings, events);
  return Math.max(.0015, loadRadius*(1 + ridges + collar) +
    settings.radius*rootLoad);
}

export function generateStem(raw = DEFAULT_STEM) {
  const settings = validateStem(raw);
  const rng = random(settings.seed);
  const roots = rootBases(rng);
  const events = latentBranchPlan(rng);
  const path = growthPath(settings, rng);

  const rings = 201, sides = 96, stride = sides + 1;
  const bodyVerts = rings * stride;
  const positions = new Float32Array((bodyVerts + 2) * 3);
  const normals = new Float32Array(positions.length);
  const indices = [];

  for (let j = 0; j < rings; j++) {
    const t = j / (rings - 1);
    const f = frameAt(path, t);
    for (let i = 0; i <= sides; i++) {
      const angle = i === sides ? 0 : TAU*i/sides;
      const r = sectionRadius(t, angle, settings, path, roots, events);
      const co = Math.cos(angle), si = Math.sin(angle);
      const ix = (j*stride + i)*3;
      positions[ix] = f.center[0] + r*(co*f.u[0] + si*f.v[0]);
      positions[ix+1] = f.center[1] + r*(co*f.u[1] + si*f.v[1]);
      positions[ix+2] = f.center[2] + r*(co*f.u[2] + si*f.v[2]);
    }
  }

  for (let j = 0; j < rings; j++) for (let i = 0; i <= sides; i++) {
    const left = i === 0 ? sides - 1 : i - 1;
    const right = i === sides ? 1 : i + 1;
    const a = (j*stride+left)*3, b = (j*stride+right)*3;
    const c = (Math.max(0,j-1)*stride+i)*3;
    const d = (Math.min(rings-1,j+1)*stride+i)*3;
    const angular = [positions[b]-positions[a],
      positions[b+1]-positions[a+1], positions[b+2]-positions[a+2]];
    const axial = [positions[d]-positions[c],
      positions[d+1]-positions[c+1], positions[d+2]-positions[c+2]];
    const n = unit(cross(axial, angular));
    normals.set(n, (j*stride+i)*3);
  }

  for (let j = 0; j < rings-1; j++) for (let i = 0; i < sides; i++) {
    const a = j*stride+i, b = a+stride;
    indices.push(a,b,a+1, a+1,b,b+1);
  }

  const baseIndex = bodyVerts, apexIndex = bodyVerts + 1;
  const start = frameAt(path, 0), end = frameAt(path, 1);
  positions.set(start.center, baseIndex*3);
  normals.set(start.tangent.map(v => -v), baseIndex*3);
  for (let i = 0; i < sides; i++) indices.push(baseIndex,i,i+1);

  // A tiny continuation into the tangent closes the leader naturally.
  // Unlike the previous end cap, this is one apex rather than a cut face.
  positions.set(end.center.map((v,k) =>
    v + end.tangent[k]*Math.min(.03, settings.radius*.04)), apexIndex*3);
  normals.set(end.tangent, apexIndex*3);
  const last = (rings-1)*stride;
  for (let i = 0; i < sides; i++) indices.push(apexIndex,last+i+1,last+i);

  return {
    positions, normals, indices: Uint32Array.from(indices),
    rings, sides, settings,
  };
}
