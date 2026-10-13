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
function geometryBuilder(){
  const parts=new Map();
  const part=material=>{
    if(!parts.has(material))parts.set(material,{material,positions:[],normals:[],indices:[]});
    return parts.get(material);
  };
  function face(material,a,b,c,d=null){
    const mesh=part(material),ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const len=Math.hypot(...n)||1;
    const verts=d?[a,b,c,d]:[a,b,c],at=mesh.positions.length/3;
    for(const v of verts){mesh.positions.push(...v);mesh.normals.push(...n.map(x=>x/len));}
    mesh.indices.push(at,at+1,at+2);
    if(d)mesh.indices.push(at,at+2,at+3);
  }
  function box(material,x,y,z,w,h,d){
    if(w<=0||h<=0||d<=0)return;
    const a=x-w/2,b=x+w/2,c=y-h/2,e=y+h/2,f=z-d/2,g=z+d/2;
    face(material,[a,c,f],[a,e,f],[b,e,f],[b,c,f]);
    face(material,[b,c,g],[b,e,g],[a,e,g],[a,c,g]);
    face(material,[a,c,g],[a,e,g],[a,e,f],[a,c,f]);
    face(material,[b,c,f],[b,e,f],[b,e,g],[b,c,g]);
    face(material,[a,e,f],[a,e,g],[b,e,g],[b,e,f]);
    face(material,[a,c,g],[a,c,f],[b,c,f],[b,c,g]);
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
    for(let i=0;i<4;i++){
      const p=corners[i],q=corners[(i+1)%4];
      face(material,at(a,...p),at(b,...p),at(b,...q),at(a,...q));
    }
    face(material,...corners.map(p=>at(a,...p)));
    face(material,...corners.map(p=>at(b,...p)).reverse());
  }
  function finish(){
    const finished=[...parts.values()].map(p=>({
      material:p.material,positions:new Float32Array(p.positions),
      normals:new Float32Array(p.normals),indices:new Uint32Array(p.indices),
    }));
    return {parts:finished,bounds:boundsOf(finished),
      triangles:finished.reduce((sum,p)=>sum+p.indices.length/3,0)};
  }
  return {face,box,beam,finish};
}
function layout(options,level,structureSeed){
  if(!Number.isInteger(level)||level<1||level>3)throw Error('Building level must be 1–3');
  const width=options.width+(level-1),depth=options.depth+(level-1);
  const stories=Math.min(3,options.stories+(level>=2?1:0)+(level===3?1:0));
  const storeyHeight=3.15,wallHeight=stories*storeyHeight;
  const eave=.52,pitch=options.roofPitch*Math.PI/180;
  const ridgeHeight=wallHeight+(width/2+eave)*Math.tan(pitch);
  const doors=[],windows=[];
  const random=rng((structureSeed+level*4021)>>>0);
  const openings=[];
  // Windows are allocated on the same shared exterior plan used by the shell.
  for(let floor=0;floor<stories;floor++){
    for(const side of ['front','back','left','right']){
      const span=side==='front'||side==='back'?width:depth;
      const count=clamp(Math.floor((span-1.7)/2.65),2,7);
      for(let i=0;i<count;i++){
        // Small, seeded facade offsets: architectural rhythm remains intact,
        // but separate source seeds no longer produce identical buildings.
        const u=-span/2+(i+.5)*span/count+(random()-.5)*.16;
        if(side==='front'&&floor===0&&Math.abs(u)<1.25)continue;
        // The top floor uses the same facade rhythm as the lower floors.
        const opening={side,type:'window',level:floor,
          center:+u.toFixed(3),width:1.0,
          bottom:+(floor*storeyHeight+1.12).toFixed(3),
          top:+(floor*storeyHeight+2.27).toFixed(3)};
        openings.push(opening);windows.push(opening);
      }
    }
  }
  const entrance={side:'front',type:'door',level:0,center:0,
    width:1.5,bottom:.28,top:2.68};
  openings.push(entrance);doors.push(entrance);
  return {level,width,depth,stories,storeyHeight,wallHeight,eave,pitch,
    ridgeHeight,openings,doors,windows,
    plankVariation:random(),facadeVariation:random()};
}
function sideSpan(plan,side){return side==='front'||side==='back'?plan.width:plan.depth;}
function wallPoint(plan,side,u,y,offset=0){
  if(side==='front')return [u,y,-plan.depth/2-offset];
  if(side==='back')return [-u,y,plan.depth/2+offset];
  if(side==='left')return [-plan.width/2-offset,y,-u];
  return [plan.width/2+offset,y,u];
}
function wallBox(mesh,plan,side,a,b,bottom,top,thickness,material,offset=0){
  if(top-bottom<.001||b-a<.001)return;
  const c=(a+b)/2,p=wallPoint(plan,side,c,(bottom+top)/2,offset);
  if(side==='front'||side==='back')mesh.box(material,p[0],p[1],p[2],b-a,top-bottom,thickness);
  else mesh.box(material,p[0],p[1],p[2],thickness,top-bottom,b-a);
}
function openingsFor(plan,side,maxHeight){
  return plan.openings.filter(o=>o.side===side&&o.bottom<maxHeight);
}
function addWalls(mesh,plan,{interior=false}={}){
  const maxHeight=interior?plan.storeyHeight:plan.wallHeight;
  for(const side of ['front','back','left','right']){
    const span=sideSpan(plan,side),ops=openingsFor(plan,side,maxHeight);
    const cuts=[-span/2,span/2,...ops.flatMap(o=>[o.center-o.width/2,o.center+o.width/2])]
      .sort((a,b)=>a-b).filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>1e-5);
    for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1],b=cuts[i],mid=(a+b)/2;
      const matches=ops.filter(o=>mid>o.center-o.width/2+1e-5&&mid<o.center+o.width/2-1e-5)
        .sort((a,b)=>a.bottom-b.bottom);
      let y=.24;
      for(const o of matches){
        wallBox(mesh,plan,side,a,b,y,o.bottom,.23,interior?'interior':'plaster');
        y=Math.max(y,o.top);
      }
      wallBox(mesh,plan,side,a,b,y,maxHeight,.23,interior?'interior':'plaster');
    }
    if(!interior){
      for(let floor=0;floor<=plan.stories;floor++)
        wallBox(mesh,plan,side,-span/2,span/2,floor*plan.storeyHeight-.075,
          floor*plan.storeyHeight+.10,.29,'wood');
      for(const u of [-span/2,span/2])
        wallBox(mesh,plan,side,u-.09,u+.09,.25,plan.wallHeight,.34,'wood');
      // Mid-bay posts are placed only between openings, never through a
      // window or doorway. The facade remains valid for any story count.
      for(let floor=0;floor<plan.stories;floor++){
        const openings=ops.filter(o=>o.level===floor)
          .slice().sort((a,b)=>a.center-b.center);
        for(let i=1;i<openings.length;i++){
          const left=openings[i-1],right=openings[i];
          const gapStart=left.center+left.width/2;
          const gapEnd=right.center-right.width/2;
          if(gapEnd-gapStart<.4)continue;
          const u=(gapStart+gapEnd)/2;
          wallBox(mesh,plan,side,u-.072,u+.072,
            floor*plan.storeyHeight+.10,(floor+1)*plan.storeyHeight-.08,
            .28,'wood',.13);
        }
      }
      // Half-timbering in solid corner bays avoids the window apertures.
      for(let floor=0;floor<plan.stories;floor++)
        for(const sign of [-1,1]){
          const root=sign*(span/2-.12),inner=sign*(span/2-.85);
          mesh.beam('wood',
            wallPoint(plan,side,root,floor*plan.storeyHeight+.23,.18),
            wallPoint(plan,side,inner,floor*plan.storeyHeight+1.08,.18),.095);
          mesh.beam('wood',
            wallPoint(plan,side,inner,floor*plan.storeyHeight+1.08,.18),
            wallPoint(plan,side,root,(floor+1)*plan.storeyHeight-.20,.18),.095);
        }
    }
    for(const o of ops){
      const trim=interior?'innerTrim':'wood',offset=interior?-.15:.17,edge=o.width/2;
      for(const u of [o.center-edge,o.center+edge])
        mesh.beam(trim,wallPoint(plan,side,u,o.bottom,offset),
          wallPoint(plan,side,u,o.top+.08,offset),.07);
      for(const y of [o.bottom,o.top])
        mesh.beam(trim,wallPoint(plan,side,o.center-edge-.07,y,offset),
          wallPoint(plan,side,o.center+edge+.07,y,offset),.07);
      if(o.type==='window'){
        wallBox(mesh,plan,side,o.center-.008,o.center+.008,o.bottom,o.top,.09,trim,offset);
        wallBox(mesh,plan,side,o.center-edge,o.center+edge,
          (o.bottom+o.top)/2-.025,(o.bottom+o.top)/2+.025,.10,trim,offset);
        // Opaque glazing; views between disconnected scenes are not supported.
        wallBox(mesh,plan,side,o.center-edge+.08,o.center+edge-.08,
          o.bottom+.08,o.top-.08,.04,interior?'innerGlass':'glass',interior?-.09:.10);
        if(!interior)wallBox(mesh,plan,side,o.center-edge-.14,o.center+edge+.14,
          o.bottom-.14,o.bottom,.28,'stone',.22);
      }else if(!interior){
        wallBox(mesh,plan,side,o.center-edge+.09,o.center+edge-.09,
          o.bottom+.08,o.top-.06,.08,'door',.15);
        for(const du of [-.25,0,.25])
          wallBox(mesh,plan,side,o.center+du-.025,o.center+du+.025,
            o.bottom+.20,o.top-.20,.10,'wood',.23);
        mesh.box('metal',o.center+.47,1.44,-plan.depth/2-.26,.10,.11,.09);
        mesh.box('stone',0,.16,-plan.depth/2-.65,2.15,.28,.83);
      }
    }
  }
}
function roof(mesh,plan,seed){
  const w=plan.width/2+plan.eave,front=-plan.depth/2-.42,back=plan.depth/2+.42;
  const peak=plan.ridgeHeight,eave=plan.wallHeight-.14;
  for(const sign of [-1,1]){
    const x=sign*w;
    mesh.face('roofBase',[0,peak,front],[x,eave,front],[x,eave,back],[0,peak,back]);
    // Rhythmic slate/clay tile courses, individually constructed but batched
    // into one material mesh; deterministic variation, no texture assets needed.
    const rows=13,columns=Math.max(11,Math.floor(plan.depth*2.4));
    const random=rng((seed^(sign>0?0x517c:0x9ca1))>>>0);
    for(let row=0;row<rows;row++){
      const t0=row/rows,t1=(row+1)/rows;
      for(let col=0;col<columns;col++){
        const step=(back-front)/columns;
        const z0=front+col*step+(row%2)*step*.16;
        const z1=Math.min(back,z0+step*.95);
        if(z1<=z0)continue;
        const jitter=(random()-.5)*.018;
        const a=[sign*w*t0,peak+(eave-peak)*t0+jitter,z0];
        const b=[sign*w*t1,peak+(eave-peak)*t1+jitter,z0];
        const c=[sign*w*t1,peak+(eave-peak)*t1+jitter,z1];
        const d=[sign*w*t0,peak+(eave-peak)*t0+jitter,z1];
        mesh.face(random()>.55?'roofTileA':'roofTileB',a,b,c,d);
      }
    }
    mesh.beam('wood',[x,eave,front],[x,eave,back],.12);
  }
  for(const z of [-plan.depth/2,plan.depth/2]){
    mesh.face('plaster',[-plan.width/2,plan.wallHeight,z],
      [0,peak,z],[plan.width/2,plan.wallHeight,z]);
    mesh.beam('wood',[-plan.width/2,plan.wallHeight,z],
      [0,peak,z],.11);
    mesh.beam('wood',[0,peak,z],
      [plan.width/2,plan.wallHeight,z],.11);
  }
  mesh.beam('ridge',[0,peak+.045,front],[0,peak+.045,back],.14);
  // One modest masonry flue as a silhouette landmark.
  const x=plan.width*.23,z=plan.depth*.22;
  const y=peak-Math.abs(x)/w*(peak-eave)+.30;
  mesh.box('stone',x,(y+peak+1.2)/2,z,.72,peak+1.2-y,.70);
  mesh.box('stone',x,peak+1.25,z,.94,.18,.93);
  mesh.box('chimney',x,peak+1.36,z,.55,.04,.55);
}
export function generateBuildingFamily(seeds,rawOptions=DEFAULT_BUILDING_OPTIONS,level=1){
  const options=validateBuildingOptions(rawOptions);
  const plan=layout(options,level,seeds.structure>>>0);
  const exterior=geometryBuilder();
  exterior.box('stone',0,.15,0,plan.width+.45,.3,plan.depth+.45);
  addWalls(exterior,plan);
  for(const x of [-plan.width/2,plan.width/2])
    for(const z of [-plan.depth/2,plan.depth/2])
      exterior.box('stone',x,.32,z,.44,.64,.44);
  roof(exterior,plan,(seeds.material>>>0)+level*427);
  const shell=options.interior==='shell'?geometryBuilder():null;
  if(shell){
    shell.box('floor',0,.09,0,plan.width-.18,.18,plan.depth-.18);
    addWalls(shell,plan,{interior:true});
    // A detached, open-topped room scene. No furniture, no false exterior views.
  }
  const exteriorMesh=exterior.finish(),interiorMesh=shell?.finish()??null;
  return {
    id:'timber-building',kind:'model',
    building:{level,plan,
      exterior:exteriorMesh,interior:interiorMesh,
      // The two views reference identical opening records by construction.
      exteriorOpenings:plan.openings,
      interiorOpenings:interiorMesh?plan.openings.filter(o=>o.level===0):[],
    },
  };
}
