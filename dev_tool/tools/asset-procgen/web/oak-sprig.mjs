// A leaf spray is grown as 3D twig paths and individually oriented oak
// blades. Baking to RGBA below is a separate deterministic projection.
import {oakLeafProfile} from './oak-leaf.mjs';

export const OAK_SPRIG_SIZE=768;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,n)=>a.map(v=>v*n);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const bezier=(a,b,c,t)=>add(add(mul(a,(1-t)**2),mul(b,2*t*(1-t))),mul(c,t*t));
function random(seed){
  let state=seed>>>0;
  return ()=>{
    state=(state+0x6d2b79f5)>>>0;
    let x=state;
    x=Math.imul(x^(x>>>15),x|1);
    x^=x+Math.imul(x^(x>>>7),x|61);
    return ((x^(x>>>14))>>>0)/4294967296;
  };
}
function validSeed(seed){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)
    throw Error('Invalid oak sprig seed');
}
function perturb(rng,n){return (rng()-.5)*2*n;}
function pointsOnCurve(a,b,c,count){
  return Array.from({length:count+1},(_,i)=>bezier(a,b,c,i/count));
}

export function generateOakSprig({structureSeed=19461,leafSeed=21749}={}){
  validSeed(structureSeed);validSeed(leafSeed);
  const rng=random(structureSeed),looks=random(leafSeed);
  const paths=[];
  const mainStart=[-.02,-.79,.04];
  const mainControl=[.10,-.03,-.065];
  const mainTip=[-.02,.79,-.09];
  const main=t=>bezier(mainStart,mainControl,mainTip,t);
  paths.push({radius:2.8,points:pointsOnCurve(mainStart,mainControl,mainTip,22)});
  // Branching support, rather than painting a green blob on a quad.
  const arms=[
    {t:.33,dx:-.49,dy:.22,dz:.16,leaves:3},
    {t:.52,dx:.48,dy:.28,dz:-.12,leaves:3},
    {t:.72,dx:-.33,dy:.27,dz:-.19,leaves:2},
  ];
  const branches=[];
  for(const arm of arms){
    const base=main(arm.t);
    const end=add(base,[arm.dx+perturb(rng,.06),
      arm.dy+perturb(rng,.05),arm.dz+perturb(rng,.08)]);
    const ctrl=add(lerp(base,end,.52),
      [perturb(rng,.04),.065+perturb(rng,.018),perturb(rng,.025)]);
    paths.push({radius:1.7,points:pointsOnCurve(base,ctrl,end,12)});
    branches.push({sample:t=>bezier(base,ctrl,end,t),leaves:arm.leaves});
  }
  branches.push({sample:main,leaves:3,main:true});
  const leaves=[];
  for(let branchIndex=0;branchIndex<branches.length;branchIndex++){
    const branch=branches[branchIndex];
    for(let i=0;i<branch.leaves;i++){
      const t=branch.main?[.53,.76,.985][i]:
        .35+i*(.55/Math.max(1,branch.leaves-1));
      const attach=branch.sample(t);
      // Alternate leaves around each twig, not symmetric butterfly pairs.
      const tangent=unit(sub(
        branch.sample(Math.min(.999,t+.012)),
        branch.sample(Math.max(0,t-.012))));
      const twist=i*.84+branchIndex*1.31+perturb(rng,.31);
      const around=unit([Math.cos(twist),perturb(rng,.22),Math.sin(twist)]);
      const forward=unit(add(add(mul(tangent,.48),mul(around,.82)),
        [0,.23+perturb(rng,.12),0]));
      const size=(.305+looks()*.13)*(branch.main?.91:1.0);
      const petiole=.055+rng()*.038;
      const base=add(attach,mul(forward,petiole));
      const roll=perturb(rng,.38);
      const view=[.13,.05,1];
      const leftBase=unit(cross(forward,view));
      const normalBase=unit(cross(forward,leftBase));
      const side=unit(add(mul(leftBase,Math.cos(roll)),
        mul(normalBase,Math.sin(roll))));
      const normal=unit(cross(side,forward));
      leaves.push({attach,base,forward,side,normal,size,
        curl:(looks()-.5)*.20,fold:.035+looks()*.055,
        profileSeed:Math.floor(looks()*4294967296),
        shade:looks(),age:looks(),branchIndex});
    }
  }
  return {structureSeed,leafSeed,paths,leaves};
}
const viewing=[.29,-.15,.94];
// Only screen x,y: Canvas paths must never receive depth as a third
// coordinate, especially when using quadraticCurveTo.
const project=(p,size)=>[
  size*.5+(p[0]*.94+p[2]*.31)*size*.365,
  size*.53-(p[1]*.98-p[2]*.11-p[0]*.04)*size*.365,
];
function bladePoint(leaf,t,w,side){
  const bend=Math.sin(Math.PI*t);
  return add(add(add(leaf.base,mul(leaf.forward,leaf.size*t)),
    mul(leaf.side,leaf.size*w*side)),
    mul(leaf.normal,leaf.size*(leaf.fold*bend+leaf.curl*t*t)));
}
function paintTwig(ctx,points,radius,size){
  const projected=points.map(p=>project(p,size));
  ctx.beginPath();ctx.moveTo(...projected[0]);
  for(let i=1;i<projected.length;i++)ctx.lineTo(...projected[i]);
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='#4c4430';ctx.lineWidth=radius;ctx.stroke();
  ctx.strokeStyle='rgba(175,143,85,.65)';
  ctx.lineWidth=radius*.34;ctx.stroke();
}
function paintLeaf(ctx,leaf,size){
  const profile=oakLeafProfile(leaf.profileSeed);
  const start=project(leaf.base,size);
  const tip=project(bladePoint(leaf,1,0,1),size);
  const left=profile.outline.map(step=>
    project(bladePoint(leaf,step.t,step.left,-1),size));
  const right=profile.outline.map(step=>
    project(bladePoint(leaf,step.t,step.right,1),size));
  ctx.beginPath();ctx.moveTo(...left[0]);
  for(const p of left.slice(1))ctx.lineTo(...p);
  for(const p of [...right].reverse())ctx.lineTo(...p);
  ctx.closePath();
  const illumination=clamp(.67+.23*dot(leaf.normal,
    unit([-.45,.75,1])),.35,1.0);
  const depth=clamp(.5+leaf.age*.5,0,1);
  const H=91+leaf.shade*14;
  const S=38+leaf.shade*8;
  const L=27+illumination*14+depth*4;
  const hsl=light=>'hsl('+H.toFixed(1)+' '+S+'% '+light.toFixed(1)+'%)';
  const gradient=ctx.createLinearGradient(start[0],start[1],tip[0],tip[1]);
  gradient.addColorStop(0,hsl(Math.max(20,L-10)));
  gradient.addColorStop(.45,hsl(L));
  gradient.addColorStop(1,hsl(L+4));
  ctx.fillStyle=gradient;ctx.fill();
  // Fine flecks and fibers, clipped to each natural lobe outline.
  const grain=random(leaf.profileSeed^0x8fdcdafe);
  ctx.save();ctx.clip();
  for(let k=0;k<75;k++){
    const t=.08+grain()*.86;
    const side=grain()<.5?-1:1;
    const nearest=profile.outline[Math.min(36,Math.round(t*36))];
    const half=side<0?nearest.left:nearest.right;
    const w=half*(.04+grain()*.87);
    const c=project(bladePoint(leaf,t,w,side),size);
    const d=project(bladePoint(leaf,t+.008+grain()*.024,w,side),size);
    ctx.beginPath();ctx.moveTo(...c);ctx.lineTo(...d);
    ctx.lineWidth=.25+grain()*.6;
    ctx.strokeStyle=grain()>.48?'rgba(229,234,158,.12)':
      'rgba(7,44,18,.12)';
    ctx.stroke();
  }
  ctx.restore();
  // Folded half-blade shading and a restrained dark boundary.
  ctx.beginPath();ctx.moveTo(...start);
  for(const p of right)ctx.lineTo(...p);
  ctx.lineTo(...tip);ctx.closePath();
  ctx.fillStyle=illumination>.65?'rgba(197,209,126,.065)':
    'rgba(9,34,14,.14)';
  ctx.fill();
  ctx.lineWidth=.9;ctx.strokeStyle='rgba(25,51,19,.34)';
  ctx.beginPath();ctx.moveTo(...left[0]);
  for(const p of left.slice(1))ctx.lineTo(...p);
  for(const p of [...right].reverse())ctx.lineTo(...p);
  ctx.closePath();ctx.stroke();
  // The midrib and secondary veins follow the curved 3D blade.
  ctx.beginPath();ctx.moveTo(...start);
  for(let i=1;i<=16;i++)
    ctx.lineTo(...project(bladePoint(leaf,i/16,0,1),size));
  ctx.lineWidth=.9;
  ctx.strokeStyle='rgba(204,214,140,.43)';ctx.stroke();
  for(const [lt,rt] of profile.veins){
    for(const [t,dir] of [[lt,-1],[rt,1]]){
      const w=profile.outline.reduce((acc,step)=>
        Math.abs(step.t-t)<acc.distance?
          {distance:Math.abs(step.t-t),w:dir<0?step.left:step.right}:acc,
        {distance:Infinity,w:0}).w;
      const a=project(bladePoint(leaf,t*.79,0,1),size);
      const b=project(bladePoint(leaf,t,w*.83,dir),size);
      ctx.beginPath();ctx.moveTo(...a);
      ctx.quadraticCurveTo(
        ...project(bladePoint(leaf,t,w*.45,dir),size),...b);
      ctx.lineWidth=.55;
      ctx.strokeStyle='rgba(189,204,132,.22)';
      ctx.stroke();
    }
  }
}
// Reused by both the standalone 768px sprite and the game-scale atlas.
function drawOakSprig(ctx,sprig,size){
  const drawn=[];
  for(const path of sprig.paths)
    for(const p of path.points)drawn.push(project(p,size));
  for(const leaf of sprig.leaves){
    const profile=oakLeafProfile(leaf.profileSeed);
    for(const step of profile.outline){
      drawn.push(project(bladePoint(leaf,step.t,step.left,-1),size));
      drawn.push(project(bladePoint(leaf,step.t,step.right,1),size));
    }
  }
  const xs=drawn.map(p=>p[0]),ys=drawn.map(p=>p[1]);
  const left=Math.min(...xs),right=Math.max(...xs);
  const top=Math.min(...ys),bottom=Math.max(...ys);
  // Fit the entire projected twig and individual leaf contours in frame.
  const drawn=[];
  for(const path of sprig.paths)
    for(const p of path.points)drawn.push(project(p,size));
  for(const leaf of sprig.leaves){
    const profile=oakLeafProfile(leaf.profileSeed);
    for(const step of profile.outline){
      drawn.push(project(bladePoint(leaf,step.t,step.left,-1),size));
      drawn.push(project(bladePoint(leaf,step.t,step.right,1),size));
    }
  }
  const xs=drawn.map(p=>p[0]),ys=drawn.map(p=>p[1]);
  const left=Math.min(...xs),right=Math.max(...xs);
  const top=Math.min(...ys),bottom=Math.max(...ys);
  const fit=Math.min(1.6,(size-108)/(right-left),
    (size-108)/(bottom-top));
  ctx.save();
  ctx.transform(fit,0,0,fit,
    size/2-(left+right)*fit/2,
    size/2-(top+bottom)*fit/2);
  for(const path of sprig.paths)
    paintTwig(ctx,path.points,path.radius,size);
  for(const leaf of sprig.leaves)
    paintTwig(ctx,[leaf.attach,leaf.base],.95,size);
  const sorted=[...sprig.leaves].sort((a,b)=>
    dot(a.base,viewing)-dot(b.base,viewing));
  for(const leaf of sorted)paintLeaf(ctx,leaf,size);
  ctx.restore();
  return {size,leaves:sprig.leaves.length,
    branches:sprig.paths.length};
}

function validSprig(sprig){
  return sprig&&Array.isArray(sprig.paths)&&Array.isArray(sprig.leaves);
}
export function paintOakSprig(canvas,sprig){
  if(!canvas||typeof canvas.getContext!=='function'||!validSprig(sprig))
    throw Error('Invalid oak sprig canvas or structure');
  canvas.width=OAK_SPRIG_SIZE;
  canvas.height=OAK_SPRIG_SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D unavailable for oak sprig');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  return drawOakSprig(ctx,sprig,OAK_SPRIG_SIZE);
}
// Bake an independent 3D-grown twig directly into one atlas tile. Keeping
// the renderer shared prevents the game foliage from drifting away from
// the isolated leaf-spray preview.
export function paintOakSprigTile(ctx,sprig,left,top,size){
  if(!ctx||typeof ctx.save!=='function'||!validSprig(sprig)||
    ![left,top,size].every(Number.isFinite)||size<=0)
    throw Error('Invalid oak sprig tile');
  const gutter=9*size/256;
  ctx.save();
  try{
    ctx.beginPath();
    ctx.rect(left+gutter,top+gutter,size-2*gutter,size-2*gutter);
    ctx.clip();
    ctx.translate(left,top);
    ctx.scale(size/OAK_SPRIG_SIZE,size/OAK_SPRIG_SIZE);
    return drawOakSprig(ctx,sprig,OAK_SPRIG_SIZE);
  }finally{
    ctx.restore();
  }
}
