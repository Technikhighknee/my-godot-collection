// Native authored-material generation, shared with the Texture Style Study.
// Grammar math, material forms and art-direction interpretation have one owner.
import {materialSeedStreams} from './material-language.mjs';
import {PRODUCTION_MATERIAL_STYLES}
  from './artstyles/production-artstyles.mjs';
import {
  allocate, colorize, weldSeams, clamp, mix, smooth, wrap,
} from './material-grammar-math.mjs';
import {
  prepareMaterialContext, MATERIAL_SURFACE_PRODUCERS,
} from './material-grammar-surfaces.mjs';
import {artDirectionSurface} from './material-grammar-styles.mjs';

export const MATERIAL_STYLES = Object.freeze(
  PRODUCTION_MATERIAL_STYLES.map(style => style.id)
);

const W = 512;

function raster(material,style,seeds,profile){
  const retro=style==='retro-3d';
  const alternate=style==='naturalistic'||style==='watercolor';
  // Bake the new art directions at 256 px and reconstruct with periodic
  // bilinear sampling. Studio displays them at 256 px; this keeps a full
  // 512 px export without running every costly pigment field four times.
  const scale=retro?4:alternate?2:1;
  const height=material==='timber-oak'&&profile==='beam'?2048:W;
  const width=W;
  const w=width/scale,h=height/scale,m=allocate(w,h);
  const streams=materialSeedStreams(material,seeds);
  const structure=streams.form,pigment=streams.pigment;
  // Independent aging on materials with no explicit wear component; kept
  // separate from recoloring while preserving the legacy image recipes.
  const weather=seeds.wear??seeds.weather??pigment;
  // Geometry has its own art-direction grammar/seed stream. A color reseed
  // never changes the outlines or the normal/height fields.
  const form=alternate?structure^(style==='naturalistic'?
    0x529ae317:0x81f2a64d):structure;
  const dimensions={w,h,structure:form,pigment,weather,retro,
    ...prepareMaterialContext(material,{structure:form,pigment,weather,
      retro,resolution:w})};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x;
    const render = MATERIAL_SURFACE_PRODUCERS[material];
    if (!render) {
      throw Error('Unknown surface producer: ' + material);
    }
    const result = render(x, y, dimensions, profile);
    const physical=artDirectionSurface(material,style,x,y,
      {w,h,structure:form,pigment,weather},result);
    colorize(m,p,physical.rgb,physical.z,physical.rough);
  }
  // Rubble already wraps geometrically along both axes. Averaging mirrored
  // border pixels flattened the stone relief into conspicuous pale bands
  // whenever the texture was repeated. Other materials still need welding.
  if(material!=='stone-rubble')weldSeams(m);
  if(scale===1)return m;
  // Only Retro uses pixel-perfect nearest-neighbor enlargement. Naturalistic
  // and Watercolor get periodic bilinear reconstruction, preserving smooth
  // pigments and tangent-space relief rather than obvious 2x2 pixel blocks.
  const full=allocate(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const dst=y*width+x;
    if(retro){
      const src=Math.floor(y/scale)*w+Math.floor(x/scale);
      full.albedo.set(m.albedo.subarray(src*3,src*3+3),dst*3);
      full.heightMap[dst]=m.heightMap[src];
      full.roughness[dst]=m.roughness[src];
      continue;
    }
    const sx=x/scale,sy=y/scale;
    const px=Math.floor(sx),py=Math.floor(sy);
    const tx=smooth(sx-px),ty=smooth(sy-py);
    const a=py*w+px,b=py*w+wrap(px+1,w);
    const c=wrap(py+1,h)*w+px,d=wrap(py+1,h)*w+wrap(px+1,w);
    const blend=(arr,channels,channel=0)=>mix(
      mix(arr[a*channels+channel],arr[b*channels+channel],tx),
      mix(arr[c*channels+channel],arr[d*channels+channel],tx),ty);
    for(let ch=0;ch<3;ch++)
      full.albedo[dst*3+ch]=blend(m.albedo,3,ch);
    full.heightMap[dst]=blend(m.heightMap,1);
    full.roughness[dst]=blend(m.roughness,1);
  }
  return full;
}

function weldNormalEdges(d,width,height,step){
  const levels=step===4?4:12;
  const blendBlocks=(a,b,weight,stride)=>{
    for(let c=0;c<3;c++){
      const ia=a+c,ib=b+c;
      const mean=(d[ia]+d[ib])*.5;
      const av=Math.round(mix(d[ia],mean,weight));
      const bv=Math.round(mix(d[ib],mean,weight));
      for(let pixel=0;pixel<step;pixel++){
        d[ia+pixel*stride]=av;
        d[ib-pixel*stride]=bv;
      }
    }
  };
  for(let y=0;y<height;y++)for(let k=0;k<levels;k++){
    const a=(y*width+k*step)*4;
    const b=(y*width+(width-1-k*step))*4;
    blendBlocks(a,b,1-smooth(k/levels),4);
  }
  for(let x=0;x<width;x++)for(let k=0;k<levels;k++){
    const a=(k*step*width+x)*4;
    const b=((height-1-k*step)*width+x)*4;
    blendBlocks(a,b,1-smooth(k/levels),width*4);
  }
}
function validate(material,style,seeds){
  if(!['roof-thatch','timber-oak','plaster-lime','stone-rubble'].includes(material))
    throw Error('Unknown material: '+material);
  if(!MATERIAL_STYLES.includes(style))
    throw Error('Unsupported material generation style: '+style);
  const keys={
    'roof-thatch':['pattern','color'],
    'timber-oak':['grain','color'],
    'plaster-lime':['structure','pigment','wear'],
    'stone-rubble':['layout','mineral','weather'],
  }[material];
  for(const key of keys)
    if(!Number.isInteger(seeds?.[key])||seeds[key]<0||
       seeds[key]>0xffffffff)
      throw Error('Invalid native material seed: '+key);
}
export function makeMaterialSurface(material,seeds,style){
  validate(material,style,seeds);
  const recipe={...seeds},views=Object.freeze(['albedo','normal','roughness']);
  const profiles=material==='timber-oak'?Object.freeze(['beam','end','panel']):null;
  const width=W,height=material==='timber-oak'?2048:W;
  const cache=new Map();
  return {
    id:material,kind:'image',width,height,channels:'RGBA',views,
    ...(profiles?{profiles,profileSizes:{
      beam:{width:W,height:2048},end:{width:W,height:W},
      panel:{width:W,height:W}}}:{}),
    sourceSeeds:recipe,sourceStyle:style,
    paint(canvas,view='albedo',profile=material==='timber-oak'?'beam':null){
      if(!views.includes(view))throw Error('Unknown material texture channel');
      if(profiles&&!profiles.includes(profile))throw Error('Unknown timber profile');
      if(!cache.has(profile)){
        cache.set(profile,raster(material,style,recipe,profile));
      }
      const maps=cache.get(profile),w=maps.width,h=maps.height;
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('2D canvas context required');
      const image=ctx.createImageData(w,h);
      const d=image.data,retro=style==='retro-3d';
      const step=retro?4:1;
      const at=(x,y)=>maps.heightMap[
        (profiles&&profile==='end'?clamp(y,0,h-1):wrap(y,h))*w+
        (profiles&&profile==='end'?clamp(x,0,w-1):wrap(x,w))];
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const p=y*w+x,i=p*4;
        if(view==='albedo'){
          for(let c=0;c<3;c++)d[i+c]=Math.round(maps.albedo[p*3+c]*255);
        }else if(view==='roughness'){
          const value=Math.round(maps.roughness[p]*255);
          d[i]=value;d[i+1]=value;d[i+2]=value;
        }else{
          const cx=retro?Math.floor(x/4)*4+2:x;
          const cy=retro?Math.floor(y/4)*4+2:y;
          const dx=(at(cx+step,cy)-at(cx-step,cy))*2.4;
          const dy=(at(cx,cy+step)-at(cx,cy-step))*2.4;
          const length=Math.hypot(dx,dy,1);
          d[i]=Math.round((1-dx/length)*127.5);
          d[i+1]=Math.round((1-dy/length)*127.5);
          d[i+2]=Math.round((1+1/length)*127.5);
        }
        d[i+3]=255;
      }
      if(view==='normal'&&material!=='stone-rubble')weldNormalEdges(d,w,h,step);
      ctx.putImageData(image,0,0);
    },
  };
}
