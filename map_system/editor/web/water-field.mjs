/** Deterministic, source-connected water on the same diagonal triangles as Godot terrain. */
const finite = v => typeof v === 'number' && Number.isFinite(v);

export function validateWaterSources(entries, size, occupiedIds = []) {
  if (!Array.isArray(entries)) throw new Error('Invalid water sources');
  const ids = new Set(occupiedIds);
  let seas = 0;
  for (const water of entries) {
    if (!water || typeof water !== 'object' || Array.isArray(water) || typeof water.id !== 'string' || !water.id.trim() || ids.has(water.id)) throw new Error('Invalid or duplicate water ID');
    ids.add(water.id);
    if (!finite(water.height)) throw new Error('Invalid water level');
    if (water.definition === 'water.sea') {
      if (Object.keys(water).sort().join() !== 'definition,height,id' || ++seas > 1) throw new Error('Only one sea level is permitted');
    } else if (water.definition === 'water.lake') {
      if (Object.keys(water).sort().join() !== 'definition,height,id,source' || !Array.isArray(water.source) || water.source.length !== 2 || !water.source.every(finite) || water.source[0] < 0 || water.source[1] < 0 || water.source[0] > size[0] || water.source[1] > size[1]) throw new Error('Invalid lake source position');
    } else throw new Error('Unknown water definition');
  }
  return entries;
}

function gridPoint(map, height, index) {
  const col = index % height.width, row = Math.floor(index / height.width);
  return [col * map.size[0] / (height.width - 1), row * map.size[1] / (height.height - 1)];
}

function clipBelow(polygon, level) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], insideA = a[2] < level, insideB = b[2] < level;
    if (insideA !== insideB) {
      const t = (level - a[2]) / (b[2] - a[2]);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    if (insideB) result.push([b[0], b[1]]);
  }
  return result;
}

/** A triangle's three shared edges are indexed by its adjacent terrain triangles. */
function triangleVertices(t, w) {
  const cx = w - 1, cell = t >> 1, x = cell % cx, z = Math.floor(cell / cx);
  const a = z * w + x, b = a + w, c = a + 1, d = b + 1;
  return t & 1 ? [c, b, d] : [a, b, c];
}

function addTriangle(output, mask, t, w, map, height, level) {
  const ids = triangleVertices(t, w);
  const tri = ids.map(i => [...gridPoint(map, height, i), map.min_height + height.data[i] * (map.max_height - map.min_height)]);
  const polygon = clipBelow(tri, level);
  if (polygon.length < 3) return;
  const a = polygon[0];
  for (let i = 1; i + 1 < polygon.length; i++) {
    for (const p of [a, polygon[i], polygon[i + 1]]) output.push(p[0], level + 0.025, p[1]);
  }
}

export function buildWaterRegions(map, height, entries) {
  validateWaterSources(entries, map.size);
  const w = height.width, rows = height.height, cx = w - 1, cz = rows - 1, triCount = cx * cz * 2;
  const regions = [];
  for (const entry of entries) {
    const level = entry.height, normalized = (level - map.min_height) / (map.max_height - map.min_height);
    const wet = index => height.data[index] < normalized;
    const mask = new Uint8Array(triCount), queue = new Int32Array(triCount);
    let tail = 0, head = 0;
    function visit(t) {
      if (t < 0 || t >= triCount || mask[t]) return;
      mask[t] = 1;
      queue[tail++] = t;
    }
    if (entry.definition === 'water.sea') {
      for (let z = 0; z < cz; z++) {
        const left = z * w, right = left + cx;
        if (wet(left) || wet(left + w)) visit((z * cx) * 2);
        if (wet(right) || wet(right + w)) visit((z * cx + cx - 1) * 2 + 1);
      }
      for (let x = 0; x < cx; x++) {
        if (wet(x) || wet(x + 1)) visit(x * 2);
        const bottom = (cz - 1) * w + x + w;
        if (wet(bottom) || wet(bottom + 1)) visit(((cz - 1) * cx + x) * 2 + 1);
      }
    } else {
      const [x, z] = entry.source;
      const gx = x / map.size[0] * cx, gz = z / map.size[1] * cz;
      const ix = Math.min(cx - 1, Math.floor(gx)), iz = Math.min(cz - 1, Math.floor(gz));
      const fx = gx - ix, fz = gz - iz;
      const t = (iz * cx + ix) * 2 + (fx + fz <= 1 ? 0 : 1);
      const [a,b,c] = triangleVertices(t,w);
      const weights = fx + fz <= 1 ? [1-fx-fz,fz,fx] : [1-fz,1-fx,fx+fz-1];
      const source = (height.data[a]*weights[0]+height.data[b]*weights[1]+height.data[c]*weights[2]);
      if (!(source < normalized)) throw new Error(`Lake ${entry.id} source must be below its water level`);
      visit(t);
    }
    while (head < tail) {
      const t = queue[head++], cell = t >> 1, ix = cell % cx, iz = Math.floor(cell / cx);
      const a = iz*w+ix, b = a+w, c=a+1, d=b+1;
      if ((t&1) === 0) {
        if (ix > 0 && (wet(a) || wet(b))) visit(t-1);  // left cell, right triangle
        if (iz > 0 && (wet(a) || wet(c))) visit(t-cx*2+1); // upper cell, lower triangle
        if (wet(b) || wet(c)) visit(t+1); // diagonal
      } else {
        if (ix+1 < cx && (wet(c) || wet(d))) visit(t+1); // next cell, left triangle
        if (iz+1 < cz && (wet(b) || wet(d))) visit(t+cx*2-1); // lower cell, upper triangle
        if (wet(b) || wet(c)) visit(t-1); // diagonal
      }
    }
    const positions = [];
    for (let i = 0; i < head; i++) addTriangle(positions, mask, queue[i], w, map, height, level);
    regions.push({ id: entry.id, definition: entry.definition, level, mask, positions: new Float32Array(positions), triangleCount: head });
  }
  return regions;
}

/** Point query is exact within the height-field's piecewise-linear triangles. */
export function waterAt(map, height, regions, x, z) {
  const cx = height.width-1, cz = height.height-1;
  if (x<0 || z<0 || x>map.size[0] || z>map.size[1]) return null;
  const gx=x/map.size[0]*cx, gz=z/map.size[1]*cz;
  const ix=Math.min(cx-1,Math.floor(gx)), iz=Math.min(cz-1,Math.floor(gz));
  const t=2*(iz*cx+ix)+(gx-ix+gz-iz<=1?0:1);
  const [a,b,c]=triangleVertices(t,height.width), tx=gx-ix,tz=gz-iz;
  const weights=(t&1)?[1-tz,1-tx,tx+tz-1]:[1-tx-tz,tz,tx];
  const elevation=map.min_height+(height.data[a]*weights[0]+height.data[b]*weights[1]+height.data[c]*weights[2])*(map.max_height-map.min_height);
  return regions.find(region=>region.mask[t] && elevation < region.level)?.id ?? null;
}

function overlapConvex(a, b) {
  for (const poly of [a,b]) for(let i=0;i<poly.length;i++) {
    const p=poly[i],q=poly[(i+1)%poly.length],nx=q[1]-p[1],ny=p[0]-q[0];
    let minA=Infinity,maxA=-Infinity,minB=Infinity,maxB=-Infinity;
    for(const v of a){const d=v[0]*nx+v[1]*ny;minA=Math.min(minA,d);maxA=Math.max(maxA,d);}
    for(const v of b){const d=v[0]*nx+v[1]*ny;minB=Math.min(minB,d);maxB=Math.max(maxB,d);}
    if (Math.min(maxA,maxB)-Math.max(minA,minB)<=1e-8*Math.hypot(nx,ny)) return false;
  }
  return true;
}

/** Checks actual clipped flooded triangles, not just the four footprint corners. */
export function waterOverlapsFootprint(map, height, regions, footprint) {
  const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1]);
  const cx=height.width-1,cz=height.height-1;
  const minx=Math.max(0,Math.floor(Math.min(...xs)/map.size[0]*cx));
  const maxx=Math.min(cx-1,Math.floor(Math.max(...xs)/map.size[0]*cx));
  const minz=Math.max(0,Math.floor(Math.min(...zs)/map.size[1]*cz));
  const maxz=Math.min(cz-1,Math.floor(Math.max(...zs)/map.size[1]*cz));
  for(const region of regions) for(let z=minz;z<=maxz;z++) for(let x=minx;x<=maxx;x++)for(let k=0;k<2;k++){
    const t=2*(z*cx+x)+k;
    if(!region.mask[t])continue;
    const tri=triangleVertices(t,height.width).map(i=>[...gridPoint(map,height,i),map.min_height+height.data[i]*(map.max_height-map.min_height)]);
    const wet=clipBelow(tri,region.level);
    if(wet.length>=3 && overlapConvex(footprint,wet)) return region.id;
  }
  return null;
}
