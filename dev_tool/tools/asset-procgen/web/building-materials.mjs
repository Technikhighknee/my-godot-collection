// Small, repeatable authoring-preview materials. No downloaded textures.
// The building geometry already has planar UVs; these canvases add subtle
// surface structure, not painted-on masonry or false architectural detail.
import * as THREE from 'three';

const SIZE=192;
const hash=(x,y,seed)=>{
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)>>>0;
  n=Math.imul(n^(n>>>13),1274126177)>>>0;
  return ((n^(n>>>16))>>>0)/4294967295;
};
function noise(x,y,step,seed){
  const u=x/step,v=y/step,ix=Math.floor(u),iy=Math.floor(v);
  const tx=u-ix,ty=v-iy;
  const smooth=t=>t*t*(3-2*t);
  const ax=smooth(tx),ay=smooth(ty);
  const a=hash(ix,iy,seed),b=hash(ix+1,iy,seed);
  const c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed);
  return (a*(1-ax)+b*ax)*(1-ay)+(c*(1-ax)+d*ax)*ay;
}
export function buildingSurfaceKind(material){
  const name=material.toLowerCase();
  if(/plaster|interior$/.test(name))return 'plaster';
  if(/timber|trim|shutter|door|wood|gallery/.test(name))return 'wood';
  if(/tile|roof|ridge/.test(name))return 'roof';
  if(/foundation|stone|brick|plinth/.test(name))return 'stone';
  if(/floor/.test(name))return 'floor';
  return null;
}
function paint(kind){
  const canvas=document.createElement('canvas');
  canvas.width=SIZE;canvas.height=SIZE;
  const context=canvas.getContext('2d');
  if(!context)throw Error('2D canvas unavailable for building material');
  const image=context.createImageData(SIZE,SIZE);
  const seed={plaster:1329,wood:5109,stone:7302,roof:9044,floor:3029}[kind];
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const fine=hash(x,y,seed);
    const broad=noise(x,y,31,seed+102);
    const mid=noise(x,y,7,seed+310);
    let value=246+(broad-.5)*20+(mid-.5)*12+(fine-.5)*12;
    if(kind==='plaster'){
      value-=Math.max(0,.30-noise(x,y,13,seed+600))*33;
    }else if(kind==='wood'||kind==='floor'){
      const grain=Math.sin((x*.29)+(Math.sin(y*.045)*1.3)+mid*1.5);
      value-=Math.max(0,grain)*11;
      value+=(noise(x,y,49,seed+711)-.5)*13;
    }else if(kind==='stone'){
      const speckle=hash(x,y,seed+911);
      if(speckle>.974)value-=28;
      if(speckle<.016)value+=8;
    }else if(kind==='roof'){
      value+=(noise(x,y,15,seed+42)-.5)*17;
      if(hash(x,y,seed+453)>.989)value-=34;
    }
    value=Math.max(170,Math.min(255,value));
    const p=(y*SIZE+x)*4;
    image.data[p]=value;
    image.data[p+1]=value;
    image.data[p+2]=value;
    image.data[p+3]=255;
  }
  context.putImageData(image,0,0);
  return canvas;
}
export function createBuildingTextures(renderer){
  const cache=new Map();
  return {
    get(material){
      const kind=buildingSurfaceKind(material);
      if(!kind)return null;
      if(!cache.has(kind)){
        const texture=new THREE.CanvasTexture(paint(kind));
        texture.wrapS=THREE.RepeatWrapping;
        texture.wrapT=THREE.RepeatWrapping;
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.minFilter=THREE.LinearMipmapLinearFilter;
        texture.magFilter=THREE.LinearFilter;
        texture.generateMipmaps=true;
        texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        cache.set(kind,texture);
      }
      return cache.get(kind);
    },
    dispose(){for(const value of cache.values())value.dispose();cache.clear();},
  };
}
