// Renderer-independent vector math and keyed random streams.
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const magnitude=a=>Math.hypot(a[0],a[1],a[2]);
export const unit=a=>{const len=magnitude(a);return len>1e-9?scale(a,1/len):[0,1,0];};
export const mix=(a,b,t)=>add(scale(a,1-t),scale(b,t));
export const clamp=(a,min,max)=>Math.max(min,Math.min(max,a));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const TAU=Math.PI*2;

// Nonzero, avalanche-mixed 32-bit seed. Keys are stable structural IDs,
// not mutable positions in a shared random sequence.
export function keySeed(seed,key,salt=0) {
  let x=(seed^Math.imul(key+1,0x9e3779b1)^Math.imul(salt+1,0x85ebca77))>>>0;
  x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;
  x=Math.imul(x,0x846ca68b);x^=x>>>16;
  return x>>>0;
}
export function randomStream(seed,key,salt=0) {
  let x=keySeed(seed,key,salt);
  return ()=>{
    x=(x+0x6d2b79f5)>>>0;
    let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
export const signed=(random,amplitude=1)=>(random()*2-1)*amplitude;
