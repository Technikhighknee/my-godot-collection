/** Spatial placement preview. Inputs use Godot's [x,z] map coordinates and clockwise degrees. */
const EPS = 1e-7;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => Array.isArray(p) && p.length === 2 && p.every(finite);
const area = points => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0) / 2;
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1];
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const edges = poly => poly.map((p,i)=>[p,poly[(i+1)%poly.length]]);
const lineIntersection = (a,b,c,d) => { const ab=sub(b,a), cd=sub(d,c), det=ab[0]*cd[1]-ab[1]*cd[0]; if(Math.abs(det)<1e-12) return b; const ac=sub(c,a),t=(ac[0]*cd[1]-ac[1]*cd[0])/det; return [a[0]+t*ab[0],a[1]+t*ab[1]]; };
const insideLine = (p,a,b,sign) => cross(a,b,p)*sign>=-EPS;
function clipConvex(subject, clipper) {
  let output = subject;
  const sign = area(clipper)>=0 ? 1 : -1;
  for (const [a,b] of edges(clipper)) {
    const input = output; output=[];
    if(!input.length)break;
    for(let i=0;i<input.length;i++){
      const p=input[i], q=input[(i+1)%input.length]; const pi=insideLine(p,a,b,sign),qi=insideLine(q,a,b,sign);
      if(pi && qi) output.push(q);
      else if(pi && !qi) output.push(lineIntersection(p,q,a,b));
      else if(!pi && qi) output.push(lineIntersection(p,q,a,b),q);
    }
  }
  return output;
}
const strictCross=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-EPS && cross(c,d,a)*cross(c,d,b)<-EPS;
function containsPoint(p,poly){
  let inside=false;
  for(const [a,b] of edges(poly)){
    if(Math.abs(cross(a,b,p))<EPS && p[0]>=Math.min(a[0],b[0])-EPS && p[0]<=Math.max(a[0],b[0])+EPS && p[1]>=Math.min(a[1],b[1])-EPS && p[1]<=Math.max(a[1],b[1])+EPS) return true;
    if((a[1]>p[1]) !== (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
// Check the entire perimeter, including concave corners and coincident edges.
function segmentContained(a,b,polygon){
  const ab=sub(b,a), length=dot(ab,ab);
  if(length<EPS)return containsPoint(a,polygon);
  const stops=[0,1];
  for(const [c,d] of edges(polygon)){
    const cd=sub(d,c),det=ab[0]*cd[1]-ab[1]*cd[0],ac=sub(c,a);
    if(Math.abs(det)>EPS){
      const t=(ac[0]*cd[1]-ac[1]*cd[0])/det;
      const u=(ac[0]*ab[1]-ac[1]*ab[0])/det;
      if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS)stops.push(Math.max(0,Math.min(1,t)));
    }else if(Math.abs(cross(a,b,c))<EPS){
      for(const p of [c,d])stops.push(Math.max(0,Math.min(1,dot(sub(p,a),ab)/length)));
    }
  }
  stops.sort((a,b)=>a-b);
  for(let i=1;i<stops.length;i++){
    const t=(stops[i-1]+stops[i])/2;
    if(stops[i]-stops[i-1]>EPS&&!containsPoint([a[0]+t*ab[0],a[1]+t*ab[1]],polygon))return false;
  }
  return true;
}
function contained(subject, container){
  return subject.every(p=>containsPoint(p,container)) && edges(subject).every(([a,b])=>segmentContained(a,b,container));
}
function strictlyInside(p,poly){
  for(const [a,b] of edges(poly))if(Math.abs(cross(a,b,p))<EPS && p[0]>=Math.min(a[0],b[0])-EPS && p[0]<=Math.max(a[0],b[0])+EPS && p[1]>=Math.min(a[1],b[1])-EPS && p[1]<=Math.max(a[1],b[1])+EPS)return false;
  return containsPoint(p,poly);
}
function overlapConvexPolygon(rect,polygon){
  for(const [a,b] of edges(rect))for(const [c,d] of edges(polygon))if(strictCross(a,b,c,d))return true;
  const checks=poly=>[...poly,...edges(poly).map(([a,b])=>[(a[0]+b[0])/2,(a[1]+b[1])/2])];
  if(checks(rect).some(p=>strictlyInside(p,polygon))||checks(polygon).some(p=>strictlyInside(p,rect)))return true;
  const center=rect.reduce((a,p)=>[a[0]+p[0]/rect.length,a[1]+p[1]/rect.length],[0,0]);
  return strictlyInside(center,polygon);
}
function pointSegmentDistance(p,a,b) {
  const delta=sub(b,a),length=dot(delta,delta);
  const t=length>0? Math.max(0,Math.min(1,dot(sub(p,a),delta)/length)):0;
  return distance(p,[a[0]+delta[0]*t,a[1]+delta[1]*t]);
}
function segmentDistance(a,b,c,d){
  if(strictCross(a,b,c,d))return 0;
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}
function roadDistance(point,roads){
  let best={road_id:'',road_distance:Infinity};
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const value=Math.max(0,pointSegmentDistance(point,road.points[i-1],road.points[i])-road.width/2);
    if(value<best.road_distance)best={road_id:road.id,road_distance:value};
  }
  return best;
}
function intersectsRoad(rect,road){
  const r=road.width/2;
  // Conservative ribbon approximation for editor use. Godot's mitered offset geometry is authoritative.
  for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i];
    if(strictlyInside(a,rect)||strictlyInside(b,rect))return true;
    const min=Math.min(...edges(rect).map(([c,d])=>segmentDistance(a,b,c,d)));
    if(min<r-EPS)return true;
  }
  return false;
}
export function footprint(definition,position,rotation){
  const [w,d]=definition.footprint;const half=[[ -w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
  const a=-rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return half.map(([x,z])=>[position[0]+c*x-s*z,position[1]+s*x+c*z]);
}
export function validatePlacementDefinitions(value){
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>k!=='buildings') || !Array.isArray(value.buildings))throw new Error('Invalid placement definitions: expected { buildings: [...] }');
  const ids=new Set();
  for(const d of value.buildings){
    if(!d || typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['id','footprint','requires_build_area','max_slope','entrance','max_road_distance'].includes(k))||
      typeof d.id!=='string'||!d.id.trim()||ids.has(d.id)||!point(d.footprint)||d.footprint.some(x=>x<=0)||
      (d.requires_build_area!==undefined && typeof d.requires_build_area!=='boolean')||
      (d.max_slope!==undefined && (!finite(d.max_slope)||d.max_slope<0||d.max_slope>=90))||
      (d.entrance!==undefined && !point(d.entrance))||
      (d.max_road_distance!==undefined && (!finite(d.max_road_distance)||d.max_road_distance<0||!point(d.entrance)))) throw new Error('Invalid placement definition: '+String(d?.id));
    ids.add(d.id);
  }
  return value;
}
function slopeUnder(doc,rect){
  const {map,height}=doc, size=map.terrain.size, spacing=[size[0]/(height.width-1),size[1]/(height.height-1)];
  const xs=rect.map(p=>p[0]), zs=rect.map(p=>p[1]);
  const x0=Math.max(0,Math.floor(Math.min(...xs)/spacing[0])),x1=Math.min(height.width-2,Math.floor(Math.max(...xs)/spacing[0]));
  const z0=Math.max(0,Math.floor(Math.min(...zs)/spacing[1])),z1=Math.min(height.height-2,Math.floor(Math.max(...zs)/spacing[1]));
  const scale=map.terrain.max_height-map.terrain.min_height;
  let maximum=0;
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const p=[x*spacing[0],z*spacing[1]],a=p,b=[p[0]+spacing[0],p[1]],c=[p[0],p[1]+spacing[1]],d=[b[0],c[1]];
    const h=(xx,zz)=>height.data[zz*height.width+xx]*scale;
    const ha=h(x,z),hb=h(x+1,z),hc=h(x,z+1),hd=h(x+1,z+1);
    const triangles=[[[a,c,b],(hb-ha)/spacing[0],(hc-ha)/spacing[1]],[[b,c,d],(hd-hc)/spacing[0],(hd-hb)/spacing[1]]];
    for(const [tri,dx,dz] of triangles){
      const cut=clipConvex(rect,tri);
      if(cut.length>=3 && Math.abs(area(cut))>EPS)maximum=Math.max(maximum,Math.atan(Math.hypot(dx,dz))*180/Math.PI);
    }
  }
  return maximum;
}
/** Checks one candidate against the current *editable* map/height state. */
export function checkBuildingPlacement(doc, definition, candidate, allBuildings = doc.map.buildings){
  if(!definition)return {valid:false,reason:'unknown_definition'};
  const pos=candidate.position,rot=candidate.rotation,map=doc.map;
  if(!point(pos)||!finite(rot))return {valid:false,reason:'invalid_position'};
  const rect=footprint(definition,pos,rot), size=map.terrain.size;
  if(rect.some(([x,z])=>x < -EPS||z < -EPS||x>size[0]+EPS||z>size[1]+EPS))return {valid:false,reason:'outside_map',footprint:rect};
  let settlementId='';
  if(definition.requires_build_area!==false){
    const settlement=map.settlements.find(s=>s.build_areas.some(poly=>contained(rect,poly)));
    if(!settlement)return {valid:false,reason:'outside_build_area',footprint:rect};
    settlementId=settlement.id;
  }
  for(const water of map.water)if(overlapConvexPolygon(rect,water.polygon))return {valid:false,reason:'overlaps_water',blocking_id:water.id,footprint:rect};
  for(const road of map.roads)if(intersectsRoad(rect,road))return {valid:false,reason:'overlaps_road',blocking_id:road.id,footprint:rect};
  for(const other of allBuildings){
    if(other.id===candidate.id)continue;
    const otherDef=doc.definitions?.buildings.find(d=>d.id===other.definition);
    if(!otherDef)return {valid:false,reason:'unverified_neighbor',blocking_id:other.id,footprint:rect};
    if(overlapConvexPolygon(rect,footprint(otherDef,other.position,other.rotation)))return {valid:false,reason:'overlaps_building',blocking_id:other.id,footprint:rect};
  }
  const slope=slopeUnder(doc,rect);
  if(definition.max_slope!==undefined && slope>definition.max_slope+1e-7)return {valid:false,reason:'terrain_too_steep',slope,footprint:rect};
  const a=-rot*Math.PI/180,c=Math.cos(a),s=Math.sin(a),e=definition.entrance??[0,0];
  const entrance=[pos[0]+c*e[0]-s*e[1],pos[1]+s*e[0]+c*e[1]];
  const nearest=roadDistance(entrance,map.roads);
  if(definition.max_road_distance!==undefined && nearest.road_distance>definition.max_road_distance)return {valid:false,reason:'road_too_far',...nearest,slope,footprint:rect};
  return {valid:true,reason:'',settlement_id:settlementId,slope,...nearest,footprint:rect};
}
/** Validate changed placements and known buildings affected by map/terrain changes. */
export function validateBuildingChanges(doc, original, definitions){
  validatePlacementDefinitions(definitions);
  const old=new Map(original.map.buildings.map(b=>[b.id,JSON.stringify(b)]));
  const environment=JSON.stringify(doc.map.roads)!==JSON.stringify(original.map.roads)||JSON.stringify(doc.map.water)!==JSON.stringify(original.map.water)||JSON.stringify(doc.map.settlements)!==JSON.stringify(original.map.settlements)||doc.height.data!==original.height.data||doc.map.terrain.min_height!==original.map.terrain.min_height||doc.map.terrain.max_height!==original.map.terrain.max_height;
  const context={...doc,definitions};
  for(const b of doc.map.buildings){
    const changed=old.get(b.id)!==JSON.stringify(b);
    const definition=definitions.buildings.find(d=>d.id===b.definition);
    if(!definition && !changed)continue; // Pre-existing unknown records are not silently converted to valid footprints.
    if(!definition)throw new Error(`Invalid building ${b.id}: unknown_definition`);
    if(!changed && !environment)continue;
    const result=checkBuildingPlacement(context,definition,b);
    if(!result.valid)throw new Error(`Invalid building ${b.id}: ${result.reason}${result.blocking_id?` (${result.blocking_id})`:''}`);
  }
}
