// Portable timber-frame building family generator. No browser, renderer or engine dependencies.
// The opening plan is the sole source of truth for exterior and optional interior.
export const DEFAULT_BUILDING_OPTIONS=Object.freeze({
  width:9,depth:11,stories:1,roofPitch:43,interior:'shell',
});
export function validateBuildingOptions(value){
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('Building options must be an object');
  const keys=Object.keys(value).sort();
  if(keys.join()!=='depth,interior,roofPitch,stories,width')
    throw Error('Unknown or missing building options');
  for(const [field,lo,hi] of [
    ['width',6,18],['depth',7,22],['roofPitch',30,60],['stories',1,2],
  ]){
    const n=value[field];
    if(!Number.isInteger(n)||n<lo||n>hi)
      throw Error(field+' must be an integer between '+lo+' and '+hi);
  }
  if(value.interior!=='shell'&&value.interior!=='none')
    throw Error('Interior must be shell or none');
  return {width:value.width,depth:value.depth,stories:value.stories,
    roofPitch:value.roofPitch,interior:value.interior};
}
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const boundsOf=parts=>{
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const part of parts)
    for(let i=0;i<part.positions.length;i+=3)
      for(let j=0;j<3;j++){
        min[j]=Math.min(min[j],part.positions[i+j]);
        max[j]=Math.max(max[j],part.positions[i+j]);
      }
  return {min,max};
};
function geometryBuilder(seed=0){
  const parts=new Map();
  const woodMaterials=new Set(['timber','innerTimber','timberEnd',
    'innerTimberEnd','timberPanel','innerTimberPanel']);
  const part=material=>{
    if(!parts.has(material))parts.set(material,{
      material,positions:[],normals:[],uvs:[],indices:[],colors:[],
    });
    return parts.get(material);
  };
  // Stable spatial hash: adding a new beam won't reshuffle existing materials.
  function variation(values,salt){
    let n=(seed^salt)>>>0;
    for(const value of values)
      n=Math.imul(n^Math.round(value*1000),16777619)>>>0;
    n=Math.imul(n^(n>>>16),2246822519)>>>0;
    return ((n^(n>>>13))>>>0)/4294967296;
  }
  function colorVariation(values){
    const brightness=.93+variation(values,0x674d3b29)*.14;
    const warmth=(variation(values,0x93a15c24)-.5)*.035;
    return [brightness+warmth,brightness,brightness-warmth];
  }
  function face(material,a,b,c,d=null,uvCorners=null,tint=null){
    const mesh=part(material),ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const len=Math.hypot(...n)||1;
    const verts=d?[a,b,c,d]:[a,b,c],at=mesh.positions.length/3;
    const normal=n.map(x=>x/len);
    const axis=Math.abs(normal[1])>=Math.max(Math.abs(normal[0]),Math.abs(normal[2]))?
      'y':Math.abs(normal[0])>Math.abs(normal[2])?'x':'z';
    // Roof quads are ordered ridge -> eave -> eave -> ridge.
    // A CanvasTexture displays its top image row at V=1 (flipY=true).
    // Therefore V must *decrease* downhill for the tile tails to point
    // toward the eaves. Measure distance from this face's ridge (a),
    // not from world X=0: the attached wing has its own offset ridge.
    // Walls retain their original world-aligned planar projection.
    const roof=material==='roofThatch'||material==='roofClay';
    for(const [index,v] of verts.entries()){
      mesh.positions.push(...v);mesh.normals.push(...normal);
      const downhill=Math.hypot(v[0]-a[0],v[1]-a[1]);
      const uv=roof?[v[2],-downhill]:
        axis==='y'?[v[0],v[2]]:axis==='x'?[v[2],v[1]]:[v[0],v[1]];
      if(uvCorners)mesh.uvs.push(...uvCorners[index]);
      else {
        // Scale rubble masonry to roughly hand-sized foundation stones:
        // a 7x8 stone atlas spans ~2.5m, not the usual metre-wide tile.
        const stone=material==='foundation'||material==='stone';
        const repeat=roof?.55:stone?.35:.85;
        mesh.uvs.push(uv[0]*repeat,uv[1]*repeat);
      }
    }
    if(woodMaterials.has(material)){
      const perVertex=Array.isArray(tint?.[0]);
      for(let i=0;i<verts.length;i++)
        mesh.colors.push(...(perVertex?tint[i]:tint??[1,1,1]));
    }
    mesh.indices.push(at,at+1,at+2);
    if(d)mesh.indices.push(at,at+2,at+3);
  }
  function box(material,x,y,z,w,h,d){
    if(w<=0||h<=0||d<=0)return;
    // Rectangular masses have flat-sawn broad faces, not narrow beam grain.
    const panel=material==='timber'||material==='innerTimber';
    const kind=panel?material+'Panel':material;
    const tint=panel?colorVariation([x,y,z,w,h,d]):null;
    const offsetU=panel?variation([x,y,z,w,h,d],0x81a2643b):0;
    const offsetV=panel?variation([x,y,z,w,h,d],0xab38ca17):0;
    const quad=(a,b,c,e)=>{
      if(!panel){face(kind,a,b,c,e);return;}
      const dist=(p,q)=>Math.hypot(...p.map((v,i)=>v-q[i]));
      const da=dist(a,b),db=dist(b,c);
      const U=offsetU,V=offsetV;
      const coords=da>=db?
        [[U,V],[U,V+da*.50],[U+db*.70,V+da*.50],[U+db*.70,V]]:
        [[U,V],[U+da*.70,V],[U+da*.70,V+db*.50],[U,V+db*.50]];
      face(kind,a,b,c,e,coords,tint);
    };
    const a=x-w/2,b=x+w/2,c=y-h/2,e=y+h/2,f=z-d/2,g=z+d/2;
    quad([a,c,f],[a,e,f],[b,e,f],[b,c,f]);
    quad([b,c,g],[b,e,g],[a,e,g],[a,c,g]);
    quad([a,c,g],[a,e,g],[a,e,f],[a,c,f]);
    quad([b,c,f],[b,e,f],[b,e,g],[b,c,g]);
    quad([a,e,f],[a,e,g],[b,e,g],[b,e,f]);
    quad([a,c,g],[a,c,f],[b,c,f],[b,c,g]);
  }
  function beam(material,a,b,r){
    const dy=b[1]-a[1],dx=b[0]-a[0],dz=b[2]-a[2];
    const length=Math.hypot(dx,dy,dz);
    if(length<.01)return;
    const axis=[dx/length,dy/length,dz/length],ref=Math.abs(axis[1])>.9?[1,0,0]:[0,1,0];
    let u=[axis[1]*ref[2]-axis[2]*ref[1],axis[2]*ref[0]-axis[0]*ref[2],axis[0]*ref[1]-axis[1]*ref[0]];
    const ul=Math.hypot(...u);u=u.map(v=>v/ul);
    const v=[axis[1]*u[2]-axis[2]*u[1],axis[2]*u[0]-axis[0]*u[2],axis[0]*u[1]-axis[1]*u[0]];
    const at=(p,s,t)=>p.map((n,i)=>n+u[i]*s*r+v[i]*t*r);
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
    const wood=material==='timber'||material==='innerTimber';
    const signature=[...a,...b,r];
    const offsetU=variation(signature,0xe1c9648b);
    const offsetV=variation(signature,0xb81c1d45);
    const scaleU=.85+variation(signature,0x67419b26)*.30;
    const scaleV=.89+variation(signature,0x14e927c3)*.24;
    const flip=variation(signature,0xa17b46c2)>.5?-1:1;
    const tint=wood?colorVariation(signature):null;
    const width=2*r*.70*scaleU;
    // The shared beam image is a 4-section, 512x2048 longitudinal atlas.
    // Divide world-space tiling by four: texels per metre stay high without
    // repeating or stretching an individual 512px pattern across the joist.
    // At extreme lengths, cap at one atlas to avoid any repeated landmarks.
    // Keep U straight: UV bending previously made the grain look blurry.
    const along=wood?Math.min(length*.50*scaleV/4,.92):length*.50*scaleV;
    // A few strips only for slow per-vertex tint variation. All strips sample
    // the same shared textures with LINEAR, continuous UVs; no UV warping.
    const sections=wood&&length>3.2?Math.ceil(length/1.3):1;
    const phases=[
      variation(signature,0x8b397fc5)*Math.PI*2,
      variation(signature,0x73b92d48)*Math.PI*2,
    ];
    const shade=t=>sections===1?1:1+
      .047*Math.sin(t*Math.PI*2*1.13+phases[0])+
      .026*Math.sin(t*Math.PI*2*2.21+phases[1]);
    const segmentTint=t=>tint?.map(channel=>channel*shade(t))??null;
    const between=t=>a.map((value,i)=>value+(b[i]-value)*t);
    for(let k=0;k<sections;k++){
      const t0=k/sections,t1=(k+1)/sections;
      const a0=between(t0),a1=between(t1);
      const tint0=segmentTint(t0),tint1=segmentTint(t1);
      for(let i=0;i<4;i++){
        const p=corners[i],q=corners[(i+1)%4];
        const u0=offsetU+flip*i*width,u1=u0+flip*width;
        const coords=wood?[
          [u0,offsetV+along*t0],
          [u0,offsetV+along*t1],
          [u1,offsetV+along*t1],
          [u1,offsetV+along*t0],
        ]:null;
        face(material,at(a0,...p),at(a1,...p),
          at(a1,...q),at(a0,...q),coords,
          wood?[tint0,tint1,tint1,tint0]:null);
      }
    }
    const capMaterial=wood?material+'End':material;
    const turn=wood?Math.floor(variation(signature,0x715c8341)*4):0;
    const capUV=p=>{
      const [x,y]=p;
      const rotated=turn===1?[-y,x]:turn===2?[-x,-y]:turn===3?[y,-x]:[x,y];
      return [rotated[0]*.5+.5,rotated[1]*.5+.5];
    };
    const cap=(base,points)=>{
      face(capMaterial,...points.map(p=>at(base,...p)),
        wood?points.map(capUV):null,tint);
    };
    cap(a,corners);
    cap(b,[...corners].reverse());
  }
  function finish(){
    const finished=[...parts.values()].map(p=>({
      material:p.material,positions:new Float32Array(p.positions),
      normals:new Float32Array(p.normals),uvs:new Float32Array(p.uvs),
      indices:new Uint32Array(p.indices),
      ...(p.colors.length?{colors:new Float32Array(p.colors)}:{}),
    }));
    return {parts:finished,bounds:boundsOf(finished),
      triangles:finished.reduce((sum,p)=>sum+p.indices.length/3,0)};
  }
  return {face,box,beam,finish};
}

// A compact architecture grammar: shared facade opening plan first, geometry second.
// Deliberately independent of Godot and Three.js. All geometry is batched per material.
const SIDES=['front','back','left','right'];
const floorHeight=3.12;
const jitter=(random,range)=>(random()-.5)*range;
const fixed=n=>Math.round(n*1000)/1000;
function wingPlan(width,depth,level){
  if(level===1)return null;
  const w=Math.max(3.3,width*(level===2?.43:.55));
  const d=depth*(level===2?.54:.66);
  return {x:width/2+w/2-.09,z:depth*.13,width:w,depth:d,
    height:floorHeight-.10,pitch:level===2?31:37};
}
function layout(options,level,structureSeed){
  if(!Number.isInteger(level)||level<1||level>3)
    throw Error('Building level must be 1–3');
  const width=options.width+level-1,depth=options.depth+level-1;
  const stories=Math.min(3,options.stories+Math.min(level-1,2));
  const storeyHeight=floorHeight,wallHeight=stories*floorHeight;
  const eave=.70,pitch=options.roofPitch*Math.PI/180;
  const ridgeHeight=wallHeight+(width/2+eave)*Math.tan(pitch);
  const wing=wingPlan(width,depth,level);
  const random=rng((structureSeed+level*4021)>>>0);
  const openings=[];
  const add=(side,type,floor,center,width,bottom,top)=>{
    const o={side,type,level:floor,center:fixed(center),width:fixed(width),
      bottom:fixed(bottom),top:fixed(top)};
    openings.push(o);
    return o;
  };
  for(let floor=0;floor<stories;floor++){
    const bottom=floor*floorHeight;
    for(const side of SIDES){
      const span=side==='left'||side==='right'?depth:width;
      let count=clamp(Math.floor((span-1.2)/2.75),2,6);
      if(side==='front')count=floor===0?2:Math.min(5,3+Math.floor((width-9)/4));
      for(let i=0;i<count;i++){
        let center=-span/2+(i+.5)*(span/count);
        center+=jitter(random,.11);
        const w=floor===0?.98:.91;
        if(side==='front'&&floor===0&&Math.abs(center)<1.22)continue;
        // A real ground-floor door connects the house to its side annex.
        // Concealed exterior facades have no impossible windows.
        if(wing&&side==='right'){
          const nearWing=Math.abs(-center-wing.z)<wing.depth/2+.56;
          if(nearWing&&(floor===0||floor===1))continue;
        }
        add(side,'window',floor,center,w,
          bottom+(floor===0?1.00:1.10),bottom+2.27);
      }
    }
  }
  add('front','door',0,0,1.58,.26,2.65);
  if(wing)add('right','door',0,-wing.z,1.44,.25,2.52);
  // The roof openings exist only in the exterior: attic is not a generated room.
  const gableStyle=level===3?'stepped':level===2?'ornate':'framed';
  return {level,width,depth,stories,storeyHeight,wallHeight,eave,pitch,ridgeHeight,
    wing,gableStyle,jetty:level===1?0:level===2?.20:.31,
    openings,windows:openings.filter(o=>o.type==='window'),
    doors:openings.filter(o=>o.type==='door'),
    facadeVariant:Math.floor(random()*3)};
}
function facadeOffset(plan,floor){return floor>0?plan.jetty:0;}
function span(plan,side){return side==='front'||side==='back'?plan.width:plan.depth;}
function point(plan,side,u,y,outward=0){
  if(side==='front')return [u,y,-plan.depth/2-outward];
  if(side==='back')return [-u,y,plan.depth/2+outward];
  if(side==='left')return [-plan.width/2-outward,y,-u];
  return [plan.width/2+outward,y,u];
}
function facadeBox(g,plan,side,a,b,low,high,depth,material,offset=0){
  if(high-low<.001||b-a<.001)return;
  const p=point(plan,side,(a+b)/2,(high+low)/2,offset);
  if(side==='front'||side==='back')
    g.box(material,p[0],p[1],p[2],b-a,high-low,depth);
  else g.box(material,p[0],p[1],p[2],depth,high-low,b-a);
}
function facadeBeam(g,plan,side,u0,y0,u1,y1,r,material,offset){
  g.beam(material,point(plan,side,u0,y0,offset),
    point(plan,side,u1,y1,offset),r);
}
function plasterWall(g,plan,side,floor,material,offset){
  const lo=floor*floorHeight+.20,hi=(floor+1)*floorHeight;
  const ops=plan.openings.filter(o=>o.side===side&&o.level===floor);
  const cuts=[-span(plan,side)/2,span(plan,side)/2,
    ...ops.flatMap(o=>[o.center-o.width/2,o.center+o.width/2])]
    .sort((a,b)=>a-b).filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>1e-5);
  for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1],b=cuts[i],mid=(a+b)/2;
    const openings=ops.filter(o=>Math.abs(mid-o.center)<o.width/2-1e-5)
      .sort((a,b)=>a.bottom-b.bottom);
    let y=lo;
    for(const o of openings){
      facadeBox(g,plan,side,a,b,y,o.bottom,.20,material,offset);
      y=Math.max(y,o.top);
    }
    facadeBox(g,plan,side,a,b,y,hi,.20,material,offset);
  }
}
function trimOpening(g,plan,o,interior,offset){
  const side=o.side,half=o.width/2;
  const material=interior?'innerTrim':'timber';
  const trimDepth=interior?offset-.13:offset+.18;
  for(const u of [o.center-half,o.center+half])
    facadeBeam(g,plan,side,u,o.bottom,u,o.top+.045,
      interior?.065:.088,material,trimDepth);
  for(const y of [o.bottom,o.top])
    facadeBeam(g,plan,side,o.center-half-.075,y,
      o.center+half+.075,y,interior?.07:.10,material,trimDepth);
  if(o.type==='window'){
    // Sealed, softly tinted windows: the detached interiors never see outside.
    facadeBox(g,plan,side,o.center-half+.025,o.center+half-.025,
      o.bottom+.025,o.top-.025,.043,
      interior?'innerGlass':'glass',interior?offset-.09:offset+.11);
    const cross=interior?'innerTrim':'timber';
    facadeBeam(g,plan,side,o.center,o.bottom,o.center,o.top,.031,cross,trimDepth+.03);
    facadeBeam(g,plan,side,o.center-half,(o.bottom+o.top)*.5,
      o.center+half,(o.bottom+o.top)*.5,.032,cross,trimDepth+.03);
    if(!interior){
      facadeBox(g,plan,side,o.center-half-.15,o.center+half+.15,
        o.bottom-.14,o.bottom,.28,'stone',offset+.25);
      // Hinged shutters with an inset panel and visible jambs.
      if(o.level<2){
        facadeBox(g,plan,side,o.center-half-.29,o.center-half-.10,
          o.bottom+.08,o.top-.09,.073,'shutter',offset+.25);
        facadeBox(g,plan,side,o.center+half+.10,o.center+half+.29,
          o.bottom+.08,o.top-.09,.073,'shutter',offset+.25);
      }
    }else{
      // Deep wall reveal: interior openings feel set into masonry.
      facadeBox(g,plan,side,o.center-half-.17,o.center+half+.17,
        o.bottom-.17,o.bottom-.03,.20,'stone',offset-.18);
    }
  }else if(!interior&&side==='front'){
    facadeBox(g,plan,side,o.center-half+.085,o.center+half-.085,
      o.bottom+.08,o.top-.06,.075,'door',offset+.145);
    for(const u of [o.center-.29,o.center,o.center+.29])
      facadeBeam(g,plan,side,u,o.bottom+.18,u,o.top-.2,.027,'timber',offset+.23);
    const knob=point(plan,side,o.center+.46,1.34,offset+.25);
    g.box('metal',...knob,.11,.13,.09);
  }
}
function halfTimber(g,plan,side,floor,offset){
  const length=span(plan,side),bottom=floor*floorHeight+.13;
  const top=(floor+1)*floorHeight-.12;
  const ops=plan.openings.filter(o=>o.side===side&&o.level===floor)
    .sort((a,b)=>a.center-b.center);
  const bays=[-length/2,...ops.flatMap(o=>[o.center-o.width/2,o.center+o.width/2]),
    length/2].sort((a,b)=>a-b);
  // Rails and uprights respect apertures rather than drawing across them.
  facadeBox(g,plan,side,-length/2,length/2,bottom-.08,bottom+.17,
    .31,'timber',offset+.11);
  facadeBox(g,plan,side,-length/2,length/2,top-.14,top+.12,
    .30,'timber',offset+.11);
  for(let i=1;i<bays.length;i++){
    const a=bays[i-1],b=bays[i],mid=(a+b)/2;
    if(b-a<.30||ops.some(o=>Math.abs(mid-o.center)<o.width/2-.001))continue;
    const u=(a+b)/2;
    if(b-a>1.05)facadeBeam(g,plan,side,u,bottom+.09,u,top-.10,.074,
      'timber',offset+.155);
    if(b-a>1.30){
      // Traditional knee-bracing stays in solid infill bays.
      const left=a+.15,right=b-.15;
      facadeBeam(g,plan,side,left,bottom+.27,u,bottom+1.12,
        .070,'timber',offset+.16);
      facadeBeam(g,plan,side,u,top-1.07,right,top-.27,
        .070,'timber',offset+.16);
    }
  }
  for(const u of [-length/2,length/2])
    facadeBeam(g,plan,side,u,bottom,u,top,.115,'timber',offset+.10);
}
function exteriorFacade(g,plan){
  for(let floor=0;floor<plan.stories;floor++){
    const offset=facadeOffset(plan,floor);
    for(const side of SIDES){
      const material=floor===0&&plan.level>=3?'plasterOchre':
        (floor+plan.facadeVariant)%3===0?'plasterWarm':
          (floor+plan.facadeVariant)%3===1?'plaster':'plasterIvory';
      plasterWall(g,plan,side,floor,material,offset);
      halfTimber(g,plan,side,floor,offset);
      for(const o of plan.openings.filter(o=>o.side===side&&o.level===floor))
        trimOpening(g,plan,o,false,offset);
    }
    if(floor>0){
      // Jettied storeys and heavy supporting corbels create actual depth.
      const overhang=plan.jetty;
      g.box('timber',0,floor*floorHeight-.01,0,
        plan.width+overhang*2+.29,.22,plan.depth+overhang*2+.29);
      const z=-plan.depth/2-overhang;
      for(let x=-plan.width/2+.65;x<plan.width/2;x+=1.7)
        g.beam('timber',[x,floor*floorHeight-.46,z+.12],
          [x,floor*floorHeight+.04,z-overhang-.25],.14);
    }
  }
  // Foundation courses and corner stone pads.
  g.box('foundation',0,.16,0,plan.width+.36,.32,plan.depth+.36);
  for(const x of [-plan.width/2,plan.width/2])
    for(const z of [-plan.depth/2,plan.depth/2])
      g.box('stone',x,.40,z,.42,.80,.42);
}
function gable(g,plan,side){
  const z=side==='front'?-plan.depth/2-.01:plan.depth/2+.01;
  const xwidth=plan.width/2+plan.jetty;
  const apex=plan.ridgeHeight-.15,y=plan.wallHeight;
  // Continuous gable triangle; no stepping artifacts in plaster geometry.
  // Decorative steps, where used, sit on top of the real triangular wall.
  g.face('plasterWarm',[-xwidth,y,z],[0,apex,z],[xwidth,y,z]);
  for(const sign of [-1,1])
    g.beam('timber',[0,apex,z+(side==='front'?-.16:.16)],
      [sign*xwidth,y,z+(side==='front'?-.16:.16)],.14);
  if(plan.gableStyle==='stepped'){
    // Northern merchant-house stair-step brickwork; only at the richer tier.
    for(const sign of [-1,1])for(let i=1;i<=5;i++){
      const x=sign*(i-.24)*xwidth/5.6;
      const height=apex-(Math.abs(x)/(xwidth+plan.eave))*(apex-y);
      g.box(i%2?'stone':'brick',x,height+.08,
        z+(side==='front'?-.13:.13),xwidth/5.1,.19,.36);
    }
  }else if(plan.gableStyle==='ornate'){
    for(const sign of [-1,1])
      g.beam('timber',[0,y+.35,z],[sign*(xwidth*.56),y+.35,z],.08);
  }
  // An opaque attic louver beneath the apex reads correctly at game scale.
  g.box('timber',0,y+(apex-y)*.43,z+(side==='front'?-.16:.16),
    1.16,.83,.16);
  g.box('shutter',0,y+(apex-y)*.43,z+(side==='front'?-.28:.28),
    .88,.58,.055);
  for(const x of [-.25,0,.25])
    g.box('timber',x,y+(apex-y)*.43,z+(side==='front'?-.33:.33),
      .045,.64,.065);
}
function roof(g,plan,seed){
  const w=plan.width/2+plan.eave+plan.jetty;
  const front=-plan.depth/2-.66,back=plan.depth/2+.66;
  const ridge=plan.ridgeHeight,eave=plan.wallHeight-.12;
  const roofMaterial=plan.level===1?'roofThatch':'roofClay';
  for(const sign of [-1,1]){
    const x=sign*w;
    g.face(roofMaterial,[0,ridge,front],[x,eave,front],
      [x,eave,back],[0,ridge,back]);
    g.beam('timber',[x,eave,front],[x,eave,back],.135);
    for(const z of [front,back])g.beam('trim',
      [0,ridge,z],[x,eave,z],.13);
  }
  g.beam('ridge',[0,ridge+.05,front],[0,ridge+.05,back],.13);
  gable(g,plan,'front');gable(g,plan,'back');
  // A chimney that emerges from the slope and casts a useful shadow.
  const cx=plan.width*.23,cz=plan.depth*.22;
  const y=ridge-Math.abs(cx)/w*(ridge-eave);
  g.box('brick',cx,y+.9,cz,.76,1.8,.66);
  g.box('stone',cx,y+1.85,cz,.94,.20,.88);
  g.box('chimney',cx,y+1.97,cz,.52,.04,.46);
}
function dormers(g,plan){
  if(plan.level===1)return;
  const count=plan.level===2?1:2;
  const w=plan.width/2+plan.eave+plan.jetty;
  const ridge=plan.ridgeHeight,eave=plan.wallHeight-.12;
  for(const sign of [-1,1])
    for(let i=0;i<count;i++){
      const z=(i-(count-1)/2)*plan.depth*.39;
      const x=sign*w*.63;
      const baseline=ridge-(ridge-eave)*.63+.10;
      const depth=.82,half=.70,top=baseline+1.48;
      // Framed dormer face, dormer roof and dark solid glazing.
      g.box('plasterIvory',x+sign*.54,baseline+.62,z,
        .19,1.25,1.53);
      g.box('timber',x+sign*.68,baseline+.64,z,
        .12,1.38,1.33);
      g.box('glass',x+sign*.78,baseline+.60,z,.065,.72,.71);
      g.box('timber',x+sign*.84,baseline+.61,z,.09,.06,.78);
      const ox=x+sign*.12,ex=x+sign*.90;
      for(const dz of [-half,half]){
        g.beam('trim',[ox,top,z],[ex,baseline+1.19,z+dz],.08);
      }
      const front=x-sign*.24,back=x+sign*1.05;
      // Small transverse gable, not an oversized block on the roof.
      for(const zsign of [-1,1])
        g.face('roofUnderlay',[front,top,z],[back,top,z],
          [back,baseline+1.14,z+zsign*half],
          [front,baseline+1.14,z+zsign*half]);
      g.beam('ridge',[front,top,z],[back,top,z],.09);
    }
}
function entrancePorch(g,plan){
  const z=-plan.depth/2-1.17,y=2.77;
  // Low entrance canopy; supports, sill and projecting bargeboards.
  for(const x of [-1.06,1.06]){
    g.beam('timber',[x,.30,z],[x,y-.15,z],.125);
    g.beam('timber',[x,2.23,z],[x*.80,y-.15,z+.54],.10);
  }
  g.box('stone',0,.15,z-.20,2.63,.26,1.9);
  g.box('timber',0,2.58,z+.28,2.65,.17,1.35);
  for(const sign of [-1,1])
    g.face('roofBase',[0,3.23,z-1.0],
      [sign*1.48,2.68,z-1.0],
      [sign*1.48,2.68,z+.72],
      [0,3.23,z+.72]);
  for(const x of [-1.0,1.0])
    g.box('stone',x,.16,z,.36,.32,.36);
}
function annex(g,plan,materialSeed){
  if(!plan.wing)return;
  const w=plan.wing,{x,z,width,depth,height,pitch}=w;
  const left=x-width/2,right=x+width/2;
  const front=z-depth/2,back=z+depth/2;
  const y=height;
  // Attached L-shaped service wing has its own roof mass and frame rhythm.
  g.box('foundation',x,.15,z,width+.16,.29,depth+.15);
  for(const edge of [front,back]){
    g.box('plasterOchre',x,y/2,edge,width,y-.21,.22);
    g.beam('timber',[left,.25,edge-.13],[left,y,edge-.13],.10);
    g.beam('timber',[right,.25,edge-.13],[right,y,edge-.13],.10);
    g.beam('timber',[left,y-.13,edge-.13],[right,y-.13,edge-.13],.10);
  }
  // Omit the inner wall where the wing meets the main building.
  g.box('plasterWarm',right,y/2,z,.19,y-.21,depth);
  for(let i=0;i<=3;i++){
    const zz=front+depth*i/3;
    g.beam('timber',[right+.13,.25,zz],[right+.13,y,zz],.075);
  }
  const over=.40,rise=(width/2+over)*Math.tan(pitch*Math.PI/180);
  const peak=y+rise,xe=right+over,xi=left-over,z0=front-.36,z1=back+.36;
  for(const sign of [-1,1]){
    const edge=x+sign*(width/2+over);
    g.face('roofClay',[x,peak,z0],[edge,y,z0],[edge,y,z1],[x,peak,z1]);
  }
  for(const zedge of [front,back]){
    g.face('plasterOchre',[left,y,zedge],[x,peak,zedge],[right,y,zedge]);
    g.beam('timber',[left,y,zedge],[x,peak,zedge],.11);
    g.beam('timber',[x,peak,zedge],[right,y,zedge],.11);
  }
  g.beam('ridge',[x,peak,z0],[x,peak,z1],.12);
}
function interiorShell(g,plan){
  // A grander building gets a taller hall while the adjoining service
  // room remains ordinary height. The interior is a detached gameplay scene.
  const h=plan.level===1?floorHeight:plan.level===2?4.10:4.72;
  // Playable, deliberately roofless cutaway of a separate interior scene.
  g.box('floor',0,.13,0,plan.width-.27,.25,plan.depth-.28);
  g.box('stone',0,.30,plan.depth*.28,plan.width-.27,.17,plan.depth*.33);
  for(const side of SIDES){
    plasterWall(g,plan,side,0,'interior',-.12);
    const len=span(plan,side);
    if(h>floorHeight)facadeBox(g,plan,side,-len/2,len/2,
      floorHeight-.01,h,.20,'interior',-.12);
    // Interior wainscot stops at doorways rather than sealing them.
    const doors=plan.openings.filter(o=>o.side===side&&o.level===0&&o.type==='door');
    const limits=[-len/2,len/2,...doors.flatMap(o=>[o.center-o.width/2,o.center+o.width/2])]
      .sort((a,b)=>a-b);
    for(let i=1;i<limits.length;i++){
      const a=limits[i-1],b=limits[i],mid=(a+b)/2;
      if(doors.some(o=>Math.abs(mid-o.center)<o.width/2))continue;
      facadeBox(g,plan,side,a,b,.30,.82,.14,'interiorPlinth',-.24);
    }
    facadeBeam(g,plan,side,-len/2,h-.27,len/2,h-.27,.11,'innerTrim',-.20);
    for(const o of plan.openings.filter(o=>o.side===side&&o.level===0))
      trimOpening(g,plan,o,true,-.12);
    for(const u of [-len/2+.12,len/2-.12]){
      facadeBeam(g,plan,side,u,.28,u,h-.15,.13,'innerTimber',-.21);
    }
  }
  // Unfurnished interior architecture: ceiling joists, posts, open service bay.
  const left=-plan.width/2+.34,right=plan.width/2-.34;
  for(let z=-plan.depth/2+.60;z<plan.depth/2-.20;z+=1.18){
    g.beam('innerTimber',[left,h-.15,z],[right,h-.15,z],.13);
    if(plan.level>=2){
      // Visible knee braces under the taller hall's roofline.
      g.beam('innerTimber',[left,h-1.00,z],[left+.83,h-.15,z],.09);
      g.beam('innerTimber',[right,h-1.00,z],[right-.83,h-.15,z],.09);
    }
  }
  for(const x of [left+.12,right-.12])
    g.beam('innerTimber',[x,h-.16,-plan.depth/2+.3],
      [x,h-.16,plan.depth/2-.3],.12);
  if(plan.level===3){
    // Built-in gallery: architectural circulation, not furnishing.
    const rear=plan.depth/2-.21,front=rear-1.42,deck=2.73;
    g.box('gallery',0,deck, (front+rear)/2,plan.width-.65,.19,rear-front);
    for(const x of [-plan.width/2+.58,plan.width/2-.58]){
      g.beam('innerTimber',[x,.31,front],[x,deck+.08,front],.13);
      g.beam('innerTimber',[x,deck-.43,front-.48],[x,deck+.08,front],.10);
    }
    g.beam('innerTimber',[left,deck-.05,front],
      [right,deck-.05,front],.17);
    // Railing with realistic gaps and a rail high enough to read clearly.
    g.beam('innerTimber',[left,deck+1.0,front],
      [right,deck+1.0,front],.085);
    for(let x=left;x<=right+.001;x+=.80)
      g.beam('innerTimber',[x,deck+.10,front],
        [x,deck+.97,front],.045);
  }
  const archZ=plan.depth*.20;
  const width=plan.width*.33;
  for(const x of [-width,width]){
    g.box('stone',x,1.04,archZ,.36,2.08,.41);
    g.beam('innerTimber',[x,.98,archZ],
      [x+(x>0?-.28:.28),2.47,archZ],.12);
  }
  g.beam('innerTimber',[-width,2.53,archZ],[width,2.53,archZ],.15);
  for(const x of [-width,width])
    g.box('stone',x,.25,archZ,.58,.24,.55);
  // Separate rear service area, entirely empty, optionally reached through
  // the shared side door. Not a mandatory full-house floorplan.
  if(plan.wing){
    const w=plan.wing;
    g.box('floor',w.x,.11,w.z,w.width-.16,.22,w.depth-.20);
    g.box('interior',w.x,w.height/2,w.z-w.depth/2,
      w.width-.10,w.height-.25,.17);
    g.box('interior',w.x,w.height/2,w.z+w.depth/2,
      w.width-.10,w.height-.25,.17);
    g.box('interior',w.x+w.width/2,w.height/2,w.z,
      .17,w.height-.25,w.depth);
    for(const z of [w.z-w.depth/2+.20,w.z+w.depth/2-.20]){
      g.box('innerTimber',w.x+w.width/2,w.height/2,z,
        .26,w.height-.22,.23);
      g.beam('innerTimber',[plan.width/2+.2,w.height-.15,z],
        [w.x+w.width/2,w.height-.15,z],.10);
    }
    for(let z=w.z-w.depth/2+.50;z<w.z+w.depth/2-.15;z+=1.12)
      g.beam('innerTimber',[plan.width/2+.12,w.height-.18,z],
        [w.x+w.width/2-.2,w.height-.18,z],.11);
  }
}
export function generateBuildingFamily(seeds,rawOptions=DEFAULT_BUILDING_OPTIONS,level=1){
  const options=validateBuildingOptions(rawOptions);
  if(!seeds||!Number.isInteger(seeds.structure)||!Number.isInteger(seeds.material))
    throw Error('Building seeds must be integers');
  const plan=layout(options,level,seeds.structure>>>0);
  const outside=geometryBuilder(seeds.structure>>>0);
  exteriorFacade(outside,plan);
  roof(outside,plan,(seeds.material+level*427)>>>0);
  dormers(outside,plan);
  entrancePorch(outside,plan);
  annex(outside,plan,(seeds.material+level*193)>>>0);
  const inside=options.interior==='shell'?geometryBuilder(seeds.structure>>>0):null;
  if(inside)interiorShell(inside,plan);
  const exterior=outside.finish(),interior=inside?.finish()??null;
  return {
    id:'timber-building',kind:'model',
    building:{level,plan,exterior,interior,
      exteriorOpenings:plan.openings,
      interiorOpenings:interior?
        plan.openings.filter(o=>o.level===0):[],
    },
  };
}
