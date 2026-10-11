// A seeded RGBA atlas of oak leaf sprays. Each sprite includes many
// anatomically lobed leaves and fine branchlets drawn on transparent
// canvas; the 3D generator only needs a handful of bent cards per clump.
import {oakLeafProfile} from './oak-leaf.mjs';
import {OAK_ATLAS_GRID} from './oak-foliage.mjs';
export const OAK_ATLAS_TILE=256;
export const OAK_ATLAS_SIZE=OAK_ATLAS_TILE*OAK_ATLAS_GRID;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
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
function leaf(ctx,origin,heading,length,profile,hue,light,rng){
  const across=[-heading[1],heading[0]];
  const point=(t,w,sign)=>[
    origin[0]+heading[0]*t*length+across[0]*w*length*sign,
    origin[1]+heading[1]*t*length+across[1]*w*length*sign,
  ];
  ctx.beginPath();
  ctx.moveTo(...point(profile.outline[0].t,profile.outline[0].left,-1));
  for(const s of profile.outline)ctx.lineTo(...point(s.t,s.left,-1));
  for(let i=profile.outline.length-1;i>=0;i--){
    const s=profile.outline[i];
    ctx.lineTo(...point(s.t,s.right,1));
  }
  ctx.closePath();
  const sat=28+9*rng();
  ctx.fillStyle='hsl('+hue.toFixed(1)+' '+sat.toFixed(1)+'% '+
    clamp(light+(rng()-.5)*12,25,56).toFixed(1)+'%)';
  ctx.fill();
  ctx.strokeStyle='rgba(25,49,22,.22)';
  ctx.lineWidth=.62;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(...origin);
  ctx.quadraticCurveTo(
    origin[0]+heading[0]*length*.47+across[0]*length*.025,
    origin[1]+heading[1]*length*.47+across[1]*length*.025,
    ...point(.965,0,0));
  ctx.strokeStyle='rgba(176,198,107,.36)';
  ctx.lineWidth=.85;
  ctx.stroke();
  ctx.strokeStyle='rgba(160,193,110,.20)';
  ctx.lineWidth=.5;
  for(const pair of profile.veins){
    const t=(pair[0]+pair[1])*.5;
    const sample=profile.outline[Math.min(36,Math.round(t*36))];
    for(const sign of [-1,1]){
      ctx.beginPath();
      ctx.moveTo(...point(t-.05,0,0));
      ctx.lineTo(...point(t,sign<0?sample.left*.75:sample.right*.75,sign));
      ctx.stroke();
    }
  }
}
function spray(ctx,cx,cy,rng,variant){
  const tile=OAK_ATLAS_TILE,base=[cx,cy+tile*.34];
  const spread=variant%4===0?1.16:variant%4===1?.87:1;
  const tips=[],n=5+(variant%3===0?1:0);
  for(let i=0;i<n;i++){
    const a=i/(n-1);
    tips.push([
      cx+(a-.5)*tile*.52*spread+(rng()-.5)*tile*.06,
      cy-tile*(.25+.13*(1-Math.abs(a-.5)*1.5))+
        (rng()-.5)*tile*.07,
    ]);
  }
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='rgba(50,65,29,.98)';
  for(let i=0;i<tips.length;i++){
    const tip=tips[i];
    ctx.beginPath();ctx.moveTo(...base);
    ctx.quadraticCurveTo(cx+(tip[0]-cx)*.36,
      cy+tile*.02+(i%2?-.03:.01)*tile,...tip);
    ctx.lineWidth=i===Math.floor(n/2)?2:1.25;
    ctx.stroke();
  }
  for(let i=0;i<tips.length;i++){
    const tip=tips[i],delta=[tip[0]-base[0],tip[1]-base[1]];
    const count=4+(i%2);
    for(let k=0;k<count;k++){
      const t=.40+(k+.28+.16*rng())*.54/count;
      const p=[base[0]+delta[0]*t+(rng()-.5)*3,
        base[1]+delta[1]*t+(rng()-.5)*3];
      const sign=(k+i)%2?1:-1;
      const angle=-Math.PI/2+sign*(.35+.51*rng())+
        .15*(i-(n-1)/2)+(rng()-.5)*.28;
      leaf(ctx,p,[Math.cos(angle),Math.sin(angle)],
        tile*(.19+.055*rng())*(k===count-1?.83:1),
        oakLeafProfile(Math.floor(rng()*4294967296)),
        93+18*rng(),37+6*rng(),rng);
    }
    const d=Math.hypot(...delta)||1;
    leaf(ctx,[tip[0]-delta[0]*.085,tip[1]-delta[1]*.085],
      [delta[0]/d,delta[1]/d],tile*(.19+.045*rng()),
      oakLeafProfile(Math.floor(rng()*4294967296)),
      97+15*rng(),40+6*rng(),rng);
  }
}
export function paintOakAtlas(canvas,seed=21749){
  if(!canvas||typeof canvas.getContext!=='function'||
    !Number.isInteger(seed)||seed<0||seed>0xffffffff)
    throw Error('Invalid oak atlas canvas or seed');
  canvas.width=OAK_ATLAS_SIZE;
  canvas.height=OAK_ATLAS_SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D unavailable for oak texture atlas');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<OAK_ATLAS_GRID**2;i++){
    const rng=random((seed^Math.imul(i+1,0x9e3779b1))>>>0);
    const cx=(i%OAK_ATLAS_GRID+.5)*OAK_ATLAS_TILE;
    // Keep every lobe inside its atlas tile, including transparent padding.
    const cy=(Math.floor(i/OAK_ATLAS_GRID)+.5)*OAK_ATLAS_TILE+26;
    spray(ctx,cx,cy,rng,i);
  }
  return {size:OAK_ATLAS_SIZE,tiles:OAK_ATLAS_GRID**2,
    padding:Math.floor(OAK_ATLAS_TILE*.035)};
}
