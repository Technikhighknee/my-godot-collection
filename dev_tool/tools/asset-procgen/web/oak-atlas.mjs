// Hand-authored growth rules, procedurally drawn European oak leaves.
// The atlas shows *leaf masses*, not thin sparse bundles of twigs.
// Every pixel is created locally; no third-party texture or image assets.
import {oakLeafProfile} from './oak-leaf.mjs';
import {OAK_ATLAS_GRID} from './oak-foliage.mjs';
export const OAK_ATLAS_TILE=256;
export const OAK_ATLAS_SIZE=OAK_ATLAS_TILE*OAK_ATLAS_GRID;
const TAU=2*Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
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
// A broad, readable Quercus robur silhouette. Converting the leaf's
// intrinsic narrow botanical outline into a full game-scale spray calls
// for a little extra lateral fullness; vein and lobe positions are intact.
function paintLeaf(ctx,p,theta,size,rng,depth){
  const profile=oakLeafProfile(Math.floor(rng()*4294967296));
  const forward=[Math.cos(theta),Math.sin(theta)];
  const sideways=[-forward[1],forward[0]];
  const widthScale=1.76+(.22*rng());
  // A clipped leaf produces a conspicuously straight atlas boundary.
  // Reduce only the handful of outward-facing blades that exceed the
  // tile's transparent gutter, retaining their petiole attachment.
  const tileX=Math.floor(p[0]/OAK_ATLAS_TILE)*OAK_ATLAS_TILE;
  const tileY=Math.floor(p[1]/OAK_ATLAS_TILE)*OAK_ATLAS_TILE;
  const min=[tileX+11,tileY+11],max=[tileX+245,tileY+245];
  let fit=1;
  for(const step of profile.outline)
    for(const [w,sign] of [[step.left,-1],[step.right,1]]){
      const dx=forward[0]*step.t*size+sideways[0]*size*w*sign*widthScale;
      const dy=forward[1]*step.t*size+sideways[1]*size*w*sign*widthScale;
      for(const [axis,d] of [[0,dx],[1,dy]]){
        if(d>0)fit=Math.min(fit,(max[axis]-p[axis])/d);
        if(d<0)fit=Math.min(fit,(min[axis]-p[axis])/d);
      }
    }
  size*=clamp(fit*.992,.12,1);
  const at=(t,w,sign)=>[
    p[0]+forward[0]*size*t+sideways[0]*size*w*sign*widthScale,
    p[1]+forward[1]*size*t+sideways[1]*size*w*sign*widthScale,
  ];
  ctx.beginPath();
  ctx.moveTo(...at(profile.outline[0].t,profile.outline[0].left,-1));
  for(const step of profile.outline)
    ctx.lineTo(...at(step.t,step.left,-1));
  for(let i=profile.outline.length-1;i>=0;i--){
    const step=profile.outline[i];
    ctx.lineTo(...at(step.t,step.right,1));
  }
  ctx.closePath();
  const hue=98+11*rng(),saturation=36+9*rng();
  // Dark interior leaves first; high/outer leaves have sunlit highlights.
  const value=clamp(27+depth*11+(rng()-.5)*7,22,49);
  ctx.fillStyle='hsl('+hue.toFixed(1)+' '+saturation.toFixed(1)+'% '+
    value.toFixed(1)+'%)';
  ctx.fill();
  // A delicate rim and midrib, not dark hairline spikes.
  ctx.strokeStyle='rgba(34,64,25,.16)';
  ctx.lineWidth=.45;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(...p);
  const mid=at(.55,0,1),tip=at(.97,0,1);
  ctx.quadraticCurveTo(...mid,...tip);
  ctx.lineWidth=.65;
  ctx.strokeStyle='rgba(187,202,112,.25)';
  ctx.stroke();
  return profile;
}
function spray(ctx,left,top,rng,variant){
  const tile=OAK_ATLAS_TILE;
  const mid=left+tile*.5,base=[mid+(rng()-.5)*10,top+tile*.79];
  const broad=.84+.19*(variant%5)/4;
  const endpoints=[
    [left+tile*(.22+.025*rng()),top+tile*(.37+.07*rng())],
    [left+tile*(.32+.04*rng()),top+tile*(.21+.06*rng())],
    [left+tile*(.56+.04*rng()),top+tile*(.17+.06*rng())],
    [left+tile*(.78-.045*rng()),top+tile*(.32+.08*rng())],
  ];
  // Back canopy: small lobed leaves at several depths, so the card has
  // opaque green coverage instead of an almost transparent spiky twig.
  // The same deterministic sprites are shared across all tree seeds.
  for(let layer=0;layer<2;layer++){
    const leaves=layer===0?14:13;
    for(let i=0;i<leaves;i++){
      const a=(i+.5)/leaves*TAU+(rng()-.5)*.36;
      const polar=.48+.39*rng();
      const radius=(layer===0?.39:.27)*tile*Math.sqrt((i+.5)/leaves);
      const p=[
        mid+Math.cos(a)*radius*broad,
        top+tile*.49+Math.sin(a)*radius*.77,
      ];
      const angle=-Math.PI/2+(rng()-.5)*2.05;
      paintLeaf(ctx,p,angle,(layer===0?52:61)+rng()*15,rng,
        layer===0?.12:.38);
    }
  }
  // Woody connections are subtle, only visible between closely packed
  // leaves. Never draw large bare branch fans across the card.
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='rgba(63,76,39,.65)';
  for(let i=0;i<endpoints.length;i++){
    const p=endpoints[i];
    ctx.beginPath();ctx.moveTo(...base);
    ctx.quadraticCurveTo(mid+(p[0]-mid)*.32,top+tile*.52,...p);
    ctx.lineWidth=1.15+(i%3)*.17;
    ctx.stroke();
  }
  // Large overlapping outer leaves establish a clear, round-scalloped
  // silhouette. Each one is connected to a real, short twiglet in 2D.
  for(let i=0;i<endpoints.length;i++){
    const tip=endpoints[i],diff=[tip[0]-base[0],tip[1]-base[1]];
    for(let j=0;j<6;j++){
      const t=.31+j*.114;
      const pos=[
        base[0]+diff[0]*t+(rng()-.5)*6,
        base[1]+diff[1]*t+(rng()-.5)*6,
      ];
      const side=(j%2===0?-1:1)*(i%2===0?1:-1);
      const theta=-Math.PI/2+side*(.40+.48*rng())+
        (i-1.5)*.20+(rng()-.5)*.32;
      const size=(j>=3?63:55)+rng()*18;
      paintLeaf(ctx,pos,theta,size,rng,.55+.37*rng());
    }
    const d=Math.hypot(...diff)||1;
    paintLeaf(ctx,[tip[0]-diff[0]*.12,tip[1]-diff[1]*.12],
      Math.atan2(diff[1],diff[0]),54+12*rng(),rng,.78);
  }
  // Partial leaf silhouettes around the underside join the outer
  // sprays into a readable, irregular broad clump.
  for(let i=0;i<6;i++){
    const p=[mid+(rng()-.5)*tile*.47,top+tile*(.55+.12*rng())];
    paintLeaf(ctx,p,-Math.PI/2+(rng()-.5)*2.25,56+16*rng(),rng,.56);
  }
}
export function paintOakAtlas(canvas,seed=21749){
  if(!canvas||typeof canvas.getContext!=='function'||
    !Number.isInteger(seed)||seed<0||seed>0xffffffff)
    throw Error('Invalid oak atlas canvas or seed');
  canvas.width=OAK_ATLAS_SIZE;canvas.height=OAK_ATLAS_SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D unavailable for oak texture atlas');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let tile=0;tile<OAK_ATLAS_GRID**2;tile++){
    const rng=random((seed^Math.imul(tile+1,0x9e3779b1))>>>0);
    const left=(tile%OAK_ATLAS_GRID)*OAK_ATLAS_TILE;
    const top=Math.floor(tile/OAK_ATLAS_GRID)*OAK_ATLAS_TILE;
    // Per-tile clipping also protects the mip chain against a
    // stray leaf tip in unusual seeds.
    ctx.save();
    ctx.beginPath();
    ctx.rect(left+9,top+9,OAK_ATLAS_TILE-18,OAK_ATLAS_TILE-18);
    ctx.clip();
    spray(ctx,left,top,rng,tile);
    ctx.restore();
  }
  return {size:OAK_ATLAS_SIZE,tiles:OAK_ATLAS_GRID**2,padding:9};
}
