// Shared, seed-reproducible roof surfaces. No scene lighting baked into albedo.
// Albedo, normal and roughness maps are derived from the same periodic height field.
// UVs: U along ridge, V downhill; images repeat in both directions.
export const ROOF_TEXTURE_SIZE=512;
export const ROOF_VIEWS=Object.freeze(['albedo','normal','roughness']);
const SIZE=ROOF_TEXTURE_SIZE;
const fract=x=>x-Math.floor(x);
const wrap=(n,size)=>((n%size)+size)%size;
const mix=(a,b,t)=>a*(1-t)+b*t;
const clamp=(v,a=0,b=255)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const hash=(x,y,seed)=>{
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)>>>0;
  n=Math.imul(n^(n>>>13),1274126177)>>>0;
  return ((n^(n>>>16))>>>0)/4294967295;
};
function sample(kind,u,v,seeds){
  const pattern=seeds.pattern>>>0,color=seeds.color>>>0;
  if(kind==='clay'){
    const cols=8,rows=8;
    const r=Math.floor(v*rows),ry=fract(v*rows);
    const stagger=((wrap(r,rows)%2)===1?.5:0);
    const c=Math.floor(u*cols+stagger),rx=fract(u*cols+stagger);
    const variation=hash(wrap(c,cols),wrap(r,rows),color);
    const chipped=hash(wrap(c,cols),wrap(r,rows),pattern^0x4325);
    const edge=Math.min(rx,1-rx);
    // A curved pan tile, separated by mortar-shadow gaps. The upper lip
    // overlaps the course below; lower tips are rounded, not square pixels.
    const scallop=Math.sin(Math.PI*rx)**2;
    const lip=Math.exp(-Math.pow((ry-.85)/.105,2));
    const rim=Math.exp(-Math.pow((ry-.09)/.07,2));
    const gap=clamp(edge*34,0,1);
    const broken=(chipped>.91&&ry>.87&&rx>.78)?-.16:0;
    const height=(.23+.52*scallop+.26*lip+.11*rim)*gap+broken;
    const micro=(hash(wrap(Math.floor(u*SIZE),SIZE),
      wrap(Math.floor(v*SIZE),SIZE),pattern^39)-.5)*.032;
    const base=[.52,.28,.185].map((n,i)=>n+(.22*variation-.105)*[.90,.68,.52][i]+micro);
    const crevice=gap<.3?.57+gap*1.2:ry<.065?.79:1;
    return {height,base:base.map(n=>n*crevice),
      roughness:clamp(.81+(.5-variation)*.14+micro,.57,.97)};
  }
  if(kind==='thatch'){
    const rows=9,cols=96;
    const r=Math.floor(v*rows),ry=fract(v*rows);
    const fiber=Math.floor(u*cols),fx=fract(u*cols);
    const strand=hash(wrap(fiber,cols),wrap(r,rows),pattern);
    const neighbor=hash(wrap(fiber+1,cols),wrap(r,rows),pattern);
    const band=Math.sin(Math.PI*ry)**2;
    const taper=(1-ry)*.09;
    const fibers=(Math.sin(fx*Math.PI*2)*.045+
      (strand-.5)*.20+(neighbor-.5)*.04);
    const rough=hash(wrap(Math.floor(u*SIZE),SIZE),
      wrap(Math.floor(v*SIZE),SIZE),color);
    const overlap=ry>.83?mix(1,.68,(ry-.83)/.17):ry<.09?.79+ry*2:1;
    const height=.14+.4*band+.19*Math.exp(-Math.pow((ry-.80)/.14,2))+fibers;
    const tone=hash(wrap(fiber,cols),wrap(r,rows),color);
    const vTone=(tone-.5)*.18+(rough-.5)*.07+taper;
    return {height,base:[
      (.39+vTone)*overlap,
      (.305+vTone*.71)*overlap,
      (.18+vTone*.48)*overlap,
    ],roughness:clamp(.92+(tone-.5)*.08,.83,.99)};
  }
  throw Error('Unsupported roof material: '+kind);
}
export function paintRoofTexture(canvas,kind,seeds,view='albedo'){
  if(!['clay','thatch'].includes(kind))throw Error('Unknown roof texture type');
  if(!ROOF_VIEWS.includes(view))throw Error('Unknown roof texture channel');
  for(const k of ['pattern','color'])
    if(!Number.isInteger(seeds?.[k])||seeds[k]<0||seeds[k]>0xffffffff)
      throw Error('Invalid roof texture seed: '+k);
  canvas.width=SIZE;canvas.height=SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D canvas context required');
  const data=ctx.createImageData(SIZE,SIZE);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const u=(x+.5)/SIZE,v=(y+.5)/SIZE;
    const s=sample(kind,u,v,seeds);
    const i=(y*SIZE+x)*4;
    if(view==='albedo'){
      for(let j=0;j<3;j++)data.data[i+j]=Math.round(clamp(s.base[j]*255));
    }else if(view==='normal'){
      const delta=1/SIZE;
      const dx=(sample(kind,u+delta,v,seeds).height-
        sample(kind,u-delta,v,seeds).height)*1.8;
      const dy=(sample(kind,u,v+delta,seeds).height-
        sample(kind,u,v-delta,seeds).height)*1.8;
      const length=Math.hypot(dx,dy,1);
      data.data[i]=Math.round((1-dx/length)*127.5);
      data.data[i+1]=Math.round((1-dy/length)*127.5);
      data.data[i+2]=Math.round((1+1/length)*127.5);
    }else{
      const value=Math.round(255*s.roughness);
      data.data[i]=value;data.data[i+1]=value;data.data[i+2]=value;
    }
    data.data[i+3]=255;
  }
  ctx.putImageData(data,0,0);
}
export function makeRoofAsset(kind,seeds){
  return {id:kind==='clay'?'roof-clay':'roof-thatch',kind:'image',
    width:SIZE,height:SIZE,channels:'RGBA',views:ROOF_VIEWS,
    paint:(canvas,view='albedo')=>paintRoofTexture(canvas,kind,seeds,view)};
}
