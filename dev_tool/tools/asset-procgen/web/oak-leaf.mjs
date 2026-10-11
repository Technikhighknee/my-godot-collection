// Procedural Quercus robur blades: vein-informed rounded lobes,
// asymmetric basal auricles, a curved midrib and a gently folded surface.
// All measurements are relative to the eventual leaf length.
const PI=Math.PI,TAU=2*PI;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
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
export function oakLeafProfile(seed){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid leaf seed');
  const rng=random(seed);
  const lobes=4+Math.floor(rng()*3);
  const fullness=.76+rng()*.26;
  const baseEar=.21+rng()*.23;
  const leftScale=.87+rng()*.21,rightScale=.87+rng()*.21;
  const depth=.35+rng()*.19;
  const halfWidth=.29+.085*rng();
  const centers=Array.from({length:lobes},(_,i)=>{
    const main=.115+i*.755/(lobes-1);
    return [
      clamp(main+(rng()-.5)*.045,.07,.93),
      clamp(main+(rng()-.5)*.045,.07,.93),
    ];
  });
  const bays=[[],[]];
  for(let k=0;k<2;k++)
    for(let i=0;i<lobes-1;i++)
      bays[k].push((centers[i][k]+centers[i+1][k])*.5);
  const options={lobes,fullness,baseEar,depth,halfWidth,centers,bays,leftScale,rightScale};
  const width=(t,side)=>{
    const k=side<0?0:1;
    const envelope=Math.pow(Math.max(0,Math.sin(PI*t)),.64)*
      (.92+.28*t)*fullness;
    const scale=k===0?leftScale:rightScale;
    let valley=0;
    const sigma=.042+.012*(6-lobes);
    for(const c of bays[k])valley+=Math.exp(-.5*((t-c)/sigma)**2);
    const lobe=Math.max(.24,1-depth*valley);
    const ear=baseEar*(k===0?1: .80+.20*rightScale)*
      Math.exp(-.5*((t-.066)/.040)**2);
    return halfWidth*Math.max(.002,envelope*lobe*scale+ear);
  };
  // The sampled profile has independent left/right curves; lobe tips
  // follow the lateral veins rather than arbitrary perimeter noise.
  return Object.freeze({
    lobes,halfWidth,baseEar,depth,
    veins:centers.map(pair=>pair.slice()),
    outline:Array.from({length:37},(_,i)=>{
      const t=(i+.12)/36.24;
      return {t,left:width(t,-1),right:width(t,1)};
    }),
  });
}
